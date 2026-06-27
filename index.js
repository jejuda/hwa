import { Client, GatewayIntentBits, EmbedBuilder, ActivityType } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection } from '@discordjs/voice';
import express from 'express';
import ffmpeg from 'ffmpeg-static';
import dotenv from 'dotenv';
import * as db from './database.js';

dotenv.config();

// Enforce FFmpeg binary path for voice transcoding
process.env.FFMPEG_PATH = ffmpeg;

let sseClients = [];


// Helper: Broadcast event to all connected SSE clients
function broadcastSSE(data) {
  const json = JSON.stringify(data);
  sseClients.forEach(clientObj => {
    try {
      clientObj.res.write(`data: ${json}\n\n`);
    } catch (err) {
      console.error('Error writing to SSE client:', err);
    }
  });
}


const { DISCORD_TOKEN } = process.env;

if (!DISCORD_TOKEN) {
  console.error('Error: DISCORD_TOKEN is missing in the .env file.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates
  ]
});


// Initialize Bot
client.once('clientReady', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}!`);
  
  // Set activity status
  client.user.setActivity('보스 젠 감시', { type: ActivityType.Watching });
  
  // Initialize Database
  try {
    await db.initDB();
    console.log('📦 Database tables initialized.');

    // Auto-reconnect to voice channel if configured
    const voiceChannelId = await db.getSetting('voice_channel');
    const voiceGuildId = await db.getSetting('voice_guild');
    if (voiceChannelId && voiceGuildId) {
      const guild = client.guilds.cache.get(voiceGuildId);
      if (guild) {
        joinVoiceChannel({
          channelId: voiceChannelId,
          guildId: voiceGuildId,
          adapterCreator: guild.voiceAdapterCreator,
        });
        console.log(`🔊 Automatically reconnected to voice channel: ${voiceChannelId}`);
      }
    }
  } catch (err) {
    console.error('Failed to initialize database or auto-reconnect to voice:', err);
    process.exit(1);
  }

  // Start background monitoring scheduler (runs every 10 seconds)
  setInterval(checkUpcomingSpawns, 10000);
});

// Helper: Parse time inputs like "14:30:15", "1430", "10분전", "10"
function parseTimeInput(timeStr) {
  if (!timeStr) return new Date();
  timeStr = timeStr.trim();

  // Case 1: "10분전" or "10분" or "10"
  if (/^\d+(분전|분)?$/.test(timeStr)) {
    const mins = parseInt(timeStr.match(/^\d+/)[0], 10);
    const date = new Date();
    date.setMinutes(date.getMinutes() - mins);
    date.setSeconds(0, 0); // Reset seconds for relative time
    return date;
  }

  // Case 2: Custom hh, mm, ss parse
  const { hh, mm, ss } = parseTimeString(timeStr);
  const date = new Date();
  date.setHours(hh, mm, ss, 0);

  // Timezone / Day rollover adjustment
  const now = new Date();
  if (date.getTime() - now.getTime() > 15 * 60 * 1000) {
    date.setDate(date.getDate() - 1);
  }
  return date;
}

// Helper: Parse future time inputs like "18:45:30", "1845"
function parseFutureTimeInput(timeStr) {
  if (!timeStr) throw new Error('시간을 입력해야 합니다.');
  timeStr = timeStr.trim();

  const { hh, mm, ss } = parseTimeString(timeStr);
  const date = new Date();
  date.setHours(hh, mm, ss, 0);

  // If parsed time is in the past by more than 15 minutes,
  // we assume the user refers to tomorrow's spawn.
  const now = new Date();
  if (date.getTime() - now.getTime() < -15 * 60 * 1000) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

// Helper: Parse HH MM SS variations
function parseTimeString(timeStr) {
  const normalized = timeStr.replace(/[\s:]+/g, ':');
  let hh, mm, ss = 0;

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(normalized)) {
    const parts = normalized.split(':');
    hh = parseInt(parts[0], 10);
    mm = parseInt(parts[1], 10);
    ss = parts[2] ? parseInt(parts[2], 10) : 0;
  } else if (/^\d{4}$/.test(timeStr)) {
    hh = parseInt(timeStr.substring(0, 2), 10);
    mm = parseInt(timeStr.substring(2, 4), 10);
    ss = 0;
  } else if (/^\d{6}$/.test(timeStr)) {
    hh = parseInt(timeStr.substring(0, 2), 10);
    mm = parseInt(timeStr.substring(2, 4), 10);
    ss = parseInt(timeStr.substring(4, 6), 10);
  } else {
    throw new Error('올바른 시간 형식이 아닙니다. (예: 14:30:15, 14 30, 143015)');
  }

  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) {
    throw new Error('시간 범위가 올바르지 않습니다. (시: 0~23, 분: 0~59, 초: 0~59)');
  }

  return { hh, mm, ss };
}

// Helper: Format Dates to localized string (오늘/내일/어제 HH:MM:SS)
function formatDateTime(dateVal) {
  if (!dateVal) return '기록 없음';
  const d = new Date(dateVal);
  
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const diffTime = targetDay - today;
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  let dayStr = '';
  if (diffDays === 0) dayStr = '오늘';
  else if (diffDays === 1) dayStr = '내일';
  else if (diffDays === -1) dayStr = '어제';
  else dayStr = `${d.getMonth() + 1}/${d.getDate()}`;

  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dayStr} ${hh}:${mm}:${ss}`;
}

