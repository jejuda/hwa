let bosses = [];

// Format DateTime to: 오늘/내일/어제 HH:MM:SS
function formatDateTime(dateStr) {
  if (!dateStr) return '기록 없음';
  const d = new Date(dateStr);
  const now = new Date();
  
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  
  const diffTime = targetDay - today;
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  
  let dayStr = '';
  if (diffDays === 0) dayStr = '오늘';
  else if (diffDays === 1) dayStr = '내일';
  else if (diffDays === -1) dayStr = '어제';
  else dayStr = `${d.getMonth() + 1}/${d.getDate()}`;
  
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dayStr} ${hh}:${mm}:${ss}`;
}

// Helper: Calculate status and timer text with seconds precision
function getRemainingTimeInfo(nextSpawn, now) {
  if (!nextSpawn) return { text: '-', statusClass: 'status-safe', statusLabel: '대기 중' };
  const diffMs = nextSpawn - now;
  const diffMins = diffMs / 60000;

  if (diffMs < 0) {
    const secsOver = Math.floor(Math.abs(diffMs) / 1000);
    const hh = Math.floor(secsOver / 3600);
    const mm = Math.floor((secsOver % 3600) / 60);
    const ss = secsOver % 60;
    
    let text = '';
    if (secsOver < 60) text = `젠 중 (+${ss}초)`;
    else text = hh > 0 ? `젠 중 (+${hh}시 ${mm}분)` : `젠 중 (+${mm}분 ${ss}초)`;

    return {
      text,
      statusClass: 'status-overdue',
      statusLabel: '젠 진행 중'
    };
  } else if (diffMins <= 10) {
    const secsLeft = Math.floor(diffMs / 1000);
    const mm = Math.floor(secsLeft / 60);
    const ss = secsLeft % 60;

    return {
      text: `${mm}분 ${ss}초 남음`,
      statusClass: 'status-soon',
      statusLabel: '젠 임박 (10분 미만)'
    };
  } else {
    const secsLeft = Math.floor(diffMs / 1000);
    const hh = Math.floor(secsLeft / 3600);
    const mm = Math.floor((secsLeft % 3600) / 60);
    const ss = secsLeft % 60;

    const text = hh > 0 ? `${hh}시간 ${mm}분 남음` : `${mm}분 ${ss}초 남음`;
    return {
      text,
      statusClass: 'status-safe',
      statusLabel: '대기 중'
    };
  }
}

// Render boss list
function renderBosses() {
  const container = document.getElementById('boss-container');
  if (bosses.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-secondary);">
        등록된 보스가 없습니다. 좌측 상단 [보스 추가] 버튼을 눌러 첫 보스를 만들어보세요!
      </div>`;
    return;
  }

  container.innerHTML = '';
  const now = new Date();

  bosses.forEach((boss) => {
    const nextSpawn = boss.next_spawn ? new Date(boss.next_spawn) : null;
    const cooldownHrs = (boss.cooldown / 60).toFixed(1);
    
    const info = getRemainingTimeInfo(nextSpawn, now);

    const card = document.createElement('div');
    card.className = `boss-card ${info.statusClass}`;
    card.dataset.bossName = boss.name;

    card.innerHTML = `
      <div class="boss-header">
        <div class="boss-name">${boss.name}</div>
        <div class="boss-cooldown">주기: ${cooldownHrs}시간</div>
      </div>
      
      <div class="boss-timer-container">
        <div class="boss-time-remaining" data-timer-boss="${boss.name}">${info.text}</div>
        <div class="boss-timer-label">${info.statusLabel}</div>
      </div>

      <div class="boss-details">
        <div>
          <span>마지막 컷</span>
          <strong>${formatDateTime(boss.last_kill)}</strong>
        </div>
        <div>
          <span>다음 젠 예정</span>
          <strong>${formatDateTime(boss.next_spawn)}</strong>
        </div>
      </div>

      ${boss.memo ? `<div class="boss-memo">${boss.memo}</div>` : ''}

      <div class="boss-actions">
        <div class="boss-action-row">
          <button class="btn btn-danger btn-sm" onclick="quickCut('${boss.name}')">⚡ 컷</button>
          <button class="btn btn-secondary btn-sm" onclick="openCutModal('${boss.name}')">⏱️ 분전 컷</button>
        </div>
        <div class="boss-action-row">
          <button class="btn btn-success btn-sm" onclick="openSpawnModal('${boss.name}')">📅 젠 지정</button>
          <button class="btn btn-secondary btn-sm" onclick="rollbackCut('${boss.name}')">🔄 취소</button>
        </div>
        <div class="boss-action-row" style="margin-top: 0.25rem;">
          <button class="btn btn-secondary btn-sm" style="flex: 1; opacity: 0.75;" onclick="openEditModal('${boss.name}', ${cooldownHrs}, '${boss.memo || ''}')">수정</button>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

// Fetch bosses from API
async function fetchBosses() {
  try {
    const res = await fetch('/api/bosses');
    bosses = await res.json();
    renderBosses();
  } catch (err) {
    console.error('Failed to fetch bosses:', err);
  }
}

// Fetch settings/channel info
async function fetchChannelInfo() {
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();
    const info = document.getElementById('notif-channel-info');
    if (settings.notification_channel) {
      info.textContent = `🔔 텍스트 알림 채널: #${settings.notification_channel_name || settings.notification_channel}`;
    } else {
      info.textContent = `⚠️ 디스코드 텍스트 알림 채널 미설정 (/알림채널설정)`;
    }
  } catch (err) {
    console.error('Failed to fetch settings:', err);
  }
}

