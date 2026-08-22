import * as db from '../../database.js';

export async function resolveBossName(inputName) {
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
