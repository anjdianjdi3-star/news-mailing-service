require('dotenv').config();
const db = require('./src/db');
const { fetchAllFeeds } = require('./src/rss');
const { selectAndSummarizeArticles } = require('./src/gemini');

async function runTests() {
  console.log('============= 🛠️ 개발 연결성 테스트 시작 =============\n');

  // Test 1: PostgreSQL Connection
  console.log('1. PostgreSQL 연결 테스트 중...');
  try {
    const res = await db.query('SELECT NOW() as current_time');
    console.log('✅ DB 연결 성공! 서버 현재 시간:', res.rows[0].current_time);
    
    // Check tables existence
    const tablesCheck = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('subscribers', 'rss_sources', 'send_logs')
    `);
    
    console.log('🔍 발견된 테이블 목록:', tablesCheck.rows.map(r => r.table_name).join(', ') || '없음 (schema.sql을 DB에서 실행해 주세요)');
  } catch (err) {
    console.error('❌ DB 연결 실패:', err.message);
    console.log('👉 .env 파일의 DATABASE_URL을 확인하거나 Neon/Supabase DB 활성화 상태를 점검하세요.');
  }

  // Test 2: RSS Crawler
  console.log('\n2. RSS 피드 수집 테스트 중...');
  let articles = [];
  try {
    articles = await fetchAllFeeds();
    console.log(`✅ RSS 수집 성공! 수집된 기사 수: ${articles.length}건`);
    if (articles.length > 0) {
      console.log(`📌 대표 기사 제목: "${articles[0].title}" [카테고리: ${articles[0].category}]`);
    }
  } catch (err) {
    console.error('❌ RSS 수집 실패:', err.message);
  }

  // Test 3: Gemini API Connection
  console.log('\n3. Gemini API & 요약 테스트 중...');
  if (!process.env.GEMINI_API_KEY) {
    console.log('⚠️ GEMINI_API_KEY가 없습니다. Fallback 요약 모드로만 동작합니다.');
  } else {
    try {
      const sampleArticles = [
        { title: '인공지능 발전과 미래 산업의 관계', content: '인공지능 기술의 진보는 로봇공학, 스마트 그리드 등 다양한 분야와 융합하며 성장을 이끕니다.', link: 'https://example.com/ai', category: 'IT/과학', pubDate: new Date().toISOString() }
      ];
      const result = await selectAndSummarizeArticles(sampleArticles, ['인공지능']);
      console.log('✅ Gemini API 연동 성공!');
      console.log('📝 생성된 한줄 요약:', result[0]?.summary || '요약 결과 없음');
    } catch (err) {
      console.error('❌ Gemini API 호출 오류:', err.message);
    }
  }

  // Test 4: Brevo Mailer Configurations
  console.log('\n4. Brevo 이메일 발송 환경변수 검사...');
  if (!process.env.BREVO_API_KEY) {
    console.log('⚠️ BREVO_API_KEY가 설정되지 않았습니다. 메일은 실제 발송되지 않고 Mock(가상)으로 로깅됩니다.');
  } else {
    console.log('✅ Brevo API Key 설정 확인됨. (실제 발송은 수동 테스트 또는 크론 구동 시 진행)');
  }

  console.log('\n======================================================');
  console.log('연결성 테스트 완료. 풀 테스트 종료를 위해 Ctrl+C를 눌러 프로세스를 마칠 수 있습니다.');
  
  // Close database pool to let process exit
  db.pool.end();
}

runTests();
