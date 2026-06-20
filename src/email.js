require('dotenv').config();

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_FROM_EMAIL = process.env.BREVO_FROM_EMAIL;

/**
 * Sends a newsletter email to a subscriber via the Resend HTTP API.
 * If API Key is missing, simulates the send for easy testing.
 * 
 * @param {string} toEmail - Subscriber's email address
 * @param {Array} articles - Summarized articles { title, summary, link, category }
 * @param {string} unsubscribeToken - Subscriber's unsubscribe token
 * @param {string} hostUrl - Base URL of the app (e.g., http://localhost:3000) for unsubscribe links
 * @returns {Promise<boolean>} Resolves to true if sent, false otherwise
 */
async function sendNewsletterEmail(toEmail, articles, unsubscribeToken, hostUrl) {
  if (!articles || articles.length === 0) {
    console.log(`Skipping email to ${toEmail} as there are no matching articles.`);
    return false;
  }

  const unsubscribeLink = `${hostUrl}/api/unsubscribe?token=${unsubscribeToken}`;

  // Build the email HTML
  const articleHtml = articles.map(art => `
    <div style="background-color: #ffffff; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
      <span style="background-color: #6366f1; color: #ffffff; font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.05em;">
        ${art.category}
      </span>
      <h3 style="margin-top: 10px; margin-bottom: 8px; font-size: 18px; color: #1e293b; font-family: system-ui, -apple-system, sans-serif;">
        ${art.title}
      </h3>
      <p style="color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 12px; font-family: system-ui, -apple-system, sans-serif;">
        ${art.summary}
      </p>
      <a href="${art.link}" target="_blank" style="color: #4f46e5; text-decoration: none; font-weight: 600; font-size: 14px; font-family: system-ui, -apple-system, sans-serif; display: inline-flex; align-items: center;">
        원문 보기 &rarr;
      </a>
    </div>
  `).join('');

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>맞춤 키워드 뉴스레터</title>
    </head>
    <body style="background-color: #f8fafc; margin: 0; padding: 40px 20px; font-family: system-ui, -apple-system, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto;">
        <!-- Header -->
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #0f172a; font-size: 26px; font-weight: 800; margin: 0; font-family: system-ui, -apple-system, sans-serif; letter-spacing: -0.025em;">
            📰 키워드 맞춤 뉴스레터
          </h1>
          <p style="color: #64748b; font-size: 14px; margin-top: 8px;">
            신청하신 키워드에 따른 오늘의 맞춤 정보입니다.
          </p>
        </div>

        <!-- Articles -->
        ${articleHtml}

        <!-- Footer -->
        <div style="text-align: center; margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 20px;">
          <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 0;">
            본 메일은 구독 신청하신 이메일(${toEmail})로 발송되었습니다.
          </p>
          <p style="margin-top: 10px;">
            <a href="${unsubscribeLink}" style="color: #ef4444; font-size: 12px; font-weight: 600; text-decoration: underline;">
              구독 해지 (Unsubscribe)
            </a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  if (!BREVO_API_KEY) {
    console.log(`[MOCK EMAIL] Sending email to: ${toEmail}`);
    console.log(`[MOCK EMAIL] Subject: [키워드 맞춤 뉴스] 오늘의 요약 기사 ${articles.length}건`);
    console.log(`[MOCK EMAIL] Unsubscribe Link: ${unsubscribeLink}`);
    // Simulate successful send in development without Brevo key
    return true;
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        sender: {
          name: '뉴스 요약 알리미',
          email: BREVO_FROM_EMAIL
        },
        to: [
          {
            email: toEmail
          }
        ],
        subject: `[키워드 맞춤 뉴스] 오늘의 요약 기사 ${articles.length}건`,
        htmlContent: htmlBody
      })
    });

    if (res.status === 201 || res.ok) {
      const data = await res.json();
      console.log(`Email successfully sent to ${toEmail}. Brevo Message ID: ${data.messageId}`);
      return true;
    } else {
      const errText = await res.text();
      console.error(`Brevo API Error sending to ${toEmail}:`, errText);
      throw new Error(`Brevo HTTP status ${res.status}: ${errText}`);
    }
  } catch (error) {
    console.error(`Failed to send email via Brevo to ${toEmail}:`, error.message);
    throw error;
  }
}

module.exports = {
  sendNewsletterEmail
};