// Real-time ticking timer (every 1 second)
function startTicking() {
  setInterval(() => {
    const now = new Date();
    
    // Update live clock
    const clock = document.getElementById('live-clock');
    if (clock) {
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      clock.textContent = `${hh}:${mm}:${ss}`;
    }

    // Refresh remaining labels inside boss cards locally to avoid DOM redraw flicker
    bosses.forEach((boss) => {
      const nextSpawn = boss.next_spawn ? new Date(boss.next_spawn) : null;
      const el = document.querySelector(`[data-timer-boss="${boss.name}"]`);
      if (!el || !nextSpawn) return;

      const info = getRemainingTimeInfo(nextSpawn, now);
      
      const card = el.closest('.boss-card');
      if (card) {
        if (!card.classList.contains(info.statusClass)) {
          card.classList.remove('status-safe', 'status-soon', 'status-overdue');
          card.classList.add(info.statusClass);
          card.querySelector('.boss-timer-label').textContent = info.statusLabel;
        }
      }

      el.textContent = info.text;
    });
  }, 1000);
}

// SSE Connection for Real-time Synchronization
function setupSSE() {
  const source = new EventSource('/api/events');
  
  source.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'boss_updated' || data.type === 'bosses_initialized') {
      fetchBosses();
    } else if (data.type === 'settings_updated') {
      fetchChannelInfo();
    }
  });

  source.onerror = () => {
    console.log('SSE connection lost. Reconnecting in 5s...');
    source.close();
    setTimeout(setupSSE, 5000);
  };
}

// Modal Helpers
function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

// Modal Actions
// 1. Add Boss Modal
document.getElementById('btn-add-boss').addEventListener('click', () => {
  document.getElementById('modal-title').textContent = '보스 등록';
  document.getElementById('form-mode').value = 'add';
  document.getElementById('boss-name-input').value = '';
  document.getElementById('boss-name-input').disabled = false;
  document.getElementById('boss-cooldown-input').value = '';
  document.getElementById('boss-memo-input').value = '';
  openModal('boss-modal');
});

