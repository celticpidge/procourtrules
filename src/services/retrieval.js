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
