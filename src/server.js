const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { runMailingJob } = require('./cron');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_signing_key_change_me';
const CRON_SECRET = process.env.CRON_SECRET || 'super_secret_cron_token_change_me';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Helpers
function getHostUrl(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  return `${protocol}://${req.get('host')}`;
}

// ----------------------------------------------------
// Middleware: Admin Authentication
// ----------------------------------------------------
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(412).json({ error: '인증 토큰이 필요합니다.' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(412).json({ error: '올바르지 않은 인증 양식입니다.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role === 'admin') {
      req.admin = decoded;
      return next();
    }
    return res.status(403).json({ error: '접근 권한이 없습니다.' });
  } catch (err) {
    return res.status(401).json({ error: '인증 토큰이 유효하지 않거나 만료되었습니다.' });
  }
}

// ----------------------------------------------------
// Public APIs
// ----------------------------------------------------

// 1. Subscribe
app.post('/api/subscribe', async (req, res) => {
  const { email, days, time, keywords } = req.body;

  // Validation
  if (!email || !days || !time || !keywords) {
    return res.status(400).json({ error: '모든 필수 입력 값을 기입해 주세요.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: '유효한 이메일 형식이 아닙니다.' });
  }

  // Parse days
  let daysStr = '';
  if (Array.isArray(days)) {
    daysStr = days.join(',');
  } else {
    daysStr = String(days);
  }

  // Parse keywords: limit to max 5
  let keywordArray = [];
  if (Array.isArray(keywords)) {
    keywordArray = keywords;
  } else {
    keywordArray = String(keywords).split(',').map(k => k.trim()).filter(k => k.length > 0);
  }

  if (keywordArray.length === 0) {
    return res.status(400).json({ error: '최소 1개 이상의 관심 키워드를 입력해 주세요.' });
  }
  if (keywordArray.length > 5) {
    keywordArray = keywordArray.slice(0, 5);
  }
  const keywordsStr = keywordArray.join(',');

  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(time)) {
    return res.status(400).json({ error: '시간 형식은 HH:MM 이어야 합니다.' });
  }

  try {
    // Generate unsubscribe token
    const token = uuidv4();

    // Check if subscriber already exists
    const checkRes = await db.query('SELECT id FROM subscribers WHERE email = $1', [email]);
    if (checkRes.rows.length > 0) {
      // Update subscriber settings and reactivate
      await db.query(
        `UPDATE subscribers 
         SET days = $1, time = $2, keywords = $3, active = true 
         WHERE email = $4`,
        [daysStr, time, keywordsStr, email]
      );
      return res.status(200).json({ message: '구독 신청이 성공적으로 갱신 및 활성화되었습니다.' });
    } else {
      // Insert new subscriber
      await db.query(
        `INSERT INTO subscribers (email, days, time, keywords, active, unsubscribe_token) 
         VALUES ($1, $2, $3, $4, true, $5)`,
        [email, daysStr, time, keywordsStr, token]
      );
      return res.status(201).json({ message: '맞춤 뉴스 구독 신청이 성공적으로 완료되었습니다.' });
    }
  } catch (err) {
    console.error('Subscription error:', err.message);
    return res.status(500).json({ error: '구독 신청 중 서버 에러가 발생했습니다.' });
  }
});

// 2. Unsubscribe via token
app.get('/api/unsubscribe', async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 50px; background-color: #f8fafc;">
          <h2 style="color: #ef4444;">잘못된 접근</h2>
          <p>구독 해지 토큰이 유효하지 않습니다.</p>
        </body>
      </html>
    `);
  }

  try {
    const result = await db.query(
      'UPDATE subscribers SET active = false WHERE unsubscribe_token = $1 RETURNING email',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 50px; background-color: #f8fafc;">
            <h2 style="color: #ef4444;">구독자를 찾을 수 없음</h2>
            <p>해당 토큰으로 등록된 구독 정보가 없습니다.</p>
          </body>
        </html>
      `);
    }

    const email = result.rows[0].email;
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>구독 해지 완료</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 60px 20px; display: flex; align-items: center; justify-content: center; min-height: 100vh; box-sizing: border-box; }
          .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -4px rgba(0, 0, 0, 0.05); text-align: center; max-width: 450px; width: 100%; border: 1px solid #e2e8f0; }
          h2 { color: #0f172a; margin-top: 0; font-size: 24px; font-weight: 800; }
          p { color: #64748b; font-size: 15px; line-height: 1.6; margin-bottom: 24px; }
          .badge { display: inline-block; background-color: #f1f5f9; color: #475569; padding: 6px 12px; border-radius: 8px; font-size: 14px; font-family: monospace; font-weight: bold; margin-bottom: 20px; }
          .btn { display: inline-block; background: #6366f1; color: white; text-decoration: none; padding: 12px 24px; border-radius: 10px; font-weight: 600; font-size: 14px; transition: background 0.2s; }
          .btn:hover { background: #4f46e5; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>구독이 성공적으로 해지되었습니다</h2>
          <p>이메일 수신 정보가 비활성화되었습니다. 더 이상 뉴스레터가 발송되지 않습니다.</p>
          <div class="badge">${email}</div>
          <div>
            <a href="/" class="btn">홈페이지로 돌아가기</a>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Unsubscribe error:', err.message);
    return res.status(500).send('구독 해지 중 오류가 발생했습니다.');
  }
});

// ----------------------------------------------------
// Admin & Authentication APIs
// ----------------------------------------------------

// 1. Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: '비밀번호를 입력해 주세요.' });
  }

  // Support both plain text environment password and bcrypt hashed password config
  let isMatch = false;
  try {
    if (ADMIN_PASSWORD.startsWith('$2a$') || ADMIN_PASSWORD.startsWith('$2b$')) {
      isMatch = bcrypt.compareSync(password, ADMIN_PASSWORD);
    } else {
      isMatch = (password === ADMIN_PASSWORD);
    }
  } catch (err) {
    isMatch = (password === ADMIN_PASSWORD);
  }

  if (isMatch) {
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ token });
  } else {
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  }
});