// 2. Edit Boss Modal Function
window.openEditModal = function(name, cooldown, memo) {
  document.getElementById('modal-title').textContent = '보스 수정';
  document.getElementById('form-mode').value = 'edit';
  document.getElementById('original-name').value = name;
  document.getElementById('boss-name-input').value = name;
  document.getElementById('boss-name-input').disabled = true; // Cannot edit name via edit (must delete and recreate)
  document.getElementById('boss-cooldown-input').value = cooldown;
  document.getElementById('boss-memo-input').value = memo;
  openModal('boss-modal');
};

// 3. Custom Cut Modal Function
window.openCutModal = function(name) {
  document.getElementById('cut-boss-name').value = name;
  document.getElementById('cut-time-input').value = '';
  openModal('cut-modal');
};

// 4. Custom Spawn Modal Function
window.openSpawnModal = function(name) {
  document.getElementById('spawn-boss-name').value = name;
  document.getElementById('spawn-time-input').value = '';
  openModal('spawn-modal');
};

// Submit Boss form (Add / Edit)
document.getElementById('btn-submit-boss').addEventListener('click', async () => {
  const mode = document.getElementById('form-mode').value;
  const name = document.getElementById('boss-name-input').value.trim();
  const cooldown = parseFloat(document.getElementById('boss-cooldown-input').value);
  const memo = document.getElementById('boss-memo-input').value.trim();

  if (!name || isNaN(cooldown) || cooldown <= 0) {
    alert('올바른 보스 이름과 젠주기(0보다 큼)를 입력해 주세요.');
    return;
  }

  try {
    let res;
    if (mode === 'add') {
      res = await fetch('/api/bosses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, cooldown, memo })
      });
    } else {
      res = await fetch(`/api/bosses/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cooldown, memo })
      });
    }

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '저장에 실패했습니다.');
    }

    closeModal('boss-modal');
  } catch (err) {
    alert(`오류: ${err.message}`);
  }
});

// Submit Cut Time (Custom offset)
document.getElementById('btn-submit-cut').addEventListener('click', async () => {
  const name = document.getElementById('cut-boss-name').value;
  const time = document.getElementById('cut-time-input').value.trim();

  try {
    const res = await fetch('/api/cut', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, time })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '처치 기록 처리에 실패했습니다.');
    }

    closeModal('cut-modal');
  } catch (err) {
    alert(`오류: ${err.message}`);
  }
});

// Submit Spawn Time (Explicit)
document.getElementById('btn-submit-spawn').addEventListener('click', async () => {
  const name = document.getElementById('spawn-boss-name').value;
  const time = document.getElementById('spawn-time-input').value.trim();

  if (!time) {
    alert('다음 젠 시간을 입력해주세요.');
    return;
  }

  try {
    const res = await fetch('/api/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, time })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '젠 예정 시간 지정에 실패했습니다.');
    }

    closeModal('spawn-modal');
  } catch (err) {
    alert(`오류: ${err.message}`);
  }
});

// Quick Cut (Current Time)
window.quickCut = async function(name) {
  try {
    const res = await fetch('/api/cut', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '처치 처리에 실패했습니다.');
    }
  } catch (err) {
    alert(`오류: ${err.message}`);
  }
};

// Rollback Cut
window.rollbackCut = async function(name) {
  if (!confirm(`정말로 ${name}의 직전 처치/젠 기록 입력을 취소하고 복구하시겠습니까?`)) return;

  try {
    const res = await fetch('/api/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '기록 복구에 실패했습니다.');
    }
  } catch (err) {
    alert(`오류: ${err.message}`);
  }
};

// Delete Boss
window.deleteBoss = async function(name) {
  if (!confirm(`정말로 보스 [${name}]을(를) 삭제하시겠습니까? 관련 컷 기록도 모두 지워집니다.`)) return;

  try {
    const res = await fetch(`/api/bosses/${encodeURIComponent(name)}`, {
      method: 'DELETE'
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '보스 삭제에 실패했습니다.');
    }
  } catch (err) {
    alert(`오류: ${err.message}`);
  }
};

// Initialize
fetchBosses();
fetchChannelInfo();
startTicking();
setupSSE();
