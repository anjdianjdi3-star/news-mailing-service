const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

let ai = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} else {
  console.warn('WARNING: GEMINI_API_KEY is not set in environment variables. Running in Mock/Fallback Summarizer mode.');
}

/**
 * Filter and summarize articles based on keywords using Gemini.
 * Falls back to local heuristic summarizer if GEMINI_API_KEY is not present.
 * 
 * @param {Array} articles - Array of article objects { title, content, link, category, pubDate }
 * @param {Array} keywords - Array of strings (keywords)
 * @returns {Promise<Array>} Selected and summarized articles
 */
async function selectAndSummarizeArticles(articles, keywords) {
  if (!articles || articles.length === 0) return [];
  if (!keywords || keywords.length === 0) return [];

  // 1. Initial heuristic filter: title or content must contain at least one keyword (case insensitive)
  const kwLower = keywords.map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
  if (kwLower.length === 0) return [];

  const matchedArticles = articles.filter(art => {
    const textToSearch = `${art.title} ${art.content}`.toLowerCase();
    return kwLower.some(kw => textToSearch.includes(kw));
  });

  if (matchedArticles.length === 0) {
    console.log(`No articles matched keywords: ${keywords.join(', ')}`);
    return [];
  }

  // Cap matched articles to top 10 most recent to keep token counts small and prompt cost-effective
  const candidateArticles = matchedArticles
    .slice(0, 12)
    .map((art, idx) => ({
      index: idx,
      title: art.title,
      content: art.content.substring(0, 400), // pass a snippet
      category: art.category
    }));

  console.log(`Matched ${matchedArticles.length} articles locally. Sending ${candidateArticles.length} candidates to Gemini.`);

  // If Gemini API is not configured, run local mock summarizer to avoid failing
  if (!ai) {
    return runMockSummarizer(matchedArticles.slice(0, 3), keywords);
  }

  const prompt = `
당신은 뉴스 요약 어시스턴트입니다. 다음 뉴스 기사 후보 중에서 사용자 관심 키워드 [${keywords.join(', ')}]와 가장 관련성이 높은 기사 3~5개를 선정하고, 각 기사의 핵심 내용을 한국어로 1줄 요약해 주세요.

[관심 키워드]: ${keywords.join(', ')}

[뉴스 기사 후보 목록]:
${JSON.stringify(candidateArticles, null, 2)}

[요청 사항]:
1. 후보 중 관련도가 가장 높은 기사를 최소 3개, 최대 5개 선택하세요.
2. 각 기사에 대해:
   - 한국어 제목 (원래 기사의 제목을 참고하여 정돈)
   - 핵심 내용 1줄 요약 (명확하고 정돈된 경어체(~입니다, ~합니다)로 작성)
   - 원래 후보 목록에서의 index 값 (원래 기사 링크와 매칭을 위함)
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            selectedArticles: {
              type: 'array',
              description: '선택 및 요약된 기사 목록',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: '기사 제목' },
                  summary: { type: 'string', description: '한 줄 요약 (존댓말)' },
                  originalIndex: { type: 'integer', description: '후보 기사 목록에서의 0부터 시작하는 index' }
                },
                required: ['title', 'summary', 'originalIndex']
              }
            }
          },
          required: ['selectedArticles']
        }
      }
    });

    const resultText = response.text;
    const resultObj = JSON.parse(resultText);
    
    const summarized = [];
    if (resultObj && Array.isArray(resultObj.selectedArticles)) {
      for (const item of resultObj.selectedArticles) {
        const origIdx = item.originalIndex;
        if (origIdx >= 0 && origIdx < matchedArticles.length) {
          const orig = matchedArticles[origIdx];
          summarized.push({
            title: item.title || orig.title,
            summary: item.summary,
            link: orig.link,
            category: orig.category,
            pubDate: orig.pubDate
          });
        }
      }
    }
    
    return summarized;
  } catch (err) {
    console.error('Gemini API call failed, falling back to local heuristic summaries:', err);
    return runMockSummarizer(matchedArticles.slice(0, 3), keywords);
  }
}

/**
 * Fallback heuristic summarizer when Gemini is unavailable
 */
function runMockSummarizer(articles, keywords) {
  console.log('Running fallback local heuristic summarizer...');
  return articles.map(art => {
    // Generate a simple sentence summary based on content snippet
    let summary = art.content.trim();
    if (summary.length > 80) {
      summary = summary.substring(0, 80) + '...';
    }
    if (!summary.endsWith('.')) {
      summary += '.';
    }
    return {
      title: art.title,
      summary: `[Fallback 요약] 키워드(${keywords.slice(0, 2).join(', ')})와 매칭된 기사입니다. 내용: ${summary}`,
      link: art.link,
      category: art.category,
      pubDate: art.pubDate
    };
  });
}

module.exports = {
  selectAndSummarizeArticles
};