// 2. Statistics Summary
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
  try {
    // Total subscribers
    const totalRes = await db.query('SELECT COUNT(*) FROM subscribers');
    // Active subscribers
    const activeRes = await db.query('SELECT COUNT(*) FROM subscribers WHERE active = true');

    // Get KST start of today
    const now = new Date();
    const kstDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now); // E.g. "2026-06-20"
    
    const startOfTodayKST = new Date(`${kstDateStr}T00:00:00+09:00`);

    const sevenDaysAgoKST = new Date(startOfTodayKST);
    sevenDaysAgoKST.setDate(sevenDaysAgoKST.getDate() - 6); // past 7 days includes today

    // Emails sent in past 7 days
    const sentPastWeekRes = await db.query(
      "SELECT COUNT(*) FROM send_logs WHERE status = 'success' AND sent_at >= $1",
      [sevenDaysAgoKST]
    );

    // Emails sent today (KST) to estimate limit warning
    const sentTodayRes = await db.query(
      "SELECT SUM(CASE WHEN status = 'success' AND article_count > 0 THEN 1 ELSE 0 END) as sent_count FROM send_logs WHERE sent_at >= $1",
      [startOfTodayKST]
    );

    const emailsSentToday = parseInt(sentTodayRes.rows[0].sent_count || '0', 10);
    const dailyQuotaLimit = 100; // Resend free tier limit
    const warningThreshold = 80;

    return res.json({
      totalSubscribers: parseInt(totalRes.rows[0].count, 10),
      activeSubscribers: parseInt(activeRes.rows[0].count, 10),
      sentPastSevenDays: parseInt(sentPastWeekRes.rows[0].count, 10),
      emailsSentToday,
      quotaLimit: dailyQuotaLimit,
      isCloseToLimit: emailsSentToday >= warningThreshold
    });
  } catch (err) {
    console.error('Stats query failed:', err.message);
    return res.status(500).json({ error: '통계 정보를 조회하지 못했습니다.' });
  }
});

