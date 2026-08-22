import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { joinVoiceChannel, getVoiceConnection } from '@discordjs/voice';
import dotenv from 'dotenv';

import * as db from './database.js';
import {
  syncGoogleTime,
  getCurrentTime,
  parseTimeInput,
  parseFutureTimeInput,
  parseRemainingTime,
  formatDateTime,
  formatRemainingTime
} from './src/utils/timeUtils.js';
import { resolveBossName } from './src/utils/bossUtils.js';
import {
  checkUpcomingSpawns,
  invalidateNotificationCache
} from './src/scheduler/spawnScheduler.js';
import { syncNotMeterData } from './src/services/notmeterService.js';
import { parseBossTimesFromOCR } from './src/services/ocrService.js';

dotenv.config();

const { DISCORD_TOKEN } = process.env;

if (!DISCORD_TOKEN) {
  console.error('Error: DISCORD_TOKEN is missing in the .env file.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// Event: Client Ready
client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}!`);
  
  await syncGoogleTime();

  try {
    await db.initDB();
    console.log('📦 Database tables initialized.');

    // Auto-reconnect to saved voice channel if exists
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

  // Start background monitoring scheduler (runs every 1 second for 1-second precision)
  setInterval(() => checkUpcomingSpawns(client), 1000);

  // Start NotMeter Auto-Sync Poller (runs every 60 seconds with ETag/304 caching)
  setInterval(async () => {
    try {
      const autoSyncSetting = await db.getSetting('auto_sync_notmeter');
      if (autoSyncSetting !== 'off') {
        await syncNotMeterData();
      }
    } catch (err) {
      // Silently handle periodic network fetch errors
    }
  }, 60 * 1000);

  // Initial sync on startup
  (async () => {
    try {
      const autoSyncSetting = await db.getSetting('auto_sync_notmeter');
      if (autoSyncSetting !== 'off') {
        console.log('🔄 Initializing NotMeter auto-sync on startup...');
        const res = await syncNotMeterData();
        console.log(`✅ NotMeter initial auto-sync completed (${res.updated.length} bosses updated).`);
      }
    } catch (err) {
      console.warn('⚠️ NotMeter initial sync warning:', err.message);
    }
  })();
});

// Event: Interaction Command & Button Router
client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    const customId = interaction.customId;
    if (customId.startsWith('cut_')) {
      const bossName = customId.substring(4);
      try {
        const boss = await db.getBoss(bossName);
        if (!boss) {
          return interaction.reply({ content: `❌ 보스 정보를 찾을 수 없습니다: **${bossName}**`, ephemeral: true });
        }

        const killTime = getCurrentTime();
        const nextSpawnTime = new Date(killTime.getTime() + boss.cooldown * 60 * 1000);
        
        await db.recordKill(boss.name, killTime, nextSpawnTime);
        invalidateNotificationCache();

        const responseEmbed = new EmbedBuilder()
          .setTitle(`⚔️ ${boss.name} 컷 기록 완료 (버튼 클릭)`)
          .setColor(0xFF4500)
          .addFields(
            { name: '처치(컷) 시간', value: `\`${formatDateTime(killTime)}\``, inline: true },
            { name: '다음 젠 예정', value: `\`${formatDateTime(nextSpawnTime)}\``, inline: true },
            { name: '남은 시간', value: `\`${formatRemainingTime(nextSpawnTime)}\``, inline: false }
          )
          .setFooter({ text: `${interaction.user.tag} 님이 컷 버튼을 클릭했습니다.` })
          .setTimestamp();

        await interaction.reply({ embeds: [responseEmbed] });
      } catch (err) {
        console.error('Error recording kill from button:', err);
        await interaction.reply({ content: `❌ 컷 기록 중 오류 발생: ${err.message}`, ephemeral: true });
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    // 1. UPDATE BOSS (/보스수정)
    if (commandName === '보스수정') {
      const inputName = interaction.options.getString('이름').trim();
      const cooldownHours = interaction.options.getNumber('젠주기');
      const memo = interaction.options.getString('메모');

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
    
    // 2. LIST BOSSES (/보스목록, /보탐)
    else if (commandName === '보스목록' || commandName === '보탐') {
      const list = await db.getBossList();
      if (list.length === 0) {
        return interaction.reply('등록된 보스가 없습니다.');
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
    
    // 3. LIST BOSSES ORDERED BY SPAWN TIME (/보스순서)
    else if (commandName === '보스순서') {
      const list = await db.getBossList();
      if (list.length === 0) {
        return interaction.reply('등록된 보스가 없습니다.');
      }

      const now = getCurrentTime();

      const sortedList = [...list].sort((a, b) => {
        if (!a.next_spawn && !b.next_spawn) return a.name.localeCompare(b.name, 'ko');
        if (!a.next_spawn) return 1;
        if (!b.next_spawn) return -1;

        const aTime = new Date(a.next_spawn);
        const bTime = new Date(b.next_spawn);
        return aTime - bTime;
      });

      const embed = new EmbedBuilder()
        .setTitle('⏳ 보스 출현 순서 (남은 시간 순)')
        .setColor(0x00FF87)
        .setTimestamp();

      let description = '';
      sortedList.forEach((boss, index) => {
        const nextSpawnStr = formatDateTime(boss.next_spawn);
        const remainingStr = formatRemainingTime(boss.next_spawn);
        
        let emoji = '⏰';
        let statusText = '';

        if (!boss.next_spawn) {
          emoji = '❔';
          statusText = '기록 없음';
        } else {
          const diffMs = new Date(boss.next_spawn) - now;
          const isOver = diffMs <= 0;
          const minsOver = Math.floor(Math.abs(diffMs) / 60000);

          if (isOver) {
            if (minsOver >= 30) {
              emoji = '💤';
              statusText = `**${remainingStr}**`;
            } else {
              emoji = '⚔️';
              statusText = `**${remainingStr}**`;
            }
          } else {
            emoji = '⏰';
            statusText = `${remainingStr}`;
          }
        }

        let gapText = '';
        if (boss.next_spawn && index < sortedList.length - 1) {
          const nextBoss = sortedList[index + 1];
          if (nextBoss && nextBoss.next_spawn) {
            const gapMs = new Date(nextBoss.next_spawn) - new Date(boss.next_spawn);
            const gapSec = Math.max(0, Math.floor(gapMs / 1000));
            gapText = ` | 다음보스까지: \`+${gapSec}초\``;
          }
        }

        description += `**${index + 1}. ${emoji} ${boss.name}**\n`;
        if (boss.next_spawn) {
          description += `└ 상태: ${statusText} | 예정: \`${nextSpawnStr}\`${gapText}\n`;
        } else {
          description += `└ 상태: \`${statusText}\`\n`;
        }
        description += '\n';
      });

      // Split active (upcoming / spawning within 30m) vs stale (멍 >= 30m) vs inactive
      const activeBosses = [];
      const staleBosses = [];
      const inactiveBosses = [];

      for (const b of sortedList) {
        if (!b.next_spawn) {
          inactiveBosses.push(b);
        } else {
          const diffMs = new Date(b.next_spawn) - now;
          if (diffMs < -30 * 60 * 1000) {
            staleBosses.push(b);
          } else {
            activeBosses.push(b);
          }
        }
      }

      let summaryText = '';
      if (activeBosses.length > 0) {
        const parts = [];
        for (let i = 0; i < activeBosses.length; i++) {
          const current = activeBosses[i];
          if (i < activeBosses.length - 1) {
            const next = activeBosses[i + 1];
            const gapMs = new Date(next.next_spawn) - new Date(current.next_spawn);
            const gapSec = Math.max(0, Math.floor(gapMs / 1000));
            parts.push(`${current.name} (+${gapSec}초)`);
          } else {
            parts.push(current.name);
          }
        }
        summaryText = parts.join(' ➡️ ');
      }
      
      if (staleBosses.length > 0) {
        const staleNames = staleBosses.map(b => b.name).join(', ');
        if (summaryText) {
          summaryText += ` | (💤 멍: ${staleNames})`;
        } else {
          summaryText = `💤 멍: ${staleNames}`;
        }
      }

      if (inactiveBosses.length > 0) {
        const inactiveNames = inactiveBosses.map(b => b.name).join(', ');
        if (summaryText) {
          summaryText += ` | (미등록: ${inactiveNames})`;
        } else {
          summaryText = `미등록: ${inactiveNames}`;
        }
      }

      description += `**✍️ 복사용 한줄 요약**\n\`${summaryText}\``;

      embed.setDescription(description);
      await interaction.reply({ embeds: [embed] });
    }
    
    // 4. REPORT KILL (/컷)
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
      invalidateNotificationCache();

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
    
    // 5. RECORD EXPLICIT SPAWN (/젠)
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

      const remainingMins = parseRemainingTime(timeStr);
      if (remainingMins !== null) {
        const now = getCurrentTime();
        nextSpawnTime = new Date(now.getTime() + remainingMins * 60 * 1000);
      } else {
        try {
          nextSpawnTime = parseFutureTimeInput(timeStr);
        } catch (err) {
          return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
        }
      }

      await db.recordSpawn(boss.name, nextSpawnTime);
      invalidateNotificationCache();

      const responseEmbed = new EmbedBuilder()
        .setTitle(`⏰ ${boss.name} 다음 젠 시간 등록 완료`)
        .setColor(0x00FF00)
        .addFields(
          { name: '다음 젠 예정', value: `\`${formatDateTime(nextSpawnTime)}\``, inline: true },
          { name: '남은 시간', value: `\`${formatRemainingTime(nextSpawnTime)}\``, inline: false }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [responseEmbed] });
    }
    
    // 6. ROLLBACK RECORD (/컷취소)
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
        invalidateNotificationCache();

        const updatedBoss = await db.getBoss(boss.name);
        const lastKillStr = formatDateTime(updatedBoss.last_kill);
        const nextSpawnStr = formatDateTime(updatedBoss.next_spawn);
        const remainingStr = formatRemainingTime(updatedBoss.next_spawn);

        const responseEmbed = new EmbedBuilder()
          .setTitle(`↩️ ${boss.name} 기록 취소(롤백) 완료`)
          .setColor(0xFFA500)
          .setDescription(`최근 입력된 **${boss.name}**의 기록을 취소하고 이전 상태로 되돌렸습니다.`)
          .addFields(
            { name: '복구된 마지막 컷', value: `\`${lastKillStr}\``, inline: true },
            { name: '복구된 다음 젠', value: `\`${nextSpawnStr}\``, inline: true },
            { name: '남은 시간', value: `\`${remainingStr}\``, inline: false }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [responseEmbed] });
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      }
    }
    
    // 7. SET NOTIFICATION CHANNEL (/알림채널설정)
    else if (commandName === '알림채널설정') {
      const channel = interaction.options.getChannel('채널') || interaction.channel;
      await db.setSetting('notification_channel', channel.id);
      invalidateNotificationCache();

      await interaction.reply(`📢 보스 젠 알림 채널이 <#${channel.id}> (으)로 설정되었습니다.`);
    }

    // 8. VIEW NOTIFICATION CHANNEL (/알림채널확인)
    else if (commandName === '알림채널확인') {
      const channelId = await db.getSetting('notification_channel');
      if (channelId) {
        await interaction.reply(`현재 설정된 알림 채널은 <#${channelId}> 입니다.`);
      } else {
        await interaction.reply('설정된 알림 채널이 없습니다. `/알림채널설정` 명령어로 설정해주세요.');
      }
    }

    // 9. SET VOICE CHANNEL (/음성채널설정)
    else if (commandName === '음성채널설정') {
      let voiceChannel = interaction.options.getChannel('채널');

      if (!voiceChannel) {
        const memberVoice = interaction.member.voice;
        if (!memberVoice || !memberVoice.channel) {
          return interaction.reply({ content: '❌ 음성 채널을 옵션으로 지정하거나, 먼저 음성 채널에 입장한 후 명령어를 실행해주세요.', ephemeral: true });
        }
        voiceChannel = memberVoice.channel;
      }

      await db.setSetting('voice_channel', voiceChannel.id);
      await db.setSetting('voice_guild', interaction.guildId);

      joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });

      await interaction.reply(`🔊 음성 알림 채널이 <#${voiceChannel.id}> (으)로 설정되었습니다. 봇이 채널에 입장했습니다.`);
    }

    // 10. LEAVE VOICE CHANNEL (/음성채널해제)
    else if (commandName === '음성채널해제') {
      const connection = getVoiceConnection(interaction.guildId);
      if (connection) {
        connection.destroy();
      }

      await db.setSetting('voice_channel', null);
      await db.setSetting('voice_guild', null);

      await interaction.reply('🔇 음성 알림 채널 설정이 해제되었으며 봇이 퇴장했습니다.');
    }

    // 11. SCREENSHOT OCR ANALYZE (/분석)
    else if (commandName === '분석') {
      const attachment = interaction.options.getAttachment('이미지');
      if (!attachment) {
        return interaction.reply({ content: '❌ 분석할 이미지를 업로드해주세요.', ephemeral: true });
      }

      const isImage = attachment.contentType && attachment.contentType.startsWith('image/');
      if (!isImage) {
        return interaction.reply({ content: '❌ 업로드된 파일이 이미지 형식이 아닙니다.', ephemeral: true });
      }

      await interaction.deferReply();

      const apiKey = process.env.OCR_SPACE_API_KEY || 'K87899148788957';

      try {
        const formData = new FormData();
        formData.append('apikey', apiKey);
        formData.append('language', 'kor');
        formData.append('url', attachment.url);
        formData.append('isOverlayRequired', 'false');

        const ocrRes = await fetch('https://api.ocr.space/parse/image', {
          method: 'POST',
          body: formData
        });

        if (!ocrRes.ok) {
          throw new Error(`HTTP error! status: ${ocrRes.status}`);
        }

        const ocrData = await ocrRes.json();

        if (ocrData.IsErroredOnProcessing || !ocrData.ParsedResults || ocrData.ParsedResults.length === 0) {
          const errMsg = ocrData.ErrorMessage ? ocrData.ErrorMessage.join(', ') : '이미지 처리 실패';
          return interaction.editReply(`❌ 이미지 분석 중 오류가 발생했습니다: ${errMsg}`);
        }

        const parsedText = ocrData.ParsedResults[0].ParsedText || '';
        const parsedBosses = await parseBossTimesFromOCR(parsedText);

        if (parsedBosses.length === 0) {
          return interaction.editReply('❌ 이미지에서 등록된 보스의 이름과 남은 시간을 찾지 못했습니다.');
        }

        const responseEmbed = new EmbedBuilder()
          .setTitle('📸 스크린샷 시간 분석 완료')
          .setColor(0x00FF00)
          .setTimestamp();

        let descText = '';

        for (const item of parsedBosses) {
          const { boss, remainingMinutes, matchedText } = item;
          const nextSpawnTime = new Date(getCurrentTime().getTime() + remainingMinutes * 60 * 1000);
          const estimatedKillTime = new Date(nextSpawnTime.getTime() - boss.cooldown * 60 * 1000);

          await db.recordKill(boss.name, estimatedKillTime, nextSpawnTime);

          descText += `**⚔️ ${boss.name}** (${matchedText} 감지)\n` +
                      `└ 처치 시각 (추정): \`${formatDateTime(estimatedKillTime)}\`\n` +
                      `└ 다음 젠 예정: \`${formatDateTime(nextSpawnTime)}\`\n` +
                      `└ 남은 시간: \`${formatRemainingTime(nextSpawnTime)}\`\n\n`;
        }

        invalidateNotificationCache();

        responseEmbed.setDescription(descText);
        await interaction.editReply({ embeds: [responseEmbed] });

      } catch (err) {
        console.error('OCR analyze error:', err);
        await interaction.editReply(`❌ 분석 중 오류가 발생했습니다: ${err.message}`);
      }
    }

    // 12. NOTMETER AUTO SYNC (/자동동기화)
    else if (commandName === '자동동기화') {
      const action = interaction.options.getString('동작');

      if (action === 'on') {
        await db.setSetting('auto_sync_notmeter', 'on');
        await interaction.deferReply();
        try {
          const res = await syncNotMeterData({ force: true, manual: true });
          const embed = new EmbedBuilder()
            .setTitle('🟢 NotMeter 실시간 자동 동기화 활성화')
            .setColor(0x00FF87)
            .setDescription(`**이스라펠 / 알트가르드 11종 보스**의 실시간 데이터 연동이 **켜졌습니다.**\n` +
                            `└ **1분 주기**로 최신 젠 시간이 자동 갱신됩니다.\n` +
                            `└ 즉시 동기화 결과: **${res.updated.length}개** 보스 시간 갱신 완료`)
            .setFooter({ text: 'notmeter.com 실시간 연동 (ETag HTTP 캐싱 적용)' })
            .setTimestamp();
          await interaction.editReply({ embeds: [embed] });
        } catch (err) {
          await interaction.editReply(`🟢 자동 동기화가 활성화되었으나 즉시 갱신 중 오류가 발생했습니다: ${err.message}`);
        }
      } 
      else if (action === 'off') {
        await db.setSetting('auto_sync_notmeter', 'off');
        const embed = new EmbedBuilder()
          .setTitle('🔴 NotMeter 실시간 자동 동기화 비활성화')
          .setColor(0xFF5555)
          .setDescription(`자동 동기화가 **꺼졌습니다.**\n` +
                          `└ 이제 사이트 데이터가 자동 반영되지 않으며, **수동 /컷 및 /젠 모드**로 동작합니다.`)
          .setFooter({ text: 'notmeter.com 실시간 연동' })
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }
      else if (action === 'status') {
        const autoSyncSetting = await db.getSetting('auto_sync_notmeter');
        const isEnabled = autoSyncSetting !== 'off';
        const lastSync = await db.getSetting('last_notmeter_sync');
        const lastSyncStr = lastSync ? formatDateTime(lastSync) : '기록 없음';

        const embed = new EmbedBuilder()
          .setTitle('📊 NotMeter 자동 동기화 설정 상태')
          .setColor(isEnabled ? 0x00FF87 : 0xFFA500)
          .addFields(
            { name: '연동 상태', value: isEnabled ? '🟢 **켜짐 (1분 주기 자동 갱신 중)**' : '🔴 **꺼짐 (수동 관리 모드)**', inline: true },
            { name: '대상 서버 / 지역', value: '이스라펠 / 알트가르드 (11종 보스)', inline: true },
            { name: '최근 동기화 시각', value: `\`${lastSyncStr}\``, inline: false }
          )
          .setFooter({ text: 'notmeter.com 실시간 연동 (ETag HTTP 캐싱 적용)' })
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }
      else if (action === 'sync_now') {
        await interaction.deferReply();
        try {
          const res = await syncNotMeterData({ force: true, manual: true });
          const embed = new EmbedBuilder()
            .setTitle('🔄 NotMeter 실시간 데이터 즉시 동기화 완료')
            .setColor(0x00FF87)
            .setTimestamp();

          if (res.updated.length === 0) {
            embed.setDescription(`모든 보스가 이미 최신 시간과 일치하여 갱신할 항목이 없습니다.`);
          } else {
            let desc = `**총 ${res.updated.length}개 보스 갱신 완료:**\n\n`;
            res.updated.forEach(u => {
              desc += `**⚔️ ${u.name}**\n` +
                      `└ 예정: \`${formatDateTime(u.nextSpawn)}\` (${formatRemainingTime(u.nextSpawn)})\n`;
            });
            embed.setDescription(desc);
          }
          await interaction.editReply({ embeds: [embed] });
        } catch (err) {
          await interaction.editReply(`❌ 즉시 동기화 실패: ${err.message}`);
        }
      }
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
