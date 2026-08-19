import { Client, GatewayIntentBits, EmbedBuilder, ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection } from '@discordjs/voice';
import ffmpeg from 'ffmpeg-static';
import dotenv from 'dotenv';
import * as db from './database.js';
import { Communicate } from 'edge-tts-universal';
import { Readable } from 'stream';
import https from 'https';

dotenv.config();

// Enforce FFmpeg binary path for voice transcoding
process.env.FFMPEG_PATH = ffmpeg;

// Time synchronization variables and helpers to handle hosting provider clock drift
let timeOffset = 0;

async function syncTime() {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const req = https.request('https://www.google.com', { method: 'HEAD' }, (res) => {
      const serverDateStr = res.headers.date;
      if (serverDateStr) {
        const endTime = Date.now();
        const latency = (endTime - startTime) / 2;
        const serverTime = new Date(serverDateStr).getTime() + latency;
        const localTime = endTime;
        timeOffset = serverTime - localTime;
        console.log(`⏰ Time synchronized with Google. Offset: ${timeOffset}ms (Latency: ${latency}ms)`);
      }
      resolve();
    });
    req.on('error', (err) => {
      console.error('Failed to sync time:', err.message);
      resolve();
    });
    req.end();
  });
}

function getCurrentTime() {
  return new Date(Date.now() + timeOffset);
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
  
  // Sync time on startup
  await syncTime();
  // Keep time synced every 30 minutes
  setInterval(syncTime, 30 * 60 * 1000);
  
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

  // Start background monitoring scheduler (runs every 1 second for 1-second precision)
  setInterval(checkUpcomingSpawns, 1000);
});

// Helper: Parse time inputs like "14:30:15", "1430", "10분전", "10"
function parseTimeInput(timeStr) {
  if (!timeStr) return getCurrentTime();
  timeStr = timeStr.trim();

  // Case 1: "10분전" or "10분" or "10"
  if (/^\d+(분전|분)?$/.test(timeStr)) {
    const mins = parseInt(timeStr.match(/^\d+/)[0], 10);
    const date = getCurrentTime();
    date.setMinutes(date.getMinutes() - mins);
    date.setSeconds(0, 0); // Reset seconds for relative time
    return date;
  }

  // Case 2: Custom hh, mm, ss parse
  const { hh, mm, ss } = parseTimeString(timeStr);
  
  // Get current KST time
  const nowUTC = getCurrentTime();
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
  const nowUTC = getCurrentTime();
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
  const numbers = timeStr.match(/\d+/g);
  if (!numbers) {
    throw new Error('올바른 시간 형식이 아닙니다. (예: 14:30, 20:45:30, 20시 45분 30초, 204530)');
  }

  let hh, mm, ss = 0;

  if (numbers.length === 2) {
    hh = parseInt(numbers[0], 10);
    mm = parseInt(numbers[1], 10);
    ss = 0;
  } else if (numbers.length === 3) {
    hh = parseInt(numbers[0], 10);
    mm = parseInt(numbers[1], 10);
    ss = parseInt(numbers[2], 10);
  } else if (numbers.length === 1) {
    const numStr = numbers[0];
    if (numStr.length === 4) {
      hh = parseInt(numStr.substring(0, 2), 10);
      mm = parseInt(numStr.substring(2, 4), 10);
      ss = 0;
    } else if (numStr.length === 6) {
      hh = parseInt(numStr.substring(0, 2), 10);
      mm = parseInt(numStr.substring(2, 4), 10);
      ss = parseInt(numStr.substring(4, 6), 10);
    } else {
      throw new Error('올바른 시간 형식이 아닙니다. (예: 14:30, 20:45:30, 20시 45분 30초, 204530)');
    }
  } else {
    throw new Error('올바른 시간 형식이 아닙니다. (예: 14:30, 20:45:30, 20시 45분 30초, 204530)');
  }

  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) {
    throw new Error('시간 범위가 올바르지 않습니다. (시: 0~23, 분: 0~59, 초: 0~59)');
  }

  return { hh, mm, ss };
}