// Helper: Format remaining cooldown time with seconds precision
function formatRemainingTime(dateVal) {
  if (!dateVal) return '-';
  const d = new Date(dateVal);
  const now = new Date();
  const diffMs = d - now;

  if (diffMs < 0) {
    const secsOver = Math.floor(Math.abs(diffMs) / 1000);
    const hh = Math.floor(secsOver / 3600);
    const mm = Math.floor((secsOver % 3600) / 60);
    const ss = secsOver % 60;

    if (secsOver < 60) return `젠 중 (${ss}초 초과)`;
    return hh > 0 ? `젠 중 (${hh}시간 ${mm}분 초과)` : `젠 중 (${mm}분 ${ss}초 초과)`;
  } else {
    const secsLeft = Math.floor(diffMs / 1000);
    const hh = Math.floor(secsLeft / 3600);
    const mm = Math.floor((secsLeft % 3600) / 60);
    const ss = secsLeft % 60;

    if (hh > 0) return `${hh}시간 ${mm}분 남음`;
    if (mm > 0) return `${mm}분 ${ss}초 남음`;
    return `${ss}초 남음`;
  }
}

// Helper: Autocomplete/partial search resolver for boss names
async function resolveBossName(inputName) {
  const bosses = await db.getBossList();
  
  // Exact match
  const exact = bosses.find(b => b.name === inputName);
  if (exact) return { boss: exact, matchType: 'exact' };

  // Partial match (input is contained in boss name)
  const matches = bosses.filter(b => b.name.includes(inputName));

  if (matches.length === 1) {
    return { boss: matches[0], matchType: 'partial' };
  } else if (matches.length > 1) {
    return { boss: null, matchType: 'multiple', matches: matches.map(b => b.name) };
  }

  return { boss: null, matchType: 'none' };
}

// Helper: Play TTS in a voice channel
let audioPlayer = null;

