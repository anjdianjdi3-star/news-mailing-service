document.addEventListener('DOMContentLoaded', () => {
  const loginOverlay = document.getElementById('login-overlay');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const logoutBtn = document.getElementById('logout-btn');

  // Stats Elements
  const statTotalSubs = document.getElementById('stat-total-subs');
  const statActiveSubs = document.getElementById('stat-active-subs');
  const statSentWeek = document.getElementById('stat-sent-week');
  const statSentToday = document.getElementById('stat-sent-today');
  const quotaWarning = document.getElementById('quota-warning');
  const quotaWarningVal = document.getElementById('quota-warning-val');

  // Tab Buttons & Panels
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  // Tables
  const subscribersTableBody = document.querySelector('#subscribers-table tbody');
  const rssTableBody = document.querySelector('#rss-table tbody');
  const logsTableBody = document.querySelector('#logs-table tbody');

  // Form & Search
  const subscriberSearchInput = document.getElementById('subscriber-search');
  const rssForm = document.getElementById('rss-form');
  const manualSubscriberSelect = document.getElementById('manual-subscriber-select');
  const triggerManualBtn = document.getElementById('trigger-manual-btn');
  const manualSendingLog = document.getElementById('manual-sending-log');
  const manualSendingReport = document.getElementById('manual-sending-report');

  let activeSubscribersList = [];

  // ----------------------------------------------------
  // Auth management
  // ----------------------------------------------------
  function getToken() {
    return localStorage.getItem('admin_token');
  }

  function checkAuth() {
    const token = getToken();
    if (!token) {
      loginOverlay.classList.add('active');
    } else {
      loginOverlay.classList.remove('active');
      loadAllDashboardData();
    }
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.style.display = 'none';
    const password = document.getElementById('admin-password').value;

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('admin_token', data.token);
        document.getElementById('admin-password').value = '';
        loginOverlay.classList.remove('active');
        loadAllDashboardData();
      } else {
        loginError.textContent = data.error || '로그인 실패';
        loginError.style.display = 'block';
      }
    } catch (err) {
      console.error(err);
      loginError.textContent = '서버 통신 실패';
      loginError.style.display = 'block';
    }
  });

  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('admin_token');
    subscribersTableBody.innerHTML = '';
    rssTableBody.innerHTML = '';
    logsTableBody.innerHTML = '';
    checkAuth();
  });

  // Helper fetch function that automatically injects auth header and handles expired tokens
  async function adminFetch(url, options = {}) {
    const token = getToken();
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    };

    const res = await fetch(url, { ...options, headers });
    
    if (res.status === 401 || res.status === 412) {
      // Unauthorized or pre-requisite failed -> signout
      localStorage.removeItem('admin_token');
      checkAuth();
      throw new Error('세션이 만료되었습니다. 다시 로그인해 주세요.');
    }
    
    return res;
  }

  // ----------------------------------------------------
  // Navigation Tabs handler
  // ----------------------------------------------------
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');

      // Reload specific tab data on transition
      if (tabId === 'tab-subscribers') loadSubscribers();
      if (tabId === 'tab-rss') loadRSSSources();
      if (tabId === 'tab-logs') loadLogs();
      if (tabId === 'tab-manual') loadManualDispatchTargets();
    });
  });

  // ----------------------------------------------------
  // Load Stats & Summary cards
  // ----------------------------------------------------
  async function loadStats() {
    try {
      const res = await adminFetch('/api/admin/stats');
      if (!res.ok) return;
      const stats = await res.json();

      statTotalSubs.textContent = stats.totalSubscribers;
      statActiveSubs.textContent = stats.activeSubscribers;
      statSentWeek.textContent = stats.sentPastSevenDays;
      statSentToday.textContent = `${stats.emailsSentToday} / ${stats.quotaLimit}`;

      if (stats.isCloseToLimit) {
        quotaWarningVal.textContent = stats.emailsSentToday;
        quotaWarning.style.display = 'flex';
      } else {
        quotaWarning.style.display = 'none';
      }
    } catch (err) {
      console.error('Error loading stats:', err.message);
    }
  }

  // ----------------------------------------------------
  // Load Subscribers
  // ----------------------------------------------------
  async function loadSubscribers(searchQuery = '') {
    try {
      const url = searchQuery 
        ? `/api/admin/subscribers?search=${encodeURIComponent(searchQuery)}`
        : '/api/admin/subscribers';
        
      const res = await adminFetch(url);
      if (!res.ok) return;
      const subscribers = await res.json();

      subscribersTableBody.innerHTML = '';
      if (subscribers.length === 0) {
        subscribersTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">신청자가 없습니다.</td></tr>`;
        return;
      }

      subscribers.forEach(sub => {
        const row = document.createElement('tr');
        const formattedDate = new Date(sub.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        
        row.innerHTML = `
          <td><strong>${escapeHtml(sub.email)}</strong></td>
          <td>${escapeHtml(sub.days)}</td>
          <td><code>${escapeHtml(sub.time)}</code></td>
          <td>${escapeHtml(sub.keywords)}</td>
          <td>
            <span class="badge ${sub.active ? 'badge-active' : 'badge-inactive'}">
              ${sub.active ? '활성' : '비활성'}
            </span>
          </td>
          <td><span style="font-size:12px; color:var(--text-secondary);">${formattedDate}</span></td>
          <td>
            <button class="btn btn-danger delete-sub-btn" data-id="${sub.id}" style="padding: 6px 12px; font-size:12px; border-radius:6px; width:auto; box-shadow:none;">حذف</button>
          </td>
        `;
        
        // Let's replace 'حذف' with '삭제' in Korean!
        row.querySelector('.delete-sub-btn').textContent = '삭제';
        
        subscribersTableBody.appendChild(row);
      });

      // Bind delete buttons
      document.querySelectorAll('.delete-sub-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const subId = btn.getAttribute('data-id');
          if (!confirm('정말 이 구독자를 삭제하시겠습니까? 관련 로그는 유지되지만 구독 정보는 소멸됩니다.')) return;
          
          try {
            const deleteRes = await adminFetch(`/api/admin/subscribers/${subId}`, { method: 'DELETE' });
            if (deleteRes.ok) {
              const resData = await deleteRes.json();
              alert(`${resData.email} 구독자가 삭제되었습니다.`);
              loadSubscribers(subscriberSearchInput.value);
              loadStats();
            }
          } catch (err) {
            alert(err.message);
          }
        });
      });
    } catch (err) {
      console.error(err);
    }
  }

  // Subscriber Search handler (debounce simple input)
  subscriberSearchInput.addEventListener('input', () => {
    loadSubscribers(subscriberSearchInput.value);
  });

  // ----------------------------------------------------
  // Load RSS Sources
  // ----------------------------------------------------
  async function loadRSSSources() {
    try {
      const res = await adminFetch('/api/admin/rss');
      if (!res.ok) return;
      const sources = await res.json();

      rssTableBody.innerHTML = '';
      if (sources.length === 0) {
        rssTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">등록된 RSS가 없습니다.</td></tr>`;
        return;
      }

      sources.forEach(src => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td><span class="tag" style="background:rgba(255,255,255,0.05); color:#fff; border:none; padding:4px 8px;">${escapeHtml(src.category)}</span></td>
          <td><a href="${escapeHtml(src.url)}" target="_blank" style="font-size:13px; font-family:monospace; color:var(--text-secondary); word-break:break-all;">${escapeHtml(src.url)}</a></td>
          <td>
            <button class="btn toggle-rss-btn ${src.active ? 'btn-secondary' : ''}" data-id="${src.id}" data-active="${src.active}" style="padding: 6px 12px; font-size:12px; border-radius:6px; width:auto; box-shadow:none; background:${src.active ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color:${src.active ? '#34d399' : '#f87171'}">
              ${src.active ? '활성 상태' : '비활성 상태'}
            </button>
          </td>
          <td>
            <button class="btn btn-danger delete-rss-btn" data-id="${src.id}" style="padding: 6px 12px; font-size:12px; border-radius:6px; width:auto; box-shadow:none;">삭제</button>
          </td>
        `;
        rssTableBody.appendChild(row);
      });

      // Bind toggle active switches
      document.querySelectorAll('.toggle-rss-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          const currentActive = btn.getAttribute('data-active') === 'true';
          const newActive = !currentActive;

          try {
            const toggleRes = await adminFetch(`/api/admin/rss/${id}/toggle`, {
              method: 'PUT',
              body: JSON.stringify({ active: newActive })
            });
            if (toggleRes.ok) {
              loadRSSSources();
            }
          } catch (err) {
            alert(err.message);
          }
        });
      });

      // Bind delete RSS buttons
      document.querySelectorAll('.delete-rss-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          if (!confirm('해당 RSS 소스를 삭제하겠습니까? 더 이상 이 URL에서 기사를 가져오지 않습니다.')) return;

          try {
            const delRes = await adminFetch(`/api/admin/rss/${id}`, { method: 'DELETE' });
            if (delRes.ok) {
              loadRSSSources();
            }
          } catch (err) {
            alert(err.message);
          }
        });
      });
    } catch (err) {
      console.error(err);
    }
  }

  // Form submit for RSS add
  rssForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('rss-url').value.trim();
    const category = document.getElementById('rss-category').value.trim();

    try {
      const res = await adminFetch('/api/admin/rss', {
        method: 'POST',
        body: JSON.stringify({ url, category })
      });

      const data = await res.json();
      if (res.ok) {
        rssForm.reset();
        loadRSSSources();
      } else {
        alert(data.error || 'RSS 등록 실패');
      }
    } catch (err) {
      alert(err.message);
    }
  });

  // ----------------------------------------------------
  // Load Send Logs
  // ----------------------------------------------------
  async function loadLogs() {
    try {
      const res = await adminFetch('/api/admin/logs');
      if (!res.ok) return;
      const logs = await res.json();

      logsTableBody.innerHTML = '';
      if (logs.length === 0) {
        logsTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">발송 로그가 존재하지 않습니다.</td></tr>`;
        return;
      }

      logs.forEach(log => {
        const row = document.createElement('tr');
        const formattedDate = new Date(log.sent_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        const success = log.status === 'success';

        row.innerHTML = `
          <td><span style="font-size:12px; color:var(--text-secondary);">${formattedDate}</span></td>
          <td><strong>${log.email ? escapeHtml(log.email) : '<span style="color:var(--text-muted);">(삭제된 구독자)</span>'}</strong></td>
          <td>
            <div style="display:inline-flex; align-items:center;">
              <span class="status-dot ${success ? 'status-dot-success' : 'status-dot-failure'}"></span>
              <span style="color:${success ? '#34d399' : '#f87171'}; font-weight:600;">
                ${success ? '성공' : '실패'}
              </span>
            </div>
          </td>
          <td><code>${log.article_count || 0} 건</code></td>
          <td style="color:#f87171; font-size:13px; font-family:monospace; word-break:break-all;">
            ${log.error_message ? escapeHtml(log.error_message) : '-'}
          </td>
        `;
        logsTableBody.appendChild(row);
      });
    } catch (err) {
      console.error(err);
    }
  }

  // ----------------------------------------------------
  // Load Manual test targets list
  // ----------------------------------------------------
  async function loadManualDispatchTargets() {
    try {
      const res = await adminFetch('/api/admin/subscribers');
      if (!res.ok) return;
      const list = await res.json();

      // Keep only active subscribers for mailing
      activeSubscribersList = list.filter(sub => sub.active);

      manualSubscriberSelect.innerHTML = `<option value="">전체 활성 구독자 대상 (${activeSubscribersList.length}명 일괄 수동 발송)</option>`;
      
      activeSubscribersList.forEach(sub => {
        const option = document.createElement('option');
        option.value = sub.id;
        option.textContent = `${sub.email} (${sub.keywords})`;
        manualSubscriberSelect.appendChild(option);
      });
    } catch (err) {
      console.error(err);
    }
  }

  // Manual Trigger Button action
  triggerManualBtn.addEventListener('click', async () => {
    const selectedSubId = manualSubscriberSelect.value;
    const targetText = selectedSubId 
      ? `구독자 ID: ${selectedSubId}에 대한 발송`
      : '전체 활성 구독자 일괄 발송';

    if (!confirm(`${targetText}을(를) 즉시 테스트 실행하시겠습니까? RSS 크롤링 및 메일 API가 작동합니다.`)) return;

    triggerManualBtn.disabled = true;
    triggerManualBtn.textContent = '⏳ 발송 작업 실행 중...';
    manualSendingLog.style.display = 'block';
    manualSendingReport.textContent = '수집원 및 메일링 API 실행 중... 리포트 응답 대기 중입니다.\n';

    try {
      const res = await adminFetch('/api/admin/send-manual', {
        method: 'POST',
        body: JSON.stringify({ subscriberId: selectedSubId || null })
      });

      const data = await res.json();
      triggerManualBtn.disabled = false;
      triggerManualBtn.textContent = '⚡ 즉시 발송 시도';

      if (res.ok) {
        let report = `[실행 완료]\n결과 메시지: ${data.message}\n`;
        report += `대상 인원: ${data.totalTargets}명 | 성공: ${data.successCount}명 | 실패: ${data.failCount}명\n\n`;
        
        if (data.details && data.details.length > 0) {
          report += `상세 리포트:\n`;
          data.details.forEach(item => {
            if (item.status === 'success') {
              report += `🟢 [성공] ${item.email} - 매칭기사: ${item.articles}건 ${item.note ? '(' + item.note + ')' : ''}\n`;
            } else {
              report += `🔴 [실패] ${item.email} - 사유: ${item.error}\n`;
            }
          });
        }
        manualSendingReport.textContent = report;
        // Refresh stats/logs
        loadStats();
      } else {
        manualSendingReport.textContent = `❌ 발송 작업 실패: ${data.error}`;
      }
    } catch (err) {
      triggerManualBtn.disabled = false;
      triggerManualBtn.textContent = '⚡ 즉시 발송 시도';
      manualSendingReport.textContent = `❌ 네트워크 오류: ${err.message}`;
    }
  });

  // ----------------------------------------------------
  // Dashboard bootloader
  // ----------------------------------------------------
  function loadAllDashboardData() {
    loadStats();
    loadSubscribers();
  }

  // Initial check
  checkAuth();
  
  // HTML escaping utility
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
