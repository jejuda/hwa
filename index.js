import { Client, GatewayIntentBits, EmbedBuilder, ActivityType } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection } from '@discordjs/voice';
import ffmpeg from 'ffmpeg-static';
import dotenv from 'dotenv';
import * as db from './database.js';

dotenv.config();

// Enforce FFmpeg binary path for voice transcoding
process.env.FFMPEG_PATH = ffmpeg;


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
  
  // Get current KST time
  const nowUTC = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const nowKST = new Date(nowUTC.getTime() + kstOffset);

  const targetKST = new Date(nowKST);
  targetKST.setUTCHours(hh, mm, ss, 0);

  // Timezone / Day rollover adjustment
  if (targetKST.getTime() - nowKST.getTime() > 15 * 60 * 1000) {
    targetKST.setUTCDate(targetKST.getUTCDate() - 1);
  }

  const targetUTC = new Date(targetKST.getTime() - kstOffset);
  return targetUTC;
}

// Helper: Parse future time inputs like "18:45:30", "1845"
function parseFutureTimeInput(timeStr) {
  if (!timeStr) throw new Error('시간을 입력해야 합니다.');
  timeStr = timeStr.trim();

  const { hh, mm, ss } = parseTimeString(timeStr);
  
  // Get current KST time
  const nowUTC = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const nowKST = new Date(nowUTC.getTime() + kstOffset);

  const targetKST = new Date(nowKST);
  targetKST.setUTCHours(hh, mm, ss, 0);

  // If parsed time is in the past by more than 15 minutes,
  // we assume the user refers to tomorrow's spawn.
  if (targetKST.getTime() - nowKST.getTime() < -15 * 60 * 1000) {
    targetKST.setUTCDate(targetKST.getUTCDate() + 1);
  }

  const targetUTC = new Date(targetKST.getTime() - kstOffset);
  return targetUTC;
}

// Helper: Parse HH MM SS variations
function parseTimeString(timeStr) {
  // Replace '시', '분', '초' with ':' and strip other non-digit, non-colon chars.
  const cleaned = timeStr.replace(/시|분|초/g, ':').replace(/[^0-9:]/g, '');
  const normalized = cleaned.replace(/:+/g, ':').replace(/^:|:$/g, '');
  let hh, mm, ss = 0;

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(normalized)) {
    const parts = normalized.split(':');
    hh = parseInt(parts[0], 10);
    mm = parseInt(parts[1], 10);
    ss = parts[2] ? parseInt(parts[2], 10) : 0;
  } else if (/^\d{4}$/.test(normalized)) {
    hh = parseInt(normalized.substring(0, 2), 10);
    mm = parseInt(normalized.substring(2, 4), 10);
    ss = 0;
  } else if (/^\d{6}$/.test(normalized)) {
    hh = parseInt(normalized.substring(0, 2), 10);
    mm = parseInt(normalized.substring(2, 4), 10);
    ss = parseInt(normalized.substring(4, 6), 10);
  } else {
    throw new Error('올바른 시간 형식이 아닙니다. (예: 14:30, 20:45, 1430, 20시 45분)');
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
  
  const kstOffset = 9 * 60 * 60 * 1000;
  const nowKST = new Date(Date.now() + kstOffset);
  const targetKST = new Date(d.getTime() + kstOffset);

  const today = new Date(nowKST.getUTCFullYear(), nowKST.getUTCMonth(), nowKST.getUTCDate());
  const targetDay = new Date(targetKST.getUTCFullYear(), targetKST.getUTCMonth(), targetKST.getUTCDate());

  const diffTime = targetDay - today;
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  let dayStr = '';
  if (diffDays === 0) dayStr = '오늘';
  else if (diffDays === 1) dayStr = '내일';
  else if (diffDays === -1) dayStr = '어제';
  else dayStr = `${targetKST.getUTCMonth() + 1}/${targetKST.getUTCDate()}`;

  const hh = String(targetKST.getUTCHours()).padStart(2, '0');
  const mm = String(targetKST.getUTCMinutes()).padStart(2, '0');
  const ss = String(targetKST.getUTCSeconds()).padStart(2, '0');
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

// Helper: Play custom voice announcement
async function announceVoice(text) {
  try {
    const channelId = await db.getSetting('voice_channel');
    const guildId = await db.getSetting('voice_guild');

    if (!channelId || !guildId) return;

    await playTTS(guildId, channelId, text);
  } catch (err) {
    console.error('Failed to play voice announcement:', err);
  }
}

// Helper: Send text message to notification channel
async function sendTextNotification(text) {
  try {
    const channelId = await db.getSetting('notification_channel');
    if (!channelId) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel) {
      await channel.send(text);
    }
  } catch (err) {
    console.error('Failed to send text notification:', err);
  }
}

