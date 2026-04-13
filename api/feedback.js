export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { rating, query, response, comment, email } = req.body;

  if (!rating || !['positive', 'negative', 'source-suggestion'].includes(rating)) {
    return res.status(400).json({ error: 'Invalid rating.' });
  }

  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'Query is required.' });
  }

  const feedback = {
    timestamp: new Date().toISOString(),
    rating,
    query: query.trim(),
    response: typeof response === 'string' ? response.trim().substring(0, 2000) : undefined,
    comment: typeof comment === 'string' ? comment.trim().substring(0, 1000) : undefined,
    email: typeof email === 'string' ? email.trim().substring(0, 200) : undefined,
  };

  // Structured log — visible in Vercel function logs (Runtime Logs dashboard)
  console.log(JSON.stringify({ type: 'FEEDBACK', ...feedback }));

  // Forward to Google Sheet for persistent storage + auto-reply
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK;
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feedback),
      });
    } catch (err) {
      console.error('Google Sheet webhook failed:', err.message);
    }
  }

  return res.status(200).json({ success: true });
}
