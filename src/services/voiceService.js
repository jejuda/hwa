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

export async function playTTS(client, guildId, channelId, text) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

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
    const readable = Readable.from((async function* () {
      for await (const chunk of communicate.stream()) {
        if (chunk.type === 'audio' && chunk.data) {
          yield chunk.data;
        }
      }
    })());

    const resource = createAudioResource(readable);
    audioPlayer.play(resource);
  } catch (err) {
    console.error('Error in playTTS:', err);
  }
}

export async function triggerVoiceTTS(client, bossName) {
  try {
    const channelId = await db.getSetting('voice_channel');
    const guildId = await db.getSetting('voice_guild');

    if (!channelId || !guildId) return;

    const text = `${bossName} 젠 5분 전입니다.`;
    await playTTS(client, guildId, channelId, text);
  } catch (err) {
    console.error('Failed to trigger voice TTS:', err);
  }
}

export async function announceVoice(client, text) {
  try {
    const channelId = await db.getSetting('voice_channel');
    const guildId = await db.getSetting('voice_guild');

    if (!channelId || !guildId) return;

    await playTTS(client, guildId, channelId, text);
  } catch (err) {
    console.error('Failed to play voice announcement:', err);
  }
}
