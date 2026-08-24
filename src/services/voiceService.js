import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  getVoiceConnection
} from '@discordjs/voice';
import { Communicate } from 'edge-tts-universal';
import { Readable } from 'stream';
import * as db from '../../database.js';

let audioPlayer = null;
const ttsQueue = [];
let isPlayingTTS = false;

async function processTTSQueue(client) {
  if (isPlayingTTS || ttsQueue.length === 0) return;
  isPlayingTTS = true;

  const item = ttsQueue.shift();
  try {
    const { guildId, channelId, text } = item;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      isPlayingTTS = false;
      return processTTSQueue(client);
    }

    let connection = getVoiceConnection(guildId);
    if (!connection) {
      connection = joinVoiceChannel({
        channelId: channelId,
        guildId: guildId,
        adapterCreator: guild.voiceAdapterCreator,
      });
    }

    if (!audioPlayer) {
      audioPlayer = createAudioPlayer();
    }

    connection.subscribe(audioPlayer);

    const communicate = new Communicate(text, {
      voice: 'ko-KR-SunHiNeural'
    });

    const chunks = [];
    for await (const chunk of communicate.stream()) {
      if (chunk.type === 'audio' && chunk.data) {
        chunks.push(chunk.data);
      }
    }

    if (chunks.length > 0) {
      const buffer = Buffer.concat(chunks);
      const resource = createAudioResource(Readable.from(buffer));
      audioPlayer.play(resource);

      // Wait for audio player to finish playing or timeout after 10s
      await new Promise((resolve) => {
        const onStateChange = (oldState, newState) => {
          if (newState.status === 'idle') {
            audioPlayer.off('stateChange', onStateChange);
            resolve();
          }
        };
        audioPlayer.on('stateChange', onStateChange);
        setTimeout(() => {
          audioPlayer.off('stateChange', onStateChange);
          resolve();
        }, 10000);
      });
    }
  } catch (err) {
    console.error('Error in TTS queue processing:', err);
  } finally {
    isPlayingTTS = false;
    processTTSQueue(client);
  }
}

export function playTTS(client, guildId, channelId, text) {
  ttsQueue.push({ guildId, channelId, text });
  processTTSQueue(client);
}

export async function triggerVoiceTTS(client, bossName) {
  try {
    const channelId = await db.getSetting('voice_channel');
    const guildId = await db.getSetting('voice_guild');

    if (!channelId || !guildId) return;

    const text = `${bossName} 젠 5분 전입니다.`;
    playTTS(client, guildId, channelId, text);
  } catch (err) {
    console.error('Failed to trigger voice TTS:', err);
  }
}

export async function announceVoice(client, text) {
  try {
    const channelId = await db.getSetting('voice_channel');
    const guildId = await db.getSetting('voice_guild');

    if (!channelId || !guildId) return;

    playTTS(client, guildId, channelId, text);
  } catch (err) {
    console.error('Failed to play voice announcement:', err);
  }
}
