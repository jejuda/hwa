import sqlite3 from 'sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, 'bosses.db');

// Enable verbose mode for debugging in development if needed
const sqlite = sqlite3.verbose();
const db = new sqlite.Database(dbPath);

// Helper functions wrapping sqlite3 in Promises
export function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

export function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Initialize database tables
export async function initDB() {
  // Enable foreign keys
  await run('PRAGMA foreign_keys = ON;');

  // bosses table
  await run(`
    CREATE TABLE IF NOT EXISTS bosses (
      name TEXT PRIMARY KEY,
      cooldown INTEGER NOT NULL, -- Cooldown in minutes
      memo TEXT
    )
  `);

  // records table
  await run(`
    CREATE TABLE IF NOT EXISTS records (
      boss_name TEXT PRIMARY KEY,
      last_kill TEXT,      -- ISO string of last kill time
      next_spawn TEXT,     -- ISO string of next spawn time
      prev_last_kill TEXT, -- ISO string for rollback (/컷취소)
      prev_next_spawn TEXT,-- ISO string for rollback (/컷취소)
      notified_10 INTEGER DEFAULT 0,
      notified_5 INTEGER DEFAULT 0,
      notified_0 INTEGER DEFAULT 0,
      FOREIGN KEY(boss_name) REFERENCES bosses(name) ON DELETE CASCADE
    )
  `);

  // settings table
  await run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Keep the latest claimed spawn cycle per boss/notification level.
  // This watermark prevents a stale external timer from replaying an alert.
  await run(`
    CREATE TABLE IF NOT EXISTS notification_claims (
      boss_name TEXT NOT NULL,
      level TEXT NOT NULL CHECK(level IN ('10', '5', '0')),
      spawn_time_ms INTEGER NOT NULL,
      notified_at TEXT NOT NULL,
      PRIMARY KEY (boss_name, level),
      FOREIGN KEY(boss_name) REFERENCES bosses(name) ON DELETE CASCADE
    )
  `);

  // Insert default 16 bosses if they do not exist, and enforce correct cooldowns
  const defaultBosses = [
    { name: '노블루드', cooldown: 240, memo: '필드 보스' },
    { name: '악시오스', cooldown: 240, memo: '필드 보스' },
    { name: '바르시엔', cooldown: 240, memo: '필드 보스' },
    { name: '구루타', cooldown: 360, memo: '필드 보스' },
    { name: '카루카', cooldown: 240, memo: '필드 보스' },
    { name: '비슈베다', cooldown: 360, memo: '필드 보스' },
    { name: '쉬라크', cooldown: 360, memo: '필드 보스' },
    { name: '타르탄', cooldown: 360, memo: '필드 보스' },
    { name: '카샤파', cooldown: 360, memo: '필드 보스' },
    { name: '라그타', cooldown: 720, memo: '필드 보스' },
    { name: '가르투아', cooldown: 720, memo: '필드 보스' },
    { name: '사르바카', cooldown: 720, memo: '모르헤임' },
    { name: '미나사라', cooldown: 720, memo: '모르헤임' },
    { name: '브란트', cooldown: 360, memo: '모르헤임' },
    { name: '아그로', cooldown: 1440, memo: '어비스 하층' },
    { name: '카이라', cooldown: 240, memo: '어비스 하층' }
  ];

  for (const boss of defaultBosses) {
    await run('INSERT OR IGNORE INTO bosses (name, cooldown, memo) VALUES (?, ?, ?)', [boss.name, boss.cooldown, boss.memo]);
    // Enforce correct default cooldowns if they already exist
    await run('UPDATE bosses SET cooldown = ? WHERE name = ?', [boss.cooldown, boss.name]);
    await run('INSERT OR IGNORE INTO records (boss_name) VALUES (?)', [boss.name]);
  }

  // Delete any other bosses to restrict the bot only to these 16 field bosses
  await run(`
    DELETE FROM bosses 
    WHERE name NOT IN ('노블루드', '악시오스', '바르시엔', '구루타', '카루카', '비슈베다', '쉬라크', '타르탄', '카샤파', '라그타', '가르투아', '사르바카', '미나사라', '브란트', '아그로', '카이라')
  `);

  // Preserve the current notification state when upgrading an existing DB.
  const notifiedRecords = await all(`
    SELECT boss_name, next_spawn, notified_10, notified_5, notified_0
    FROM records
    WHERE next_spawn IS NOT NULL
  `);
  for (const record of notifiedRecords) {
    const spawnTimeMs = new Date(record.next_spawn).getTime();
    if (!Number.isFinite(spawnTimeMs)) continue;

    for (const level of ['10', '5', '0']) {
      if (record[`notified_${level}`] !== 1) continue;
      await run(`
        INSERT OR IGNORE INTO notification_claims
          (boss_name, level, spawn_time_ms, notified_at)
        VALUES (?, ?, ?, ?)
      `, [record.boss_name, level, spawnTimeMs, new Date().toISOString()]);
    }
  }
}


