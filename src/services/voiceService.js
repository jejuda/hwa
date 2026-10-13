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
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import * as db from '../../database.js';

const VOICE_CONNECTION_TIMEOUT_MS = 15_000;
const PLAYBACK_START_TIMEOUT_MS = 10_000;
const PLAYBACK_FINISH_TIMEOUT_MS = 60_000;
const FEMALE_VOICE_DIRECTORY = new URL('../../assets/voice/female/', import.meta.url);

let audioPlayer = null;
let playbackQueue = Promise.resolve(true);

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

export async function synthesizeSpeech(text) {
  const fileName = `${createHash('sha256').update(text).digest('hex')}.mp3`;

  try {
    return await readFile(new URL(fileName, FEMALE_VOICE_DIRECTORY));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`No female voice asset exists for: ${text}`, { cause: error });
    }
    throw error;
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
