const db = require('./db');
const { fetchAllFeeds } = require('./rss');
const { selectAndSummarizeArticles } = require('./gemini');
const { sendNewsletterEmail } = require('./email');

/**
 * Main cron function that checks current date/time, matches subscribers,
 * fetches feeds, filters/summarizes with Gemini, and dispatches via Resend.
 * 
 * @param {string} hostUrl - Base URL of the web app (for unsubscribe links)
 * @returns {Promise<Object>} Execution report summary
 */
async function runMailingJob(hostUrl) {
  console.log('--- Starting news mailer cron job execution ---');
  
  // 1. Get current time in KST (UTC+9)
  const now = new Date();
  const dateInKST = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  
  const hours = String(dateInKST.getHours()).padStart(2, '0');
  const minutes = String(dateInKST.getMinutes()).padStart(2, '0');
  const currentTimeKST = `${hours}:${minutes}`; // "HH:MM"
  
  const daysOfWeek = ['일', '화', '수', '목', '금', '토', '일']; // Note: getDay() returns 0 for Sunday
  // Let's correct days mapping:
  const daysOfWeekKST = ['일', '월', '화', '수', '목', '금', '토'];
  const currentDayKST = daysOfWeekKST[dateInKST.getDay()]; // "월", "화" ...
  
  // Calculate start of today in KST
  const startOfTodayKST = new Date(dateInKST);
  startOfTodayKST.setHours(0, 0, 0, 0);

  console.log(`Current KST Time: ${currentTimeKST} (${currentDayKST}요일)`);
  console.log(`Checking logs from: ${startOfTodayKST.toISOString()} (KST Start of Today)`);

  // 2. Fetch subscribers who:
  // - Are active
  // - Scheduled for today
  // - Scheduled time is <= current time
  // - Haven't received a successful mailing yet today
  let subscribers = [];
  try {
    const queryText = `
      SELECT id, email, days, time, keywords, unsubscribe_token 
      FROM subscribers s
      WHERE s.active = true
        AND s.days LIKE $1
        AND s.time <= $2
        AND NOT EXISTS (
          SELECT 1 
          FROM send_logs l
          WHERE l.subscriber_id = s.id
            AND l.status = 'success'
            AND l.sent_at >= $3
        )
    `;
    const res = await db.query(queryText, [
      `%${currentDayKST}%`,
      currentTimeKST,
      startOfTodayKST
    ]);
    subscribers = res.rows;
  } catch (err) {
    console.error('Failed to query subscribers for sending:', err.message);
    return { success: false, error: err.message };
  }

  console.log(`Found ${subscribers.length} pending subscribers to process.`);
  if (subscribers.length === 0) {
    return { success: true, processedCount: 0, msg: 'No subscribers due for sending in this slot.' };
  }

  // 3. Fetch all active RSS articles once to share among subscribers
  let allArticles = [];
  try {
    allArticles = await fetchAllFeeds();
  } catch (err) {
    console.error('Failed to fetch RSS feeds:', err.message);
    // Continue with empty articles or handle error
  }

  if (allArticles.length === 0) {
    console.warn('No articles fetched from RSS feeds. Skipping send loop for safety.');
    return { success: true, processedCount: 0, msg: 'No RSS articles found to process.' };
  }

  let successCount = 0;
  let failCount = 0;
  const reports = [];

  // 4. Process each subscriber
  for (const sub of subscribers) {
    console.log(`Processing subscriber: ${sub.email}`);
    const keywordsList = sub.keywords
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0);

    try {
      // Get customized summarized articles
      const matchedArticles = await selectAndSummarizeArticles(allArticles, keywordsList);

      if (matchedArticles.length === 0) {
        console.log(`No matching articles for subscriber ${sub.email} with keywords: ${sub.keywords}`);
        
        // Log "success" with 0 articles so they aren't processed again today
        await db.query(
          'INSERT INTO send_logs (subscriber_id, status, article_count, error_message) VALUES ($1, $2, $3, $4)',
          [sub.id, 'success', 0, 'No articles matched user keywords today']
        );
        successCount++;
        reports.push({ email: sub.email, status: 'success', articles: 0, note: 'No matching articles' });
        continue;
      }

      // Send the newsletter
      console.log(`Sending email to ${sub.email} with ${matchedArticles.length} articles.`);
      const sent = await sendNewsletterEmail(sub.email, matchedArticles, sub.unsubscribe_token, hostUrl);

      if (sent) {
        // Log success
        await db.query(
          'INSERT INTO send_logs (subscriber_id, status, article_count) VALUES ($1, $2, $3)',
          [sub.id, 'success', matchedArticles.length]
        );
        successCount++;
        reports.push({ email: sub.email, status: 'success', articles: matchedArticles.length });
      } else {
        throw new Error('Email dispatch was skipped or failed.');
      }
    } catch (err) {
      console.error(`Error processing newsletter for ${sub.email}:`, err.message);
      
      // Log failure in send_logs (so admin can inspect)
      try {
        await db.query(
          'INSERT INTO send_logs (subscriber_id, status, article_count, error_message) VALUES ($1, $2, $3, $4)',
          [sub.id, 'failure', 0, err.message]
        );
      } catch (logErr) {
        console.error('Failed to write failure log to database:', logErr.message);
      }
      
      failCount++;
      reports.push({ email: sub.email, status: 'failure', error: err.message });
    }
  }

  console.log(`--- Finished mailing job: ${successCount} succeeded, ${failCount} failed ---`);
  return {
    success: true,
    processedCount: subscribers.length,
    successCount,
    failCount,
    reports
  };
}

module.exports = {
  runMailingJob
};