// State trackers for hourly events
let lastShugo55Hour = -1;
let lastShugo00Hour = -1;
let lastRaid30Hour = -1;

// Background scheduler: Check soon spawning bosses
async function checkUpcomingSpawns() {
  try {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // 1. At 55 minutes: "슈고페스타 5분 남았습니다."
    if (currentMinute === 55 && lastShugo55Hour !== currentHour) {
      lastShugo55Hour = currentHour;
      await announceVoice("슈고페스타 5분 남았습니다.");
      await sendTextNotification("📢 **슈고페스타** 5분 남았습니다!");
    }

    // 2. At 0 minutes: "슈고페스타 시간입니다."
    if (currentMinute === 0 && lastShugo00Hour !== currentHour) {
      lastShugo00Hour = currentHour;
      await announceVoice("슈고페스타 시간입니다.");
      await sendTextNotification("🎉 **슈고페스타** 시간입니다!");
    }

    // 3. At 30 minutes: "습격 시간입니다."
    if (currentMinute === 30 && lastRaid30Hour !== currentHour) {
      lastRaid30Hour = currentHour;
      await announceVoice("습격 시간입니다.");
      await sendTextNotification("⚔️ **습격** 시간입니다!");
    }

    const channelId = await db.getSetting('notification_channel');
    if (!channelId) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const records = await db.getActiveNotifications();

    for (const record of records) {
      const nextSpawn = new Date(record.next_spawn);
      const diffMs = nextSpawn - now;
      const diffMins = diffMs / 60000;

      // 10 minutes alert (10m >= remaining > 5m)
      if (diffMins <= 10 && diffMins > 5 && record.notified_10 === 0) {
        await channel.send(`📢 **${record.name}** 젠 10분 전! (예정 시간: ${formatDateTime(nextSpawn)})`);
        await db.markNotified(record.name, '10');
      }
      // 5 minutes alert (5m >= remaining > 0m)
      else if (diffMins <= 5 && diffMins > 0 && record.notified_5 === 0) {
        await channel.send(`⚠️ **${record.name}** 젠 5분 전! (예정 시간: ${formatDateTime(nextSpawn)})`);
        await db.markNotified(record.name, '5');
        await triggerVoiceTTS(record.name);
      }
      // Spawn alert (0m >= remaining > -10m)
      else if (diffMins <= 0 && diffMins > -10 && record.notified_0 === 0) {
        await channel.send(`⚔️ **${record.name}** 출현했습니다! 어서 처치하세요!`);
        await db.markNotified(record.name, '0');
        await announceVoice(`${record.name} 출현했습니다.`);
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

      await interaction.reply('✅ 음성 채널 설정이 해제되었으며 봇이 퇴장했습니다.');
    }
  } catch (error) {
    console.error('Error handling slash command:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ 명령어 처리 중 내부 오류가 발생했습니다. 로그를 확인하세요.', ephemeral: true });
    }
  }
});

// Login Discord Bot
client.login(DISCORD_TOKEN);