async function playTTS(guildId, channelId, text) {
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

    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=ko&client=tw-ob&q=${encodeURIComponent(text)}`;
    const resource = createAudioResource(ttsUrl);
    audioPlayer.play(resource);
  } catch (err) {
    console.error('Error in playTTS:', err);
  }
}

// Helper: Trigger voice TTS if channel is set
async function triggerVoiceTTS(bossName) {
  try {
    const channelId = await db.getSetting('voice_channel');
    const guildId = await db.getSetting('voice_guild');

    if (!channelId || !guildId) return;

    const text = `${bossName} 젠 5분 전입니다.`;
    await playTTS(guildId, channelId, text);
  } catch (err) {
    console.error('Failed to trigger voice TTS:', err);
  }
}

// Background scheduler: Check soon spawning bosses
async function checkUpcomingSpawns() {
  try {
    const channelId = await db.getSetting('notification_channel');
    if (!channelId) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const records = await db.getActiveNotifications();
    const now = new Date();

    for (const record of records) {
      const nextSpawn = new Date(record.next_spawn);
      const diffMs = nextSpawn - now;
      const diffMins = diffMs / 60000;

      // 10 minutes alert (10m >= remaining > 5m)
      if (diffMins <= 10 && diffMins > 5 && record.notified_10 === 0) {
        await channel.send(`📢 **${record.name}** 젠 10분 전! (예정 시간: ${formatDateTime(nextSpawn)}) @here`);
        await db.markNotified(record.name, '10');
      }
      // 5 minutes alert (5m >= remaining > 0m)
      else if (diffMins <= 5 && diffMins > 0 && record.notified_5 === 0) {
        await channel.send(`⚠️ **${record.name}** 젠 5분 전! (예정 시간: ${formatDateTime(nextSpawn)}) @here`);
        await db.markNotified(record.name, '5');
        await triggerVoiceTTS(record.name);
      }
      // Spawn alert (0m >= remaining > -10m)
      else if (diffMins <= 0 && diffMins > -10 && record.notified_0 === 0) {
        await channel.send(`⚔️ **${record.name}** 젠 시간입니다! 어서 처치하세요! @here`);
        await db.markNotified(record.name, '0');
      }
    }
  } catch (error) {
    console.error('Error in scheduler loop:', error);
  }
}

// Event: Interaction Command Router
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    // 1. UPDATE BOSS (Originally 보스수정)
    if (commandName === '보스수정') {
      const inputName = interaction.options.getString('이름').trim();
      const cooldownHours = interaction.options.getNumber('젠주기');
      const memo = interaction.options.getString('메모'); // may be undefined/null

      const res = await resolveBossName(inputName);
      if (res.matchType === 'none') {
        return interaction.reply({ content: `❌ 등록되지 않은 보스입니다: **${inputName}**`, ephemeral: true });
      } else if (res.matchType === 'multiple') {
        return interaction.reply({ content: `❌ 여러 보스가 검색되었습니다: **${res.matches.join(', ')}**. 더 명확히 입력해주세요.`, ephemeral: true });
      }

      const boss = res.boss;
      const cooldownMinutes = Math.round(cooldownHours * 60);
      const newMemo = memo !== null ? memo : boss.memo;

      await db.updateBoss(boss.name, cooldownMinutes, newMemo);
      broadcastSSE({ type: 'boss_updated' });
      await interaction.reply(`✅ 보스 **${boss.name}** 수정 완료!\n- 젠 주기: \`${cooldownHours}시간\`\n- 메모: \`${newMemo || '없음'}\``);
    }
    
    // 4. LIST BOSSES
    else if (commandName === '보스목록' || commandName === '보탐') {
      const list = await db.getBossList();
      if (list.length === 0) {
        return interaction.reply('등록된 보스가 없습니다. `/보스등록` 명령어로 보스를 먼저 등록해주세요.');
      }

      const embed = new EmbedBuilder()
        .setTitle('🗓️ 보스 젠 시간 현황')
        .setColor(0x00A3FF)
        .setTimestamp();

      let description = '';
      list.forEach((boss, index) => {
        const lastKillStr = formatDateTime(boss.last_kill);
        const nextSpawnStr = formatDateTime(boss.next_spawn);
        const remainingStr = formatRemainingTime(boss.next_spawn);
        const cooldownStr = `${(boss.cooldown / 60).toFixed(1)}시간`;

        description += `**${index + 1}. ${boss.name}** (${cooldownStr})\n`;
        description += `└ 마지막 컷: \`${lastKillStr}\` | 다음 젠: \`${nextSpawnStr}\`\n`;
        description += `└ 상태: **${remainingStr}**\n`;
        if (boss.memo) {
          description += `└ 메모: *${boss.memo}*\n`;
        }
        description += '\n';
      });

      embed.setDescription(description);
      await interaction.reply({ embeds: [embed] });
    }
    
    // 5. REPORT KILL
    else if (commandName === '컷') {
      const inputName = interaction.options.getString('이름').trim();
      const timeStr = interaction.options.getString('시간');

      const res = await resolveBossName(inputName);
      if (res.matchType === 'none') {
        return interaction.reply({ content: `❌ 등록되지 않은 보스입니다: **${inputName}**`, ephemeral: true });
      } else if (res.matchType === 'multiple') {
        return interaction.reply({ content: `❌ 여러 보스가 검색되었습니다: **${res.matches.join(', ')}**. 더 명확히 입력해주세요.`, ephemeral: true });
      }

      const boss = res.boss;
      let killTime;
      try {
        killTime = parseTimeInput(timeStr);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      }

      const nextSpawnTime = new Date(killTime.getTime() + boss.cooldown * 60 * 1000);
      await db.recordKill(boss.name, killTime, nextSpawnTime);
      broadcastSSE({ type: 'boss_updated' });

      const responseEmbed = new EmbedBuilder()
        .setTitle(`⚔️ ${boss.name} 컷 기록 완료`)
        .setColor(0xFF4500)
        .addFields(
          { name: '처치(컷) 시간', value: `\`${formatDateTime(killTime)}\``, inline: true },
          { name: '다음 젠 예정', value: `\`${formatDateTime(nextSpawnTime)}\``, inline: true },
          { name: '남은 시간', value: `\`${formatRemainingTime(nextSpawnTime)}\``, inline: false }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [responseEmbed] });
    }
    
    // 6. RECORD EXPLICIT SPAWN
    else if (commandName === '젠') {
      const inputName = interaction.options.getString('이름').trim();
      const timeStr = interaction.options.getString('시간');

      const res = await resolveBossName(inputName);
      if (res.matchType === 'none') {
        return interaction.reply({ content: `❌ 등록되지 않은 보스입니다: **${inputName}**`, ephemeral: true });
      } else if (res.matchType === 'multiple') {
        return interaction.reply({ content: `❌ 여러 보스가 검색되었습니다: **${res.matches.join(', ')}**. 더 명확히 입력해주세요.`, ephemeral: true });
      }

      const boss = res.boss;
      let nextSpawnTime;
      try {
        nextSpawnTime = parseFutureTimeInput(timeStr);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      }

      await db.recordSpawn(boss.name, nextSpawnTime);
      broadcastSSE({ type: 'boss_updated' });

      const responseEmbed = new EmbedBuilder()
        .setTitle(`🗓️ ${boss.name} 젠 예정 시간 지정`)
        .setColor(0xFFD700)
        .addFields(
          { name: '다음 젠 예정', value: `\`${formatDateTime(nextSpawnTime)}\``, inline: true },
          { name: '남은 시간', value: `\`${formatRemainingTime(nextSpawnTime)}\``, inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [responseEmbed] });
    }
    
    // 7. ROLLBACK KILL
    else if (commandName === '컷취소') {
      const inputName = interaction.options.getString('이름').trim();

      const res = await resolveBossName(inputName);
      if (res.matchType === 'none') {
        return interaction.reply({ content: `❌ 등록되지 않은 보스입니다: **${inputName}**`, ephemeral: true });
      } else if (res.matchType === 'multiple') {
        return interaction.reply({ content: `❌ 여러 보스가 검색되었습니다: **${res.matches.join(', ')}**. 더 명확히 입력해주세요.`, ephemeral: true });
      }

      const boss = res.boss;
      try {
        await db.rollbackRecord(boss.name);
        broadcastSSE({ type: 'boss_updated' });
        const updated = await db.getBoss(boss.name);
        
        const responseEmbed = new EmbedBuilder()
          .setTitle(`🔄 ${boss.name} 기록 취소 완료`)
          .setColor(0x808080)
          .setDescription(`최근 컷/젠 기록이 취소되고 이전 상태로 복구되었습니다.`)
          .addFields(
            { name: '복구된 다음 젠 예정', value: `\`${formatDateTime(updated.next_spawn)}\``, inline: true },
            { name: '남은 시간', value: `\`${formatRemainingTime(updated.next_spawn)}\``, inline: true }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [responseEmbed] });
      } catch (err) {
        await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      }
    }
    
    // 8. SET NOTIFICATION CHANNEL
    else if (commandName === '알림채널설정') {
      const channel = interaction.options.getChannel('채널') || interaction.channel;

      if (!channel.isTextBased()) {
        return interaction.reply({ content: '❌ 텍스트 채널만 알림 채널로 설정할 수 있습니다.', ephemeral: true });
      }

      await db.setSetting('notification_channel', channel.id);
      broadcastSSE({ type: 'settings_updated' });
      await interaction.reply(`✅ 보스 젠 알림 채널이 <#${channel.id}> (으)로 설정되었습니다.`);
    }
    
    // 9. CHECK NOTIFICATION CHANNEL
    else if (commandName === '알림채널확인') {
      const channelId = await db.getSetting('notification_channel');
      if (!channelId) {
        return interaction.reply('❌ 현재 설정된 알림 채널이 없습니다.\n`/알림채널설정` 명령어를 채널에서 입력해 알림 채널을 설정하세요.');
      }
      await interaction.reply(`📢 현재 설정된 보스 젠 알림 채널은 <#${channelId}> 입니다.`);
    }
    
    // 10. SET VOICE CHANNEL
    else if (commandName === '음성채널설정') {
      const channel = interaction.options.getChannel('채널') || interaction.member.voice?.channel;

      if (!channel) {
        return interaction.reply({ content: '❌ 먼저 음성 채널에 입장해 있거나 채널을 매개변수로 선택해 주세요.', ephemeral: true });
      }

      await db.setSetting('voice_channel', channel.id);
      await db.setSetting('voice_guild', interaction.guildId);
      broadcastSSE({ type: 'settings_updated' });

      try {
        joinVoiceChannel({
          channelId: channel.id,
          guildId: interaction.guildId,
          adapterCreator: interaction.guild.voiceAdapterCreator,
        });

        await interaction.reply(`✅ 보스 알림 음성 채널이 <#${channel.id}> (으)로 설정되었습니다.`);
        playTTS(interaction.guildId, channel.id, `보스 알림 음성 채널이 설정되었습니다.`);
      } catch (err) {
        console.error('Voice join error:', err);
        await interaction.reply({ content: `❌ 음성 채널 연결에 실패했습니다: ${err.message}`, ephemeral: true });
      }
    }

    // 11. CLEAR VOICE CHANNEL
    else if (commandName === '음성채널해제') {
      const connection = getVoiceConnection(interaction.guildId);
      if (connection) {
        connection.destroy();
      }

      await db.setSetting('voice_channel', null);
      await db.setSetting('voice_guild', null);
      broadcastSSE({ type: 'settings_updated' });

      await interaction.reply('✅ 음성 채널 설정이 해제되었으며 봇이 퇴장했습니다.');
    }
    
    // 12. GET DASHBOARD LINK
    else if (commandName === '대시보드') {
      const url = await db.getSetting('dashboard_url');
      if (!url) {
        return interaction.reply({
          content: '🌐 **화순봇 웹 대시보드 주소**\n아직 등록된 대시보드 주소가 없습니다.\n관리자 권한을 가진 분이 `/대시보드설정 [주소]` 명령어로 주소를 등록해 주세요!\n*(예시: `http://node1.dishost.kr:12345`)*'
        });
      }
      
      const embed = new EmbedBuilder()
        .setTitle('🌐 화순봇 웹 대시보드 바로가기')
        .setDescription(`아래 링크를 클릭하면 실시간 웹 대시보드로 이동합니다.\n\n👉 [**대시보드 링크 열기**](${url})`)
        .setColor(0x00A3FF)
        .setTimestamp();
        
      await interaction.reply({ embeds: [embed] });
    }

    // 13. SET DASHBOARD LINK
    else if (commandName === '대시보드설정') {
      let url = interaction.options.getString('주소').trim();
      
      if (!/^https?:\/\//i.test(url)) {
        url = 'http://' + url;
      }
      
      await db.setSetting('dashboard_url', url);
      broadcastSSE({ type: 'settings_updated' });
      
      await interaction.reply(`✅ 웹 대시보드 주소가 **${url}** (으)로 설정되었습니다.\n이제 서버 인원들이 \`/대시보드\` 명령어로 바로 접속할 수 있습니다.`);
    }
  } catch (error) {
    console.error('Error handling slash command:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ 명령어 처리 중 내부 오류가 발생했습니다. 로그를 확인하세요.', ephemeral: true });
    }
  }
});