// 3. Subscribers management (GET/DELETE)
app.get('/api/admin/subscribers', authenticateAdmin, async (req, res) => {
  const { search } = req.query;

  try {
    let queryText = 'SELECT id, email, days, time, keywords, active, created_at FROM subscribers';
    const params = [];

    if (search) {
      queryText += ' WHERE email LIKE $1 OR keywords LIKE $1';
      params.push(`%${search}%`);
    }

    queryText += ' ORDER BY created_at DESC';

    const result = await db.query(queryText, params);
    return res.json(result.rows);
  } catch (err) {
    console.error('Failed to list subscribers:', err.message);
    return res.status(500).json({ error: '구독자 목록을 가져오지 못했습니다.' });
  }
});

app.delete('/api/admin/subscribers/:id', authenticateAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query('DELETE FROM subscribers WHERE id = $1 RETURNING email', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '해당 구독자를 찾을 수 없습니다.' });
    }
    return res.json({ message: '구독자 정보가 성공적으로 삭제되었습니다.', email: result.rows[0].email });
  } catch (err) {
    console.error('Failed to delete subscriber:', err.message);
    return res.status(500).json({ error: '구독자를 삭제하지 못했습니다.' });
  }
});

// 4. Send Logs (GET)
app.get('/api/admin/logs', authenticateAdmin, async (req, res) => {
  try {
    const queryText = `
      SELECT l.id, l.sent_at, l.status, l.article_count, l.error_message, s.email 
      FROM send_logs l
      LEFT JOIN subscribers s ON l.subscriber_id = s.id
      ORDER BY l.sent_at DESC
      LIMIT 100
    `;
    const result = await db.query(queryText);
    return res.json(result.rows);
  } catch (err) {
    console.error('Failed to query logs:', err.message);
    return res.status(500).json({ error: '로그 목록을 가져오지 못했습니다.' });
  }
});

// 5. RSS Sources (GET/POST/DELETE)
app.get('/api/admin/rss', authenticateAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT id, url, category, active FROM rss_sources ORDER BY created_at DESC');
    return res.json(result.rows);
  } catch (err) {
    console.error('Failed to query RSS sources:', err.message);
    return res.status(500).json({ error: 'RSS 소스를 가져오지 못했습니다.' });
  }
});

app.post('/api/admin/rss', authenticateAdmin, async (req, res) => {
  const { url, category } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'RSS URL을 입력해 주세요.' });
  }

  try {
    const check = await db.query('SELECT id FROM rss_sources WHERE url = $1', [url]);
    if (check.rows.length > 0) {
      return res.status(400).json({ error: '이미 등록된 RSS 피드 URL입니다.' });
    }

    const result = await db.query(
      'INSERT INTO rss_sources (url, category, active) VALUES ($1, $2, true) RETURNING id, url, category, active',
      [url, category || '미지정']
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Failed to add RSS source:', err.message);
    return res.status(500).json({ error: 'RSS 피드를 추가하지 못했습니다.' });
  }
});

app.delete('/api/admin/rss/:id', authenticateAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query('DELETE FROM rss_sources WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '해당 RSS 소스를 찾을 수 없습니다.' });
    }
    return res.json({ message: 'RSS 피드가 삭제되었습니다.' });
  } catch (err) {
    console.error('Failed to delete RSS source:', err.message);
    return res.status(500).json({ error: 'RSS 피드를 삭제하지 못했습니다.' });
  }
});

// Toggle RSS active state
app.put('/api/admin/rss/:id/toggle', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const { active } = req.body;

  if (active === undefined) {
    return res.status(400).json({ error: '활성화 상태값(active)이 필요합니다.' });
  }

  try {
    const result = await db.query(
      'UPDATE rss_sources SET active = $1 WHERE id = $2 RETURNING id, active',
      [active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '해당 RSS 소스를 찾을 수 없습니다.' });
    }

    return res.json({ message: 'RSS 피드 상태가 변경되었습니다.', active: result.rows[0].active });
  } catch (err) {
    console.error('Failed to toggle RSS status:', err.message);
    return res.status(500).json({ error: 'RSS 피드 상태를 수정하지 못했습니다.' });
  }
});