// Boss CRUD
export async function addBoss(name, cooldownMinutes, memo = '') {
  await run(
    'INSERT INTO bosses (name, cooldown, memo) VALUES (?, ?, ?)',
    [name, cooldownMinutes, memo]
  );
  // Also create a default record entry
  await run(
    'INSERT OR IGNORE INTO records (boss_name) VALUES (?)',
    [name]
  );
}

export async function deleteBoss(name) {
  // Foreign key ON DELETE CASCADE will handle deleting from records
  await run('DELETE FROM bosses WHERE name = ?', [name]);
}

export async function updateBoss(name, cooldownMinutes, memo = '') {
  await run(
    'UPDATE bosses SET cooldown = ?, memo = ? WHERE name = ?',
    [cooldownMinutes, memo, name]
  );
}

export async function getBossList() {
  return await all(`
    SELECT b.name, b.cooldown, b.memo, 
           r.last_kill, r.next_spawn,
           r.notified_10, r.notified_5, r.notified_0
    FROM bosses b
    LEFT JOIN records r ON b.name = r.boss_name
    ORDER BY r.next_spawn ASC, b.name ASC
  `);
}

export async function getBoss(name) {
  return await get(`
    SELECT b.name, b.cooldown, b.memo, 
           r.last_kill, r.next_spawn,
           r.notified_10, r.notified_5, r.notified_0
    FROM bosses b
    LEFT JOIN records r ON b.name = r.boss_name
    WHERE b.name = ?
  `, [name]);
}

// Helper to compute notified_5 and notified_0 safely without wiping active alerts
function calculateNotifiedFlags(nextSpawnTime, currentRecord, now = new Date()) {
  const diffMs = nextSpawnTime.getTime() - now.getTime();

  // If this is the same spawn cycle (time difference with previous spawn < 30 minutes), preserve existing notification states!
  if (currentRecord && currentRecord.next_spawn) {
    const prevNextSpawnTime = new Date(currentRecord.next_spawn).getTime();
    const cycleDiff = Math.abs(nextSpawnTime.getTime() - prevNextSpawnTime);

    if (cycleDiff < 30 * 60 * 1000) {
      let notified5 = currentRecord.notified_5 || 0;
      let notified0 = currentRecord.notified_0 || 0;

      // If time has already passed 10s before spawn, 5m must be 1
      if (diffMs <= 10000) notified5 = 1;
      // If time is overdue by > 3 minutes, 0m must be 1
      if (diffMs < -180000) notified0 = 1;

      return { notified5, notified0 };
    }
  }

  // New spawn cycle (kill recorded or new cycle >= 30m away)
  let notified5 = diffMs <= 10000 ? 1 : 0;
  let notified0 = diffMs < -180000 ? 1 : 0;

  return { notified5, notified0 };
}

// Record boss kill from user command or button
export async function recordKill(name, killTime, nextSpawnTime) {
  const record = await get('SELECT last_kill, next_spawn, notified_5, notified_0 FROM records WHERE boss_name = ?', [name]);
  
  const prevLastKill = record ? record.last_kill : null;
  const prevNextSpawn = record ? record.next_spawn : null;

  const { notified5, notified0 } = calculateNotifiedFlags(nextSpawnTime, record);

  await run(`
    UPDATE records 
    SET last_kill = ?, 
        next_spawn = ?, 
        prev_last_kill = ?, 
        prev_next_spawn = ?,
        notified_10 = 0, 
        notified_5 = ?, 
        notified_0 = ?
    WHERE boss_name = ?
  `, [
    killTime ? killTime.toISOString() : null,
    nextSpawnTime.toISOString(),
    prevLastKill,
    prevNextSpawn,
    notified5,
    notified0,
    name
  ]);
}

