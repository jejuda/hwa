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

  // Insert default 11 bosses if they do not exist, and enforce correct cooldowns
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
    { name: '가르투아', cooldown: 720, memo: '필드 보스' }
  ];

  for (const boss of defaultBosses) {
    await run('INSERT OR IGNORE INTO bosses (name, cooldown, memo) VALUES (?, ?, ?)', [boss.name, boss.cooldown, boss.memo]);
    // Enforce correct default cooldowns if they already exist
    await run('UPDATE bosses SET cooldown = ? WHERE name = ?', [boss.cooldown, boss.name]);
    await run('INSERT OR IGNORE INTO records (boss_name) VALUES (?)', [boss.name]);
  }

  // Delete any other bosses to restrict the bot only to these 11 field bosses
  await run(`
    DELETE FROM bosses 
    WHERE name NOT IN ('노블루드', '악시오스', '바르시엔', '구루타', '카루카', '비슈베다', '쉬라크', '타르탄', '카샤파', '라그타', '가르투아')
  `);
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

// Record boss kill
export async function recordKill(name, killTime, nextSpawnTime) {
  // Get current record to save as backup for rollback
  const record = await get('SELECT last_kill, next_spawn FROM records WHERE boss_name = ?', [name]);
  
  const prevLastKill = record ? record.last_kill : null;
  const prevNextSpawn = record ? record.next_spawn : null;

  await run(`
    UPDATE records 
    SET last_kill = ?, 
        next_spawn = ?, 
        prev_last_kill = ?, 
        prev_next_spawn = ?,
        notified_10 = 0, 
        notified_5 = 0, 
        notified_0 = 0
    WHERE boss_name = ?
  `, [killTime.toISOString(), nextSpawnTime.toISOString(), prevLastKill, prevNextSpawn, name]);
}

// Record explicit next spawn time
export async function recordSpawn(name, nextSpawnTime) {
  const record = await get('SELECT last_kill, next_spawn FROM records WHERE boss_name = ?', [name]);
  
  const prevLastKill = record ? record.last_kill : null;
  const prevNextSpawn = record ? record.next_spawn : null;

  await run(`
    UPDATE records 
    SET last_kill = NULL, 
        next_spawn = ?, 
        prev_last_kill = ?, 
        prev_next_spawn = ?,
        notified_10 = 0, 
        notified_5 = 0, 
        notified_0 = 0
    WHERE boss_name = ?
  `, [nextSpawnTime.toISOString(), prevLastKill, prevNextSpawn, name]);
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

// Update notified flags
export async function markNotified(name, level) {
  // level can be '10', '5', or '0'
  const column = `notified_${level}`;
  await run(`UPDATE records SET ${column} = 1 WHERE boss_name = ?`, [name]);
}
