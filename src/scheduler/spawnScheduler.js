import { ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import * as db from '../../database.js';
import { getCurrentTime, formatDateTime } from '../utils/timeUtils.js';
import { announceVoice, triggerVoiceTTS } from '../services/voiceService.js';

// State trackers for hourly events
let lastShugo55Hour = -1;
let lastShugo00Hour = -1;
let lastRaid30Hour = -1;

// Global scheduler database cache variables
let cachedRecords = [];
let cachedNotificationChannel = null;
let lastCacheFetch = 0;

export function invalidateNotificationCache() {
  lastCacheFetch = 0;
}

export async function sendTextNotification(client, text) {
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

export async function checkUpcomingSpawns(client) {
  try {
    const now = getCurrentTime();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // 1. At 55 minutes: "슈고페스타 5분 남았습니다."
    if (currentMinute === 55 && lastShugo55Hour !== currentHour) {
      lastShugo55Hour = currentHour;
      await announceVoice(client, "슈고페스타 5분 남았습니다.");
      await sendTextNotification(client, "📢 **슈고페스타** 5분 남았습니다!");
    }

    // 2. At 0 minutes: "슈고페스타 시간입니다."
    if (currentMinute === 0 && lastShugo00Hour !== currentHour) {
      lastShugo00Hour = currentHour;
      await announceVoice(client, "슈고페스타 시간입니다.");
      await sendTextNotification(client, "🎉 **슈고페스타** 시간입니다!");
    }

    // 3. At 30 minutes: "습격 시간입니다."
    if (currentMinute === 30 && lastRaid30Hour !== currentHour) {
      lastRaid30Hour = currentHour;
      await announceVoice(client, "습격 시간입니다.");
      await sendTextNotification(client, "⚔️ **습격** 시간입니다!");
    }

    // Refresh database cache every 5 seconds
    const nowMs = Date.now();
    if (nowMs - lastCacheFetch > 5000 || cachedRecords.length === 0) {
      cachedRecords = await db.getActiveNotifications();
      cachedNotificationChannel = await db.getSetting('notification_channel');
      lastCacheFetch = nowMs;
    }

    if (!cachedNotificationChannel) return;

    const channel = await client.channels.fetch(cachedNotificationChannel).catch(() => null);
    if (!channel) return;

    for (const record of cachedRecords) {
      const nextSpawn = new Date(record.next_spawn);
      const diffMs = nextSpawn - now;
      const diffMins = diffMs / 60000;

      // 5 minutes alert (5m >= remaining > 0m)
      if (diffMins <= 5 && diffMins > 0 && record.notified_5 === 0) {
        record.notified_5 = 1;

        const cutButton = new ButtonBuilder()
          .setCustomId(`cut_${record.name}`)
          .setLabel(`${record.name} 컷 기록`)
          .setStyle(ButtonStyle.Danger)
          .setEmoji('⚔️');
        const row = new ActionRowBuilder().addComponents(cutButton);

        await channel.send({
          content: `⚠️ **${record.name}** 젠 5분 전! (예정 시간: ${formatDateTime(nextSpawn)})`,
          components: [row]
        });
        await db.markNotified(record.name, '5');
        await triggerVoiceTTS(client, record.name);
      }
      // Spawn alert (10 seconds remaining >= remaining > -10m)
      else if (diffMs <= 10000 && diffMs > -600000 && record.notified_0 === 0) {
        record.notified_0 = 1;

        const cutButton = new ButtonBuilder()
          .setCustomId(`cut_${record.name}`)
          .setLabel(`${record.name} 컷 기록`)
          .setStyle(ButtonStyle.Danger)
          .setEmoji('⚔️');
        const row = new ActionRowBuilder().addComponents(cutButton);

        await channel.send({
          content: `⚔️ **${record.name}** 곧 출현합니다!`,
          components: [row]
        });
        await db.markNotified(record.name, '0');
        await announceVoice(client, `${record.name} 곧 출현합니다.`);
      }
    }
  } catch (error) {
    console.error('Error in scheduler loop:', error);
  }
}