// Helper: Parse remaining time like "30분남음", "30", "1시간 30분", "30분 20초 남음"
function parseRemainingTime(timeStr) {
  const cleaned = timeStr.replace(/\s+/g, '');
  
  // If the input explicitly includes "남음", parse it as remaining time.
  const isExplicitRemaining = cleaned.includes('남음');
  
  if (isExplicitRemaining) {
    // Check if it has colons (e.g. 1:35:40남음 or 1:30남음)
    const colonStr = cleaned.replace('남음', '');
    if (colonStr.includes(':')) {
      const parts = colonStr.split(':');
      let totalSeconds = 0;
      if (parts.length === 3) {
        // HH:MM:SS
        const hours = parseInt(parts[0], 10) || 0;
        const mins = parseInt(parts[1], 10) || 0;
        const secs = parseInt(parts[2], 10) || 0;
        totalSeconds = hours * 3600 + mins * 60 + secs;
      } else if (parts.length === 2) {
        // HH:MM
        const hours = parseInt(parts[0], 10) || 0;
        const mins = parseInt(parts[1], 10) || 0;
        totalSeconds = hours * 3600 + mins * 60;
      }
      return totalSeconds / 60;
    }

    let totalSeconds = 0;
    
    // Find hours (시 or 시간)
    const hourMatch = cleaned.match(/(\d+)(시|시간)/);
    if (hourMatch) {
      totalSeconds += parseInt(hourMatch[1], 10) * 3600;
    }
    
    // Find minutes (분)
    const minMatch = cleaned.match(/(\d+)분/);
    if (minMatch) {
      totalSeconds += parseInt(minMatch[1], 10) * 60;
    }
    
    // Find seconds (초)
    const secMatch = cleaned.match(/(\d+)초/);
    if (secMatch) {
      totalSeconds += parseInt(secMatch[1], 10);
    }
    
    // Fallback if just digits were supplied with "남음" (e.g. "30남음")
    if (totalSeconds === 0) {
      const digitMatch = cleaned.match(/(\d+)/);
      if (digitMatch) {
        totalSeconds = parseInt(digitMatch[1], 10) * 60;
      }
    }
    
    return totalSeconds / 60;
  }
  
  // Pattern 1: X시간 Y분
  const hourMinMatch = cleaned.match(/^(\d+)시간(\d+)분?$/);
  if (hourMinMatch) {
    const hours = parseInt(hourMinMatch[1], 10);
    const mins = parseInt(hourMinMatch[2], 10);
    return hours * 60 + mins;
  }
  
  // Pattern 2: X시간
  const hourMatch = cleaned.match(/^(\d+)시간$/);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1], 10);
    return hours * 60;
  }
  
  // Pattern 3: Y분
  const minMatch = cleaned.match(/^(\d+)분$/);
  if (minMatch) {
    return parseInt(minMatch[1], 10);
  }
  
  // Pattern 4: just digits (length < 3)
  if (/^\d+$/.test(cleaned)) {
    if (cleaned.length < 3) {
      return parseInt(cleaned, 10);
    }
  }
  
  return null;
}

// Helper: Get typo-tolerant regex for default bosses
function getBossRegex(name) {
  switch (name) {
    case '노블루드': return /노[블불믈]루드?/i;
    case '악시오스': return /[악약안아액와]시[오으우]스/i;
    case '바르시엔': return /바르시[엔연온]/i;
    case '구루타': return /구[루로]타/i;
    case '카루카': return /[카가][루로][카가]/i;
    case '비슈베다': return /비[슈수][베배]다?/i;
    case '쉬라크': return /[쉬휘]라[크그]/i;
    case '타르탄': return /[타따티][르트][탄틴단탈만]?/i;
    case '카샤파': return /카[샤사]파/i;
    case '라그타': return /라그[타태터토]?/i;
    case '가르투아': return /가[르루]투아?/i;
    case '하디룬': return /하디[룬문]/i;
    case '라지트': return /라지[트특]?/i;
    case '다나르': return /다나[르루]?/i;
    case '발그': return /발[그극]?/i;
    case '야메드': return /야메[드득]?/i;
    case '링크스': return /링크[스]?/i;
    case '트사나': return /[트]?사나/i;
    case '캘피나': return /캘피[나]?/i;
    case '트리드': return /트리[드득]?/i;
    case '란나르': return /란나르?/i;
    case '가르산': return /가르[산삼상사]/i;
    case '누타': return /누타/i;
    default: return new RegExp(name, 'i');
  }
}

