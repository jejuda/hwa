import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel
} from '@discordjs/voice';
import { Communicate } from 'edge-tts-universal';
import { Readable } from 'node:stream';
import * as db from '../../database.js';

const VOICE_CONNECTION_TIMEOUT_MS = 15_000;
const TTS_REQUEST_TIMEOUT_MS = 10_000;
const PLAYBACK_START_TIMEOUT_MS = 10_000;
const PLAYBACK_FINISH_TIMEOUT_MS = 60_000;

let audioPlayer = null;
let playbackQueue = Promise.resolve(true);

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function getAudioPlayer() {
  if (!audioPlayer) {
    audioPlayer = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Stop
      }
    });
    audioPlayer.on('error', error => {
      console.error('Voice audio player error:', error);
    });
  }

  return audioPlayer;
}

async function createReadyConnection(guild, channelId) {
  const connection = joinVoiceChannel({
    channelId,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true
  });

  await entersState(connection, VoiceConnectionStatus.Ready, VOICE_CONNECTION_TIMEOUT_MS);
  return connection;
}

export async function connectVoiceChannel(client, guildId, channelId) {
  const guild = client.guilds.cache.get(guildId)
    || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    throw new Error(`Discord guild not found: ${guildId}`);
  }

  let connection = getVoiceConnection(guildId);
  if (connection && connection.joinConfig.channelId !== channelId) {
    connection.destroy();
    connection = null;
  }

  if (connection) {
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, VOICE_CONNECTION_TIMEOUT_MS);
      return connection;
    } catch (error) {
      console.warn('Existing voice connection was not ready; reconnecting:', error.message);
      connection.destroy();
    }
  }

  try {
    return await createReadyConnection(guild, channelId);
  } catch (firstError) {
    const failedConnection = getVoiceConnection(guildId);
    if (failedConnection) failedConnection.destroy();

    console.warn('Initial voice connection failed; retrying once:', firstError.message);
    try {
      return await createReadyConnection(guild, channelId);
    } catch (retryError) {
      const retryConnection = getVoiceConnection(guildId);
      if (retryConnection) retryConnection.destroy();
      throw new Error(`Voice channel connection failed: ${retryError.message}`, {
        cause: retryError
      });
    }
  }
}

async function synthesizeWithGoogle(text) {
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const url = new URL('https://translate.google.com/translate_tts');
      url.searchParams.set('ie', 'UTF-8');
      url.searchParams.set('client', 'tw-ob');
      url.searchParams.set('tl', 'ko');
      url.searchParams.set('q', text);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0'
        },
        signal: AbortSignal.timeout(TTS_REQUEST_TIMEOUT_MS)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';
      const audio = Buffer.from(await response.arrayBuffer());
      if (!contentType.startsWith('audio/') || audio.length < 1000) {
        throw new Error(`Invalid audio response (${contentType || 'unknown'}, ${audio.length} bytes)`);
      }

      return audio;
    } catch (error) {
      lastError = error;
      console.warn(`Google TTS attempt ${attempt} failed:`, error.message);
    }
  }

  throw lastError || new Error('Google TTS failed.');
}

async function synthesizeWithEdge(text) {
  const communicate = new Communicate(text, {
    voice: 'ko-KR-SunHiNeural',
    connectionTimeout: TTS_REQUEST_TIMEOUT_MS
  });

  const chunks = [];
  await withTimeout((async () => {
    for await (const chunk of communicate.stream()) {
      if (chunk.type === 'audio' && chunk.data) {
        chunks.push(chunk.data);
      }
    }
  })(), TTS_REQUEST_TIMEOUT_MS, 'Edge TTS request timed out.');

  if (chunks.length === 0) {
    throw new Error('Edge TTS returned no audio.');
  }

  return Buffer.concat(chunks);
}

export async function synthesizeSpeech(text) {
  try {
    return await synthesizeWithGoogle(text);
  } catch (googleError) {
    console.warn('Google TTS unavailable; falling back to Edge TTS:', googleError.message);
    return await synthesizeWithEdge(text);
  }
}

async function playTTSNow(client, guildId, channelId, text) {
  const audio = await synthesizeSpeech(text);
  const connection = await connectVoiceChannel(client, guildId, channelId);
  const player = getAudioPlayer();
  const subscription = connection.subscribe(player);
  if (!subscription) {
    throw new Error('Failed to subscribe the audio player to the voice connection.');
  }

  const resource = createAudioResource(Readable.from([audio]), {
    inputType: StreamType.Arbitrary
  });

  player.play(resource);
  try {
    await entersState(player, AudioPlayerStatus.Playing, PLAYBACK_START_TIMEOUT_MS);
    await entersState(player, AudioPlayerStatus.Idle, PLAYBACK_FINISH_TIMEOUT_MS);
  } catch (error) {
    player.stop(true);
    throw error;
  }

  console.log(`🔊 Voice announcement played: ${text}`);
  return true;
}

export function playTTS(client, guildId, channelId, text) {
  playbackQueue = playbackQueue.then(async () => {
    try {
      return await playTTSNow(client, guildId, channelId, text);
    } catch (error) {
      console.error(`Voice announcement failed (${text}):`, error);
      return false;
    }
  });

  return playbackQueue;
}

export async function triggerVoiceTTS(client, bossName) {
  try {
    const channelId = await db.getSetting('voice_channel');
    const guildId = await db.getSetting('voice_guild');
    if (!channelId || !guildId) return false;

    return await playTTS(client, guildId, channelId, `${bossName} 젠 5분 전입니다.`);
  } catch (error) {
    console.error('Failed to trigger voice TTS:', error);
    return false;
  }
}

export async function announceVoice(client, text) {
  try {
    const channelId = await db.getSetting('voice_channel');
    const guildId = await db.getSetting('voice_guild');
    if (!channelId || !guildId) return false;

    return await playTTS(client, guildId, channelId, text);
  } catch (error) {
    console.error('Failed to play voice announcement:', error);
    return false;
  }
}
