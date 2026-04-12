import { buildChatPayload, buildRagPayload } from '../src/services/payloadBuilder.js';
import { retrieveChunks, retrieveChunksDualEmbed, embedQuery, rewriteQuery, formatRetrievedChunks } from '../src/services/retrieval.js';
import { createRateLimiter } from '../src/services/rateLimiter.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '../src/data');

const sourceFiles = [
  'pnw-league-regs.json',
  'usta-league-regs.json',
  'the-code.json',
  'friend-at-court-unique.json',
  'itf-rules.json',
];

const sources = sourceFiles.map((file) =>
  JSON.parse(readFileSync(join(dataDir, file), 'utf-8'))
);

const embeddingsPath = join(dataDir, 'embeddings.json');
const useRag = existsSync(embeddingsPath);
const embeddings = useRag ? JSON.parse(readFileSync(embeddingsPath, 'utf-8')) : null;

const limiter = createRateLimiter({
  maxRequests: 20,
  windowMs: 24 * 60 * 60 * 1000,
});

async function buildRagRequest(messages) {
  // Build query from recent user messages so follow-ups have context
  // e.g. "What happens if my opponent is 12 minutes late?" + "what about sectionals"
  const userMessages = messages
    .filter((m) => m.role === 'user')
    .slice(-3)
    .map((m) => m.content);
  const queryText = userMessages.join(' ');

  const apiKey = process.env.OPENAI_API_KEY;

  // Dual-embed: original query + LLM-rewritten search terms
  const [queryEmbedding, rewrittenText] = await Promise.all([
    embedQuery(queryText, apiKey),
    rewriteQuery(queryText, apiKey),
  ]);

  const rewriteEmbedding = rewrittenText
    ? await embedQuery(rewrittenText, apiKey)
    : null;

  const relevantChunks = retrieveChunksDualEmbed(queryEmbedding, rewriteEmbedding, embeddings);
  const context = formatRetrievedChunks(relevantChunks);

  return buildRagPayload(messages, context);
}

export async function handleChatRequest(req, res) {
  const { messages } = req.body || {};

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Request must include a non-empty messages array.' });
  }

  const ip = req.headers['x-forwarded-for'] || 'unknown';
  const bypassKey = req.headers['x-api-key'];
  const validBypass = process.env.RATE_LIMIT_BYPASS_KEY && bypassKey === process.env.RATE_LIMIT_BYPASS_KEY;

  let rateResult = { allowed: true, remaining: null };
  if (!validBypass) {
    rateResult = limiter.check(ip);
    if (!rateResult.allowed) {
      return res.status(429).json({
        error: 'Daily question limit reached. Please try again tomorrow.',
        retryAfter: rateResult.retryAfter,
      });
    }
  }

  const payload = useRag
    ? await buildRagRequest(messages)
    : buildChatPayload(messages, sources);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error(`OpenAI API error: ${response.status} ${response.statusText}`, errorBody);
      return res.status(502).json({ error: 'AI service returned an error.' });
    }

    const data = await response.json();
    const assistantMessage = data.choices[0].message.content;

    return res.status(200).json({
      message: assistantMessage,
      remaining: rateResult.remaining,
    });
  } catch {
    return res.status(502).json({ error: 'AI service is currently unavailable.' });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  return handleChatRequest(req, res);
}
