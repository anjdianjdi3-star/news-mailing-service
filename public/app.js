document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('subscribe-form');
  const timeSelect = document.getElementById('time');
  const keywordInput = document.getElementById('keyword-input');
  const addKeywordBtn = document.getElementById('add-keyword-btn');
  const tagsContainer = document.getElementById('tags-container');
  const alertBox = document.getElementById('alert-box');

  const keywords = new Set();

  // 1. Populate time dropdown in 30-minute intervals (00:00 to 23:30)
  for (let hour = 0; hour < 24; hour++) {
    const hh = String(hour).padStart(2, '0');
    ['00', '30'].forEach(mm => {
      const timeStr = `${hh}:${mm}`;
      const option = document.createElement('option');
      option.value = timeStr;
      option.textContent = timeStr;
      // Default choice: 08:00
      if (timeStr === '08:00') {
        option.selected = true;
      }
      timeSelect.appendChild(option);
    });
  }

  // 2. Alert Box helper
  function showAlert(message, type = 'success') {
    alertBox.className = `alert alert-${type}`;
    alertBox.innerHTML = `
      <span>${type === 'success' ? '✅' : '❌'}</span>
      <div>${message}</div>
    `;
    alertBox.style.display = 'flex';
    alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideAlert() {
    alertBox.style.display = 'none';
  }

  // 3. Keyword tags manager
  function renderTags() {
    tagsContainer.innerHTML = '';
    keywords.forEach(kw => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.innerHTML = `
        ${escapeHtml(kw)}
        <span class="remove-btn" data-keyword="${escapeHtml(kw)}">&times;</span>
      `;
      tagsContainer.appendChild(tag);
    });
  }

  function addKeyword(val) {
    hideAlert();
    const cleanVal = val.replace(/,/g, '').trim();
    if (!cleanVal) return;

    if (keywords.size >= 5) {
      showAlert('관심 키워드는 최대 5개까지 등록할 수 있습니다.', 'error');
      return;
    }

    keywords.add(cleanVal);
    keywordInput.value = '';
    renderTags();
  }

  // Trigger keyword additions
  keywordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKeyword(keywordInput.value);
    } else if (e.key === ',') {
      e.preventDefault();
      addKeyword(keywordInput.value);
    }
  });

  addKeywordBtn.addEventListener('click', () => {
    addKeyword(keywordInput.value);
  });

  // Remove tag
  tagsContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-btn')) {
      const kw = e.target.getAttribute('data-keyword');
      keywords.delete(kw);
      renderTags();
    }
  });

  // 4. Form Submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    const email = document.getElementById('email').value.trim();
    const time = timeSelect.value;
    
    // Gather days
    const checkedDays = Array.from(document.querySelectorAll('.day-checkbox:checked'))
      .map(cb => cb.value);

    // Validation checks
    if (!email) {
      showAlert('이메일 주소를 입력해 주세요.', 'error');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showAlert('올바른 이메일 주소 형식이 아닙니다.', 'error');
      return;
    }

    if (checkedDays.length === 0) {
      showAlert('최소 하루 이상의 수신 요일을 선택해 주세요.', 'error');
      return;
    }

    if (keywords.size === 0) {
      showAlert('최소 1개 이상의 관심 키워드를 등록해 주세요.', 'error');
      return;
    }

    const payload = {
      email,
      days: checkedDays,
      time,
      keywords: Array.from(keywords)
    };

    try {
      const response = await fetch('/api/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (response.ok) {
        showAlert(result.message || '구독 신청이 완료되었습니다!', 'success');
        form.reset();
        keywords.clear();
        renderTags();
        // Reset defaults
        document.getElementById('time').value = '08:00';
      } else {
        showAlert(result.error || '구독 신청 도중 오류가 발생했습니다.', 'error');
      }
    } catch (err) {
      console.error('Subscription API failure:', err);
      showAlert('서버와의 통신이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.', 'error');
    }
  });

  // HTML escaping utility
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