// Record explicit next spawn time from user command
export async function recordSpawn(name, nextSpawnTime) {
  const record = await get('SELECT last_kill, next_spawn, notified_5, notified_0 FROM records WHERE boss_name = ?', [name]);
  
  const prevLastKill = record ? record.last_kill : null;
  const prevNextSpawn = record ? record.next_spawn : null;

  const { notified5, notified0 } = calculateNotifiedFlags(nextSpawnTime, record);

  await run(`
    UPDATE records 
    SET last_kill = NULL, 
        next_spawn = ?, 
        prev_last_kill = ?, 
        prev_next_spawn = ?,
        notified_10 = 0, 
        notified_5 = ?, 
        notified_0 = ?
    WHERE boss_name = ?
  `, [
    nextSpawnTime.toISOString(),
    prevLastKill,
    prevNextSpawn,
    notified5,
    notified0,
    name
  ]);
}

// Synchronize spawn time from NotMeter API without wiping active notification state
export async function syncBossSpawnTime(name, estimatedKillTime, nextSpawnTime) {
  const record = await get('SELECT last_kill, next_spawn, notified_5, notified_0 FROM records WHERE boss_name = ?', [name]);
  
  const prevLastKill = record ? record.last_kill : null;
  const prevNextSpawn = record ? record.next_spawn : null;

  const { notified5, notified0 } = calculateNotifiedFlags(nextSpawnTime, record);

  await run(`
    UPDATE records 
    SET last_kill = ?, 
        next_spawn = ?, 
        prev_last_kill = ?, 
        prev_next_spawn = ?,
        notified_10 = 0, 
        notified_5 = ?, 
        notified_0 = ?
    WHERE boss_name = ?
  `, [
    estimatedKillTime ? estimatedKillTime.toISOString() : null,
    nextSpawnTime.toISOString(),
    prevLastKill,
    prevNextSpawn,
    notified5,
    notified0,
    name
  ]);
}

// Rollback last kill/spawn command
export async function rollbackRecord(name) {
  const record = await get(`
    SELECT prev_last_kill, prev_next_spawn 
    FROM records 
    WHERE boss_name = ?
  `, [name]);

  if (!record) {
    throw new Error('보스 기록을 찾을 수 없습니다.');
  }

  // If there's no backup record, we can't rollback
  if (record.prev_last_kill === undefined && record.prev_next_spawn === undefined) {
    throw new Error('이전 기록이 존재하지 않아 취소할 수 없습니다.');
  }

  await run(`
    UPDATE records 
    SET last_kill = ?, 
        next_spawn = ?, 
        prev_last_kill = NULL, 
        prev_next_spawn = NULL,
        notified_10 = 0, 
        notified_5 = 0, 
        notified_0 = 0
    WHERE boss_name = ?
  `, [record.prev_last_kill, record.prev_next_spawn, name]);
}

// Settings management (e.g. channel ID)
export async function getSetting(key) {
  const row = await get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

export async function setSetting(key, value) {
  await run(`
    INSERT INTO settings (key, value) 
    VALUES (?, ?) 
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `, [key, value]);
}

// Get boss records that are spawning soon
export async function getActiveNotifications() {
  return await all(`
    SELECT b.name, r.next_spawn, r.notified_10, r.notified_5, r.notified_0
    FROM bosses b
    JOIN records r ON b.name = r.boss_name
    WHERE r.next_spawn IS NOT NULL
  `);
}

// Atomically claim a spawn cycle so stale or repeated timer data cannot replay it.
export async function claimNotification(name, nextSpawn, level) {
  const validLevels = new Set(['10', '5', '0']);
  if (!validLevels.has(level)) {
    throw new Error(`Invalid notification level: ${level}`);
  }

  const spawnTimeMs = new Date(nextSpawn).getTime();
  if (!Number.isFinite(spawnTimeMs)) {
    throw new Error(`Invalid spawn time for notification: ${nextSpawn}`);
  }

  const spawnTimeIso = new Date(spawnTimeMs).toISOString();
  const column = `notified_${level}`;
  const flagResult = await run(`
    UPDATE records
    SET ${column} = 1
    WHERE boss_name = ? AND next_spawn = ? AND ${column} = 0
  `, [name, spawnTimeIso]);

  // The cached timer is no longer current, or another scheduler claimed it.
  if (flagResult.changes !== 1) return false;

  const minimumCycleGapMs = 30 * 60 * 1000;
  const claimResult = await run(`
    INSERT INTO notification_claims
      (boss_name, level, spawn_time_ms, notified_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(boss_name, level) DO UPDATE SET
      spawn_time_ms = excluded.spawn_time_ms,
      notified_at = excluded.notified_at
    WHERE excluded.spawn_time_ms >= notification_claims.spawn_time_ms + ?
  `, [name, level, spawnTimeMs, new Date().toISOString(), minimumCycleGapMs]);

  return claimResult.changes === 1;
}
