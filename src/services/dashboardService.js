import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import * as db from '../../database.js';
import { getCurrentTime, formatDateTime, formatRemainingTime } from '../utils/timeUtils.js';
import { BOSS_LOCATIONS } from '../config/constants.js';

export async function buildDashboardPayload() {
  const list = await db.getBossList();
  const now = getCurrentTime();

  if (list.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('📊 [이스라펠] 실시간 보스 젠 전광판')
      .setDescription('등록된 보스가 없습니다.')
      .setColor(0x808080)
      .setTimestamp();
    return { embeds: [embed], components: [] };
  }

  const sortedList = [...list].sort((a, b) => {
    if (!a.next_spawn && !b.next_spawn) return a.name.localeCompare(b.name, 'ko');
    if (!a.next_spawn) return 1;
    if (!b.next_spawn) return -1;
    return new Date(a.next_spawn) - new Date(b.next_spawn);
  });

  const activeBosses = [];
  const staleBosses = [];
  const inactiveBosses = [];

  let hasSpawningNow = false;
  let hasImminent = false;

  for (const boss of sortedList) {
    if (!boss.next_spawn) {
      inactiveBosses.push(boss);
    } else {
      const diffMs = new Date(boss.next_spawn) - now;
      if (diffMs < -30 * 60 * 1000) {
        staleBosses.push(boss);
      } else {
        activeBosses.push(boss);
        if (diffMs <= 10000 && diffMs >= -30 * 60 * 1000) {
          hasSpawningNow = true;
        } else if (diffMs <= 5 * 60 * 1000 && diffMs > 0) {
          hasImminent = true;
        }
      }
    }
  }

  // Dynamic Theme Color: Red (Spawning) -> Orange/Yellow (Imminent <= 5m) -> Green (Normal)
  let embedColor = 0x00FF87; // Green
  if (hasSpawningNow) {
    embedColor = 0xFF3333; // Red
  } else if (hasImminent) {
    embedColor = 0xFFB800; // Orange
  }

  const embed = new EmbedBuilder()
    .setTitle('📊 [이스라펠] 실시간 보스 젠 전광판')
    .setColor(embedColor)
    .setFooter({ text: `notmeter.com 실시간 연동 • 20초 주기 자동 갱신 • 갱신: ${formatDateTime(now)}` });

  let description = '';

  if (activeBosses.length > 0) {
    description += '### ⏳ 출현 대기열 (남은 시간 순)\n';
    activeBosses.forEach((boss, index) => {
      const nextSpawnDate = new Date(boss.next_spawn);
      const nextSpawnStr = formatDateTime(boss.next_spawn);
      const remainingStr = formatRemainingTime(boss.next_spawn);
      const meta = BOSS_LOCATIONS[boss.name] || { region: '필드', location: '위치 정보 없음' };

      const diffMs = nextSpawnDate - now;
      let emoji = '⏰';
      if (diffMs <= 0) {
        emoji = '⚔️';
      } else if (diffMs <= 5 * 60 * 1000) {
        emoji = '⚠️';
      }

      let gapText = '';
      if (index < activeBosses.length - 1) {
        const next = activeBosses[index + 1];
        const gapMs = new Date(next.next_spawn) - nextSpawnDate;
        const gapSec = Math.max(0, Math.floor(gapMs / 1000));
        gapText = ` | 다음보스: \`+${gapSec}초\``;
      }

      description += `**${index + 1}. ${emoji} ${boss.name}** (${meta.region})\n`;
      description += `└ 상태: **${remainingStr}** | 예정: \`${nextSpawnStr}\`${gapText}\n`;
      description += `└ 위치: \`📍 ${meta.location}\`\n\n`;
    });
  }

  if (staleBosses.length > 0) {
    description += '### 💤 멍 / 장기 미출현 (30분 초과)\n';
    staleBosses.forEach(boss => {
      const remainingStr = formatRemainingTime(boss.next_spawn);
      const nextSpawnStr = formatDateTime(boss.next_spawn);
      description += `• **${boss.name}**: ${remainingStr} (예정: \`${nextSpawnStr}\`)\n`;
    });
    description += '\n';
  }

  if (inactiveBosses.length > 0) {
    description += '### ❔ 미등록 보스\n';
    const names = inactiveBosses.map(b => b.name).join(', ');
    description += `• ${names}\n\n`;
  }

  // Copyable summary line
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
    if (summaryText) summaryText += ` | (💤 멍: ${staleNames})`;
    else summaryText = `💤 멍: ${staleNames}`;
  }

  if (inactiveBosses.length > 0) {
    const inactiveNames = inactiveBosses.map(b => b.name).join(', ');
    if (summaryText) summaryText += ` | (미등록: ${inactiveNames})`;
    else summaryText = `미등록: ${inactiveNames}`;
  }

  if (summaryText) {
    description += `**✍️ 복사용 한줄 요약**\n\`${summaryText}\``;
  }

  embed.setDescription(description);

  // Action Buttons
  const row = new ActionRowBuilder();
  const refreshBtn = new ButtonBuilder()
    .setCustomId('dashboard_refresh')
    .setLabel('즉시 새로고침')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('🔄');
  row.addComponents(refreshBtn);

  if (activeBosses.length > 0) {
    const topBoss = activeBosses[0];
    const cutTopBtn = new ButtonBuilder()
      .setCustomId(`cut_${topBoss.name}`)
      .setLabel(`1순위 (${topBoss.name}) 컷`)
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⚔️');
    row.addComponents(cutTopBtn);
  }

  return { embeds: [embed], components: [row] };
}

export async function updateDashboard(client) {
  try {
    const channelId = await db.getSetting('dashboard_channel');
    const messageId = await db.getSetting('dashboard_message');

    if (!channelId || !messageId) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) {
      // Message deleted, clear setting
      await db.setSetting('dashboard_message', null);
      return;
    }

    const payload = await buildDashboardPayload();
    await message.edit(payload);
  } catch (err) {
    console.error('Error updating live dashboard:', err);
  }
}

export async function createDashboard(client, channel) {
  const payload = await buildDashboardPayload();
  const message = await channel.send(payload);
  
  // Try pinning message
  await message.pin().catch(() => {});

  await db.setSetting('dashboard_channel', channel.id);
  await db.setSetting('dashboard_message', message.id);

  return message;
}

export async function deleteDashboard(client) {
  const channelId = await db.getSetting('dashboard_channel');
  const messageId = await db.getSetting('dashboard_message');

  if (channelId && messageId) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel) {
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (message) {
        await message.delete().catch(() => {});
      }
    }
  }

  await db.setSetting('dashboard_channel', null);
  await db.setSetting('dashboard_message', null);
}