// Helper: Parse boss names and remaining times from OCR text
async function parseBossTimesFromOCR(text) {
  const bosses = await db.getBossList(); // Get all bosses from db
  
  // Normalize OCR time unit misreadings globally before space stripping to keep formatting intact
  let normalizedText = text
    .replace(/(?:Al간|`l간|1간)/gi, '시간')
    .replace(/문/gi, '분')
    .replace(/\*/g, '초')
    .replace(/조/g, '초')
    .replace(/소진/g, '초전')
    .replace(/소\s*진/g, '초전')
    .replace(/소/g, '초')
    .replace(/진/g, '전');

  const cleanedText = normalizedText.replace(/\s+/g, ''); // Remove all spaces and newlines
  const results = [];

  for (const boss of bosses) {
    const searchName = getBossRegex(boss.name);
    let nameIndex = -1;
    let matchLength = boss.name.length;

    const match = cleanedText.match(searchName);
    if (match) {
      nameIndex = match.index;
      matchLength = match[0].length;
    }

    if (nameIndex !== -1) {
      const afterText = cleanedText.substring(nameIndex + matchLength);
      
      // Truncate afterText before any other boss name to avoid matching subsequent bosses' times
      let nextBossIndex = -1;
      for (const otherBoss of bosses) {
        if (otherBoss.name === boss.name) continue;
        const otherReg = getBossRegex(otherBoss.name);
        const otherMatch = afterText.match(otherReg);
        if (otherMatch && otherMatch.index !== undefined) {
          if (nextBossIndex === -1 || otherMatch.index < nextBossIndex) {
            nextBossIndex = otherMatch.index;
          }
        }
      }

      let localText = afterText;
      if (nextBossIndex !== -1) {
        localText = afterText.substring(0, nextBossIndex);
      }

      let timeText = localText;
      let prevText = '';
      
      // Iterative loop to cleanly strip arbitrary prefixes/distances without lookahead collisions
      while (timeText !== prevText) {
        prevText = timeText;
        // 1. Strip common words/chars: 남은시간, 남은, 시간, colons, spaces, equals, hyphens, and OCR noise characters (like v, V, checkmarks, circles)
        timeText = timeText.replace(/^(?:남은시간|남은|시간|[:\-=\s]|[a-zA-Z✓✔✗✘\(\)\[\]_~.]+)+/i, '');
        // 2. Strip distance patterns (e.g. 3,051m, 3051m, 3,051, 3051) ONLY if not followed by time units (시, 시간, 분, 초, 남음, 전)
        // We add (?!\d) to prevent backtracking to a single digit (which would convert 40분 to 0분 by stripping 4).
        timeText = timeText.replace(/^\d+(?:,\d+)*(?!\d)(?:m|rn|in|i)?(?!시|시간|분|초|남음|전)/i, '');
      }

      // OCR correction: '기분' is often a misreading of '21분' (2 looks like 기, 1 looks like ㅣ)
      timeText = timeText.replace(/기분/g, '21분');
      
      let remainingMinutes = null;
      let matchedText = '';

      // Check 1: Absolute spawn time check (e.g. 예정08.19.19:32:10 or 예정OB.19.19:34:02)
      const absMatch = timeText.match(/(?:예정|예장|예상|출현|출연|춘헌|충현|순힌|출선|출전|출신|춘천|순천)?[0O8B\d]{2}[.·\s]*\d{2}[.·\s]*(\d{2})[:·.]*(\d{2})(?:[:·.]*(\d{2}))?/i);
      if (absMatch) {
        matchedText = absMatch[0];
        const hh = parseInt(absMatch[1], 10);
        const mm = parseInt(absMatch[2], 10);
        const ss = absMatch[3] ? parseInt(absMatch[3], 10) : 0;
        
        const now = getCurrentTime();
        const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, ss);
        let diffMs = target - now;
        if (diffMs < -12 * 60 * 60 * 1000) {
          target.setDate(target.getDate() + 1);
          diffMs = target - now;
        } else if (diffMs > 12 * 60 * 60 * 1000) {
          target.setDate(target.getDate() - 1);
          diffMs = target - now;
        }
        remainingMinutes = diffMs / (60 * 1000);
      }

      // Check 2: Falling back to relative time parsing if no absolute time is matched
      if (remainingMinutes === null) {
        // Pattern 1: HH:MM:SS or HH:MM
        const colonMatch = timeText.match(/^(?:(\d{1,2}):(\d{2}):(\d{2})|(\d{1,2}):(\d{2}))/);
        if (colonMatch) {
          matchedText = colonMatch[0];
          if (colonMatch[1] !== undefined) {
            const hh = parseInt(colonMatch[1], 10);
            const mm = parseInt(colonMatch[2], 10);
            const ss = parseInt(colonMatch[3], 10);
            remainingMinutes = hh * 60 + mm + ss / 60;
          } else {
            const hh = parseInt(colonMatch[4], 10);
            const mm = parseInt(colonMatch[5], 10);
            if (hh > 23) {
              remainingMinutes = hh + mm / 60; // Treat as MM:SS
            } else {
              remainingMinutes = hh * 60 + mm; // Treat as HH:MM
            }
          }
        } 
        // Pattern 2: Korean time strings like X시간 Y분 Z초
        else {
          const krMatch = timeText.match(/^(?:(\d+)(?:시간|시))?(?:(\d+)분)?(?:(\d+)초)?/);
          if (krMatch && (krMatch[1] || krMatch[2] || krMatch[3])) {
            matchedText = krMatch[0];
            const hh = krMatch[1] ? parseInt(krMatch[1], 10) : 0;
            const mm = krMatch[2] ? parseInt(krMatch[2], 10) : 0;
            const ss = krMatch[3] ? parseInt(krMatch[3], 10) : 0;
            remainingMinutes = hh * 60 + mm + ss / 60;
          }
        }
      }

      if (remainingMinutes !== null && remainingMinutes > -180) { // Allow up to 3 hours in the past
        results.push({
          boss,
          remainingMinutes,
          matchedText
        });
      }
    }
  }

  return results;
}

// Helper: Format Dates to localized string (오늘/내일/어제 HH:MM:SS)
function formatDateTime(dateVal) {
  if (!dateVal) return '기록 없음';
  const d = new Date(dateVal);
  
  const kstOffset = 9 * 60 * 60 * 1000;
  const nowKST = new Date(getCurrentTime().getTime() + kstOffset);
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
  const now = getCurrentTime();
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

// Global scheduler database cache variables
let cachedRecords = [];
let cachedNotificationChannel = null;
let lastCacheFetch = 0;

// Background scheduler: Check soon spawning bosses
async function checkUpcomingSpawns() {
  try {
    const now = getCurrentTime();
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
        // Prevent double-trigger in memory immediately
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
        await triggerVoiceTTS(record.name);
      }
      // Spawn alert (20 seconds remaining >= remaining > -10m)
      else if (diffMs <= 20000 && diffMs > -600000 && record.notified_0 === 0) {
        // Prevent double-trigger in memory immediately
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
        await announceVoice(`${record.name} 곧 출현합니다.`);
      }
    }
  } catch (error) {
    console.error('Error in scheduler loop:', error);
  }
}

// Event: Interaction Command Router
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
        lastCacheFetch = 0;

        const responseEmbed = new EmbedBuilder()
          .setTitle(`⚔️ ${boss.name} 컷 기록 완료 (버튼 클릭)`)
          .setColor(0xFF4500)
          .addFields(
            { name: '처치(컷) 시간', value: `\`${formatDateTime(killTime)}\``, inline: true },
            { name: '다음 젠 예정', value: `\`${formatDateTime(nextSpawnTime)}\``, inline: true },
            { name: '남은 시간', value: `\`${formatRemainingTime(nextSpawnTime)}\``, inline: false }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [responseEmbed] });
      } catch (err) {
        console.error('Error handling button cut:', err);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `❌ 오류가 발생했습니다: ${err.message}`, ephemeral: true });
        }
      }
    }
    return;
  }

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
    
    // 4.1. LIST BOSSES ORDERED BY SPAWN TIME (보스순서)
    else if (commandName === '보스순서') {
      const list = await db.getBossList();
      if (list.length === 0) {
        return interaction.reply('등록된 보스가 없습니다.');
      }

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
          const isOver = new Date(boss.next_spawn) <= getCurrentTime();
          if (isOver) {
            emoji = '⚔️';
            statusText = `**${remainingStr}**`;
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

      // Build sequential gap summary (e.g. 보스A (+120초) ➡️ 보스B)
      const activeBosses = sortedList.filter(b => b.next_spawn);
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
      
      const inactiveBosses = sortedList.filter(b => !b.next_spawn);
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
      lastCacheFetch = 0;

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
      let estimatedKillTime;
      const parsedMins = parseRemainingTime(timeStr);

      if (parsedMins !== null) {
        nextSpawnTime = new Date(getCurrentTime().getTime() + parsedMins * 60 * 1000);
        estimatedKillTime = new Date(nextSpawnTime.getTime() - boss.cooldown * 60 * 1000);
      } else {
        try {
          nextSpawnTime = parseFutureTimeInput(timeStr);
          estimatedKillTime = new Date(nextSpawnTime.getTime() - boss.cooldown * 60 * 1000);
        } catch (err) {
          return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
        }
      }

      await db.recordKill(boss.name, estimatedKillTime, nextSpawnTime);
      lastCacheFetch = 0;

      const responseEmbed = new EmbedBuilder()
        .setTitle(`🗓️ ${boss.name} 젠 예정 시간 지정`)
        .setColor(0xFFD700)
        .addFields(
          { name: '처치(컷) 시간 (추정)', value: `\`${formatDateTime(estimatedKillTime)}\``, inline: true },
          { name: '다음 젠 예정', value: `\`${formatDateTime(nextSpawnTime)}\``, inline: true },
          { name: '남은 시간', value: `\`${formatRemainingTime(nextSpawnTime)}\``, inline: false }
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
        lastCacheFetch = 0;
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
      lastCacheFetch = 0;
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

    // 12. ANALYZE SCREENSHOT (OCR)
    else if (commandName === '분석') {
      await interaction.deferReply();
      const attachment = interaction.options.getAttachment('이미지');

      if (!attachment.contentType || !attachment.contentType.startsWith('image/')) {
        return interaction.editReply('❌ 이미지 파일만 업로드할 수 있습니다.');
      }

      const apiKey = process.env.OCR_SPACE_KEY || 'K87895188888957';

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
        console.log('--- OCR RAW TEXT START ---');
        console.log(parsedText);
        console.log('--- OCR RAW TEXT END ---');
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

        lastCacheFetch = 0; // Invalidate cache immediately

        responseEmbed.setDescription(descText);
        await interaction.editReply({ embeds: [responseEmbed] });

      } catch (err) {
        console.error('OCR analyze error:', err);
        await interaction.editReply(`❌ 분석 중 오류가 발생했습니다: ${err.message}`);
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
