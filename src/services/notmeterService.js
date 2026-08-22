import { NOTMETER_BOSS_MAP, NOTMETER_ENDPOINTS } from '../config/constants.js';
import * as db from '../../database.js';
import { invalidateNotificationCache } from '../scheduler/spawnScheduler.js';

// In-memory HTTP cache store for ETag & 304 handling
const endpointCache = new Map();

export async function syncNotMeterData(options = {}) {
  let jsonData = null;
  let lastError = null;
  let isNotModified = false;

  for (const url of NOTMETER_ENDPOINTS) {
    try {
      const headers = {};
      const cached = endpointCache.get(url);

      if (cached && !options.force) {
        if (cached.etag) headers['If-None-Match'] = cached.etag;
        if (cached.lastModified) headers['If-Modified-Since'] = cached.lastModified;
      }

      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(8000)
      });

      // 304 Not Modified: Cache is still fresh, zero bandwidth wasted
      if (res.status === 304 && cached && cached.data) {
        jsonData = cached.data;
        isNotModified = true;
        break;
      }

      if (res.ok) {
        const etag = res.headers.get('etag');
        const lastModified = res.headers.get('last-modified');
        const data = await res.json();

        if (data && data.servers) {
          endpointCache.set(url, { etag, lastModified, data });
          jsonData = data;
          break;
        }
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (!jsonData || !jsonData.servers) {
    throw new Error(lastError ? lastError.message : 'NotMeter 데이터를 불러올 수 없습니다.');
  }

  // Find Israphel Asmodian server (serverId: 2001 for Altgard / Asmodians)
  const israphel = jsonData.servers.find(s => Number(s.serverId) === 2001);
  if (!israphel || !israphel.regions) {
    return { updated: [], totalChecked: 0, serverFound: false, notModified: isNotModified };
  }

  const updatedBosses = [];
  const bossList = await db.getBossList();
  const bossMapByName = new Map(bossList.map(b => [b.name, b]));

  for (const region of israphel.regions) {
    if (!region.entries) continue;
    for (const entry of region.entries) {
      const bossName = NOTMETER_BOSS_MAP[entry.bossCode];
      if (!bossName) continue;

      const bossInfo = bossMapByName.get(bossName);
      if (!bossInfo) continue;

      const targetMs = Number(entry.targetAt);
      if (!targetMs || isNaN(targetMs)) continue;

      const newSpawnTime = new Date(targetMs);
      const currentNextSpawn = bossInfo.next_spawn ? new Date(bossInfo.next_spawn) : null;

      // Update if time difference is greater than 10 seconds or new entry or forced
      const isDifferent = !currentNextSpawn || Math.abs(currentNextSpawn.getTime() - newSpawnTime.getTime()) > 10000;

      if (isDifferent || options.force) {
        const estimatedKillTime = new Date(newSpawnTime.getTime() - (bossInfo.cooldown || 240) * 60 * 1000);
        await db.recordKill(bossName, estimatedKillTime, newSpawnTime);
        updatedBosses.push({
          name: bossName,
          previousSpawn: currentNextSpawn,
          nextSpawn: newSpawnTime,
          targetAt: targetMs
        });
      }
    }
  }

  if (updatedBosses.length > 0) {
    invalidateNotificationCache(); // Invalidate cache immediately for TTS & timers
  }

  await db.setSetting('last_notmeter_sync', new Date().toISOString());

  return {
    updated: updatedBosses,
    totalChecked: Object.keys(NOTMETER_BOSS_MAP).length,
    serverFound: true,
    notModified: isNotModified
  };
}
