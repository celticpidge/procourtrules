const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const dataDir = join(__dirname, 'src', 'data');

const sourceFiles = [
  'pnw-league-regs.json',
  'usta-league-regs.json',
  'the-code.json',
  'friend-at-court-unique.json',
  'itf-rules.json',
];

const CHUNK_SIZE = 500; // target tokens (~4 chars per token)
const CHUNK_OVERLAP = 50; // overlap in tokens

function chunkText(text, sourceName, sourceId, priority) {
  const words = text.split(/\s+/);
  const chunkWordCount = CHUNK_SIZE * 4 / 5; // rough words-per-chunk (~400 words ≈ 500 tokens)
  const overlapWords = CHUNK_OVERLAP * 4 / 5;
  const chunks = [];

  for (let i = 0; i < words.length; i += chunkWordCount - overlapWords) {
    const chunkWords = words.slice(i, i + chunkWordCount);
    if (chunkWords.length < 20) break; // skip tiny trailing chunks

    chunks.push({
      id: `${sourceId}-${chunks.length}`,
      source: sourceName,
      sourceId,
      priority,
      text: chunkWords.join(' '),
    });
  }

  return chunks;
}

async function embedChunks(chunks, apiKey) {
  const batchSize = 100; // OpenAI allows up to 2048 inputs per request
  const allEmbeddings = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map((c) => c.text);

    console.log(`  Embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(chunks.length / batchSize)} (${texts.length} chunks)...`);

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: texts,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI embeddings API error: ${response.status} ${err}`);
    }

    const data = await response.json();
    const embeddings = data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    allEmbeddings.push(...embeddings);
  }

  return allEmbeddings;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Error: OPENAI_API_KEY environment variable is required.');
    console.error('Set it with: $env:OPENAI_API_KEY="sk-..."');
    process.exit(1);
  }

  console.log('Step 1: Chunking source documents...\n');

  const allChunks = [];
  for (const file of sourceFiles) {
    const source = JSON.parse(readFileSync(join(dataDir, file), 'utf-8'));
    const chunks = chunkText(source.content, source.name, source.id, source.priority);
    allChunks.push(...chunks);
    console.log(`  ${source.name}: ${chunks.length} chunks`);
  }

  console.log(`\nTotal: ${allChunks.length} chunks\n`);

  console.log('Step 2: Generating embeddings...\n');

  const embeddings = await embedChunks(allChunks, apiKey);

  console.log(`\nGenerated ${embeddings.length} embeddings (dimension: ${embeddings[0].length})\n`);

  console.log('Step 3: Saving embeddings...\n');

  const output = allChunks.map((chunk, i) => ({
    ...chunk,
    embedding: embeddings[i],
  }));

  const outputPath = join(dataDir, 'embeddings.json');
  writeFileSync(outputPath, JSON.stringify(output));

  const sizeMB = (Buffer.byteLength(JSON.stringify(output)) / 1024 / 1024).toFixed(1);
  console.log(`  Saved ${output.length} chunks with embeddings to embeddings.json (${sizeMB} MB)`);
  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