// Express Web Server Initialization
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

// API: Get boss list
app.get('/api/bosses', async (req, res) => {
  try {
    const list = await db.getBossList();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get current settings
app.get('/api/settings', async (req, res) => {
  try {
    const channelId = await db.getSetting('notification_channel');
    let channelName = '';
    if (channelId) {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) channelName = channel.name;
    }
     res.json({
      notification_channel: channelId,
      notification_channel_name: channelName,
      voice_channel: await db.getSetting('voice_channel'),
      dashboard_url: await db.getSetting('dashboard_url')
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Add boss (Disabled to enforce only default 11 bosses)
app.post('/api/bosses', async (req, res) => {
  return res.status(403).json({ error: '새로운 보스 등록은 허용되지 않습니다.' });
});

// API: Edit boss
app.put('/api/bosses/:name', async (req, res) => {
  const { name } = req.params;
  const { cooldown, memo } = req.body;
  if (isNaN(cooldown) || cooldown <= 0) {
    return res.status(400).json({ error: '올바른 젠주기(0보다 큼)를 입력하세요.' });
  }
  try {
    const existing = await db.getBoss(name);
    if (!existing) {
      return res.status(404).json({ error: '존재하지 않는 보스입니다.' });
    }
    const cooldownMins = Math.round(cooldown * 60);
    await db.updateBoss(name, cooldownMins, memo !== undefined ? memo : existing.memo);
    broadcastSSE({ type: 'boss_updated' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Delete boss (Disabled to enforce only default 11 bosses)
app.delete('/api/bosses/:name', async (req, res) => {
  return res.status(403).json({ error: '보스 삭제는 허용되지 않습니다.' });
});

// API: Record Cut (Killed)
app.post('/api/cut', async (req, res) => {
  const { name, time } = req.body;
  try {
    const resolution = await resolveBossName(name);
    if (resolution.matchType === 'none') {
      return res.status(404).json({ error: `등록되지 않은 보스입니다: ${name}` });
    } else if (resolution.matchType === 'multiple') {
      return res.status(400).json({ error: `여러 보스가 매칭됩니다: ${resolution.matches.join(', ')}` });
    }

    const boss = resolution.boss;
    let killTime;
    try {
      killTime = parseTimeInput(time);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const nextSpawnTime = new Date(killTime.getTime() + boss.cooldown * 60 * 1000);
    await db.recordKill(boss.name, killTime, nextSpawnTime);

    // Send Discord message to notification channel
    const channelId = await db.getSetting('notification_channel');
    if (channelId) {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) {
        const responseEmbed = new EmbedBuilder()
          .setTitle(`⚔️ 웹에서 ${boss.name} 컷 기록 완료`)
          .setColor(0xFF4500)
          .addFields(
            { name: '처치(컷) 시간', value: `\`${formatDateTime(killTime)}\``, inline: true },
            { name: '다음 젠 예정', value: `\`${formatDateTime(nextSpawnTime)}\``, inline: true },
            { name: '남은 시간', value: `\`${formatRemainingTime(nextSpawnTime)}\``, inline: false }
          )
          .setTimestamp();
        await channel.send({ embeds: [responseEmbed] });
      }
    }

    broadcastSSE({ type: 'boss_updated' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Set explicit next spawn
app.post('/api/spawn', async (req, res) => {
  const { name, time } = req.body;
  try {
    const resolution = await resolveBossName(name);
    if (resolution.matchType === 'none') {
      return res.status(404).json({ error: `등록되지 않은 보스입니다: ${name}` });
    } else if (resolution.matchType === 'multiple') {
      return res.status(400).json({ error: `여러 보스가 매칭됩니다: ${resolution.matches.join(', ')}` });
    }

    const boss = resolution.boss;
    let nextSpawnTime;
    try {
      nextSpawnTime = parseFutureTimeInput(time);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    await db.recordSpawn(boss.name, nextSpawnTime);

    // Send Discord message
    const channelId = await db.getSetting('notification_channel');
    if (channelId) {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) {
        const responseEmbed = new EmbedBuilder()
          .setTitle(`🗓️ 웹에서 ${boss.name} 젠 예정 시간 지정`)
          .setColor(0xFFD700)
          .addFields(
            { name: '다음 젠 예정', value: `\`${formatDateTime(nextSpawnTime)}\``, inline: true },
            { name: '남은 시간', value: `\`${formatRemainingTime(nextSpawnTime)}\``, inline: true }
          )
          .setTimestamp();
        await channel.send({ embeds: [responseEmbed] });
      }
    }

    broadcastSSE({ type: 'boss_updated' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Rollback record
app.post('/api/rollback', async (req, res) => {
  const { name } = req.body;
  try {
    const resolution = await resolveBossName(name);
    if (resolution.matchType === 'none') {
      return res.status(404).json({ error: `등록되지 않은 보스입니다: ${name}` });
    } else if (resolution.matchType === 'multiple') {
      return res.status(400).json({ error: `여러 보스가 매칭됩니다: ${resolution.matches.join(', ')}` });
    }

    const boss = resolution.boss;
    await db.rollbackRecord(boss.name);
    const updated = await db.getBoss(boss.name);

    // Send Discord message
    const channelId = await db.getSetting('notification_channel');
    if (channelId) {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) {
        const responseEmbed = new EmbedBuilder()
          .setTitle(`🔄 웹에서 ${boss.name} 기록 취소 완료`)
          .setColor(0x808080)
          .setDescription(`최근 컷/젠 기록이 취소되고 이전 상태로 복구되었습니다.`)
          .addFields(
            { name: '복구된 다음 젠 예정', value: `\`${formatDateTime(updated.next_spawn)}\``, inline: true },
            { name: '남은 시간', value: `\`${formatRemainingTime(updated.next_spawn)}\``, inline: true }
          )
          .setTimestamp();
        await channel.send({ embeds: [responseEmbed] });
      }
    }

    broadcastSSE({ type: 'boss_updated' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Server-Sent Events for real-time dashboard sync
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientObj = { res };
  sseClients.push(clientObj);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== clientObj);
  });
});

// Start Express Web Server
app.listen(PORT, () => {
  console.log(`🌐 Web Dashboard server running on port ${PORT}`);
});

// Login Discord Bot
client.login(DISCORD_TOKEN);
