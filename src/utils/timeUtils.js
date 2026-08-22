let timeOffsetMs = 0;

export async function syncGoogleTime() {
  try {
    const start = Date.now();
    const response = await fetch('https://www.google.com', {
      method: 'HEAD',
      cache: 'no-store'
    });
    const end = Date.now();
    const latency = (end - start) / 2;

    const dateHeader = response.headers.get('date');
    if (dateHeader) {
      const serverTime = new Date(dateHeader).getTime() + latency;
      timeOffsetMs = serverTime - end;
      console.log(`⏰ Time synchronized with Google. Offset: ${timeOffsetMs}ms (Latency: ${latency}ms)`);
    }
  } catch (err) {
    console.warn('Failed to sync time with Google, using local system time:', err.message);
  }
}

export function getCurrentTime() {
  return new Date(Date.now() + timeOffsetMs);
}

export function parseTimeString(timeStr) {
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

export function parseTimeInput(timeStr) {
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

export function parseFutureTimeInput(timeStr) {
  if (!timeStr) throw new Error('시간을 입력해야 합니다.');
  timeStr = timeStr.trim();

  const { hh, mm, ss } = parseTimeString(timeStr);
  
  const nowUTC = getCurrentTime();
  const kstOffset = 9 * 60 * 60 * 1000;
  const nowKST = new Date(nowUTC.getTime() + kstOffset);

  const targetKST = new Date(nowKST);
  targetKST.setUTCHours(hh, mm, ss, 0);

  // If parsed time is in the past by more than 15 minutes, assume tomorrow
  if (targetKST.getTime() - nowKST.getTime() < -15 * 60 * 1000) {
    targetKST.setUTCDate(targetKST.getUTCDate() + 1);
  }

  const targetUTC = new Date(targetKST.getTime() - kstOffset);
  return targetUTC;
}

export function parseRemainingTime(timeStr) {
  const cleaned = timeStr.replace(/\s+/g, '');
  const isExplicitRemaining = cleaned.includes('남음');
  
  if (isExplicitRemaining) {
    const colonStr = cleaned.replace('남음', '');
    if (colonStr.includes(':')) {
      const parts = colonStr.split(':');
      let totalSeconds = 0;
      if (parts.length === 3) {
        const hours = parseInt(parts[0], 10) || 0;
        const mins = parseInt(parts[1], 10) || 0;
        const secs = parseInt(parts[2], 10) || 0;
        totalSeconds = hours * 3600 + mins * 60 + secs;
      } else if (parts.length === 2) {
        const hours = parseInt(parts[0], 10) || 0;
        const mins = parseInt(parts[1], 10) || 0;
        totalSeconds = hours * 3600 + mins * 60;
      }
      return totalSeconds / 60;
    }

    let totalSeconds = 0;
    const hourMatch = cleaned.match(/(\d+)(시|시간)/);
    if (hourMatch) {
      totalSeconds += parseInt(hourMatch[1], 10) * 3600;
    }

    const minMatch = cleaned.match(/(\d+)분/);
    if (minMatch) {
      totalSeconds += parseInt(minMatch[1], 10) * 60;
    }

    const secMatch = cleaned.match(/(\d+)초/);
    if (secMatch) {
      totalSeconds += parseInt(secMatch[1], 10);
    }

    if (totalSeconds > 0) {
      return totalSeconds / 60;
    }
  }

  // Pattern 1: X시간 Y분 or X시간Y분
  const hourMinMatch = cleaned.match(/^(\d+)시간(\d+)분$/);
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

export function formatDateTime(dateVal) {
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

export function formatRemainingTime(dateVal) {
  if (!dateVal) return '-';
  const d = new Date(dateVal);
  const now = getCurrentTime();
  const diffMs = d - now;

  if (diffMs < 0) {
    const secsOver = Math.floor(Math.abs(diffMs) / 1000);
    const minsOver = Math.floor(secsOver / 60);
    const hh = Math.floor(secsOver / 3600);
    const mm = Math.floor((secsOver % 3600) / 60);
    const ss = secsOver % 60;

    // 30 minutes or more overdue -> 멍 (미출현/기록누락)
    if (minsOver >= 30) {
      return hh > 0 ? `멍 (${hh}시간 ${mm}분 초과)` : `멍 (${mm}분 초과)`;
    }

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
