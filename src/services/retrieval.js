function cosineSimilarity(a, b) {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function retrieveChunks(queryEmbedding, chunks, topK = 20) {
  const scored = chunks.map((chunk) => ({
    ...chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK);
}

export async function embedQuery(text, apiKey) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embeddings API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

export function formatRetrievedChunks(chunks) {
  const grouped = {};
  for (const chunk of chunks) {
    if (!grouped[chunk.source]) {
      grouped[chunk.source] = { priority: chunk.priority, texts: [] };
    }
    grouped[chunk.source].texts.push(chunk.text);
  }

  const sorted = Object.entries(grouped).sort(
    ([, a], [, b]) => a.priority - b.priority
  );

  return sorted
    .map(
      ([name, { priority, texts }]) =>
        `=== SOURCE: ${name} (Priority ${priority}) ===\n\n${texts.join('\n\n')}`
    )
    .join('\n\n');
}

const REWRITE_PROMPT = `You are a search query rewriter for a tennis rules database. The database contains:
- ITF Rules of Tennis (rules about play, scoring, hindrance, lets, point penalties)
- The Code (unofficiated match conduct — line calls, sportsmanship, hindrance)
- Friend at Court (USTA comments, officiating, penalties, unsportsmanlike conduct, defaults)
- USTA League Regulations (grievances, suspensions, league discipline)
- PNW League Regulations (local league rules, lateness, playoffs)

Given a user's tennis question, output 3-5 short search phrases a rulebook would use.
Think about ALL aspects: what happens during the point (hindrance, let, point loss), what penalties apply (warning, default), and what post-match processes exist (grievance, suspension).
Only output the phrases, one per line. No numbering, no explanation.`;

export async function rewriteQuery(userQuery, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4.1-nano',
      temperature: 0,
      max_completion_tokens: 100,
      messages: [
        { role: 'system', content: REWRITE_PROMPT },
        { role: 'user', content: userQuery },
      ],
    }),
  });

  if (!response.ok) {
    // Non-fatal: fall back to original query only
    console.warn('Query rewrite failed, using original query');
    return null;
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

export function retrieveChunksDualEmbed(queryEmbedding, rewriteEmbedding, chunks, topK = 20) {
  const scored = chunks.map((chunk) => {
    const scoreOriginal = cosineSimilarity(queryEmbedding, chunk.embedding);
    const scoreRewrite = rewriteEmbedding
      ? cosineSimilarity(rewriteEmbedding, chunk.embedding)
      : 0;
    // Weighted blend: rewrite can boost original by up to 30% of its advantage,
    // but cannot override a strong original ranking (prevents E027-style regressions)
    const REWRITE_WEIGHT = 0.3;
    const rewriteBoost = Math.max(0, scoreRewrite - scoreOriginal) * REWRITE_WEIGHT;
    return {
      ...chunk,
      score: scoreOriginal + rewriteBoost,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  // Diversity pass: ensure the best chunk from each source gets a slot
  // if it scored above a minimum relevance threshold, by appending (not replacing)
  const MIN_RELEVANCE = 0.38;
  const topChunks = scored.slice(0, topK);
  const sourcesPresent = new Set(topChunks.map((c) => c.source));

  const allSources = [...new Set(scored.map((c) => c.source))];
  for (const source of allSources) {
    if (sourcesPresent.has(source)) continue;
    const bestForSource = scored.find((c) => c.source === source);
    if (bestForSource && bestForSource.score >= MIN_RELEVANCE) {
      topChunks.push(bestForSource);
      sourcesPresent.add(source);
    }
  }

  topChunks.sort((a, b) => b.score - a.score);
  return topChunks;
}