// 6. Manual trigger dispatch for testing (specific user or all)
app.post('/api/admin/send-manual', authenticateAdmin, async (req, res) => {
  const { subscriberId } = req.body;
  const hostUrl = getHostUrl(req);

  try {
    const { fetchAllFeeds } = require('./rss');
    const { selectAndSummarizeArticles } = require('./gemini');
    const { sendNewsletterEmail } = require('./email');

    // Fetch active RSS feeds once
    const allArticles = await fetchAllFeeds();
    if (allArticles.length === 0) {
      return res.status(400).json({ error: '수집된 RSS 기사가 전혀 없습니다.' });
    }

    let targets = [];
    if (subscriberId) {
      const resSub = await db.query(
        'SELECT id, email, keywords, unsubscribe_token FROM subscribers WHERE id = $1 AND active = true',
        [subscriberId]
      );
      targets = resSub.rows;
      if (targets.length === 0) {
        return res.status(404).json({ error: '활성화된 해당 구독자를 찾을 수 없습니다.' });
      }
    } else {
      // Send to all active subscribers
      const resSub = await db.query(
        'SELECT id, email, keywords, unsubscribe_token FROM subscribers WHERE active = true'
      );
      targets = resSub.rows;
      if (targets.length === 0) {
        return res.status(400).json({ error: '수동 발송을 진행할 활성화된 구독자가 없습니다.' });
      }
    }

    let success = 0;
    let failed = 0;
    const details = [];

    for (const sub of targets) {
      const keywordsList = sub.keywords.split(',').map(k => k.trim()).filter(k => k.length > 0);
      try {
        const matchedArticles = await selectAndSummarizeArticles(allArticles, keywordsList);
        
        if (matchedArticles.length === 0) {
          await db.query(
            "INSERT INTO send_logs (subscriber_id, status, article_count, error_message) VALUES ($1, 'success', 0, '수동 발송: 매칭되는 뉴스 기사가 없음')",
            [sub.id]
          );
          details.push({ email: sub.email, status: 'success', articles: 0, note: 'No matching articles' });
          success++;
          continue;
        }

        const sent = await sendNewsletterEmail(sub.email, matchedArticles, sub.unsubscribe_token, hostUrl);
        if (sent) {
          await db.query(
            'INSERT INTO send_logs (subscriber_id, status, article_count) VALUES ($1, $2, $3)',
            [sub.id, 'success', matchedArticles.length]
          );
          details.push({ email: sub.email, status: 'success', articles: matchedArticles.length });
          success++;
        } else {
          throw new Error('이메일 전송에 실패했습니다.');
        }
      } catch (err) {
        await db.query(
          "INSERT INTO send_logs (subscriber_id, status, article_count, error_message) VALUES ($1, 'failure', 0, $2)",
          [sub.id, `수동 발송 에러: ${err.message}`]
        );
        details.push({ email: sub.email, status: 'failure', error: err.message });
        failed++;
      }
    }

    return res.json({
      message: '수동 뉴스 발송 처리가 완료되었습니다.',
      totalTargets: targets.length,
      successCount: success,
      failCount: failed,
      details
    });
  } catch (err) {
    console.error('Manual send failed:', err.message);
    return res.status(500).json({ error: `수동 뉴스 발송 도중 오류가 발생했습니다: ${err.message}` });
  }
});

// ----------------------------------------------------
// Cron Trigger Endpoints (Secured by Secret)
// ----------------------------------------------------
app.all('/api/cron/send', async (req, res) => {
  // Authorize via Authorization Header or Query Parameter
  const authHeader = req.headers['authorization'];
  const authParam = req.query.secret;

  let requestSecret = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    requestSecret = authHeader.substring(7);
  } else if (authParam) {
    requestSecret = authParam;
  }

  if (requestSecret !== CRON_SECRET) {
    return res.status(403).json({ error: '허가되지 않은 접근입니다. 올바른 CRON_SECRET 토큰을 제공해야 합니다.' });
  }

  const hostUrl = getHostUrl(req);
  try {
    const result = await runMailingJob(hostUrl);
    return res.json({
      message: '크론 발송 체크 작업이 완료되었습니다.',
      details: result
    });
  } catch (err) {
    console.error('Cron job router error:', err.message);
    return res.status(500).json({ error: `크론 작업 도중 치명적 에러 발생: ${err.message}` });
  }
});

// Server bootup
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Unsubscribe endpoints will use absolute links relative to caller host.`);
});
