import { DEFAULT_11_BOSSES } from '../config/constants.js';
import { getCurrentTime } from '../utils/timeUtils.js';
import * as db from '../../database.js';

export function getBossRegex(name) {
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

export async function parseBossTimesFromOCR(text) {
  const bosses = (await db.getBossList()).filter(b => DEFAULT_11_BOSSES.includes(b.name));
  
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
