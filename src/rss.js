const Parser = require('rss-parser');
const db = require('./db');

const parser = new Parser({
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' },
  timeout: 5000 // 5 seconds timeout per feed
});

/**
 * Fetches articles from all active RSS feeds in the database.
 * If database is unavailable, returns a fallback set of articles for safety.
 * Each feed fetching is wrapped in an individual try-catch to be robust.
 * 
 * @returns {Promise<Array>} List of articles with title, content, link, pubDate, sourceCategory
 */
async function fetchAllFeeds() {
  let feeds = [];
  try {
    const res = await db.query('SELECT url, category FROM rss_sources WHERE active = true');
    feeds = res.rows;
  } catch (err) {
    console.error('Failed to load RSS feeds from database, using fallback defaults:', err.message);
    // Fallback default feeds if db fails
    feeds = [
      { url: 'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko', category: 'Google 뉴스 (종합)' }
    ];
  }

  const articles = [];

  for (const feed of feeds) {
    try {
      console.log(`Fetching RSS feed: ${feed.url} (${feed.category})`);
      const parsedFeed = await parser.parseURL(feed.url);
      
      for (const item of parsedFeed.items) {
        // Build clean content snippet from contentSnippet, content, or summary
        const contentSnippet = item.contentSnippet || item.content || '';
        
        articles.push({
          title: item.title || '제목 없음',
          content: contentSnippet.substring(0, 1000), // Cap length
          link: item.link || '',
          pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
          category: feed.category || '기타'
        });
      }
    } catch (err) {
      // Robust: individual feed failures should NOT crash the aggregate crawler
      console.error(`Error processing feed ${feed.url}:`, err.message);
    }
  }

  console.log(`Fetched total ${articles.length} articles from active feeds.`);
  return articles;
}

module.exports = {
  fetchAllFeeds
};
