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

const TARGET_WORDS = 240; // target words per chunk
const OVERLAP_WORDS = 24; // overlap in words

// Sub-section markers that indicate a distinct rule context within a section.
// These insert line breaks in the source text so the chunker can split on them.
const SUB_SECTION_MARKERS = [
  { pattern: /2\.01C\(5\)b \(PNW REG\) - When a player is late/g, prefix: '2.01C(5)b LATENESS PENALTIES - REGULAR LOCAL LEAGUE MATCHES.' },
  { pattern: /Single Weekend Leagues and Local\s+League Playoff/g, prefix: '2.01C(5)b LATENESS PENALTIES - WEEKEND LEAGUES AND LOCAL LEAGUE PLAYOFFS.' },
];

function preProcessText(text) {
  for (const marker of SUB_SECTION_MARKERS) {
    text = text.replace(marker.pattern, `\n${marker.prefix}\n$&`);
  }
  return text;
}

/**
 * Detect section headings in source text lines.
 * Returns the heading string if the line is a heading, null otherwise.
 */
function extractHeading(line) {
  // Regulation-style: "1.02A TITLE...", "1.04 USTA LEAGUE.", "2.01C(5)b LATENESS..."
  const regMatch = line.match(/^(\d+\.\d{2}[A-Z]?(?:\(\d+\))?[a-z]?)\s+([A-Z].+)/);
  if (regMatch) {
    const num = regMatch[1];
    let title = regMatch[2];
    // Truncate at first period followed by space (end of heading title)
    const periodIdx = title.search(/\.\s/);
    if (periodIdx > 0) title = title.substring(0, periodIdx);
    if (title.length > 80) title = title.substring(0, 80);
    return `${num} ${title}`;
  }

  // ITF Rule style: "Rule 1 THE COURT 2" (strip trailing page number)
  const ruleMatch = line.match(/^(Rule \d+\s+[A-Z][A-Z\s]+)/i);
  if (ruleMatch) {
    return ruleMatch[1].replace(/\s+\d+\s*$/, '').trim();
  }

  // USTA Comment style: "USTA Comment 1.1: ..."
  const commentMatch = line.match(/^(USTA Comment \d+\.\d+):/);
  if (commentMatch) {
    return commentMatch[1];
  }

  // Numbered rule heading: "2. PERMANENT FIXTURES"
  if (/^\d+\.\s+[A-Z][A-Z\s&]+$/.test(line) && !/\s{3,}/.test(line)) {
    return line;
  }

  // ALL CAPS standalone section headers (e.g. "MAKING CALLS", "WARM-UP")
  // Require 2+ words of 2+ chars to avoid table column headers
  if (
    /^[A-Z][A-Z\s&,\-]{3,}$/.test(line) &&
    line.length >= 4 &&
    line.length <= 60 &&
    !/\s{3,}/.test(line) &&
    line.split(/\s+/).filter((w) => w.length >= 2).length >= 2
  ) {
    return line;
  }

  return null;
}

function chunkText(text, sourceName, sourceId, priority) {
  const lines = preProcessText(text).split('\n');

  // Build word array annotated with current section heading
  let currentHeading = null;
  const annotatedWords = [];

  for (const line of lines) {
    const heading = extractHeading(line.trim());
    if (heading) {
      currentHeading = heading;
    }
    const lineWords = line.split(/\s+/).filter((w) => w);
    for (const word of lineWords) {
      annotatedWords.push({ word, heading: currentHeading });
    }
  }

  const chunkWordCount = TARGET_WORDS;
  const overlapWords = OVERLAP_WORDS;
  const chunks = [];

  let i = 0;
  while (i < annotatedWords.length) {
    // Determine the natural end of this chunk: either chunkWordCount or a heading change
    const startHeading = annotatedWords[i].heading;
    let end = Math.min(i + chunkWordCount, annotatedWords.length);

    // Check for heading change within the window — split at that boundary
    for (let j = i + 1; j < end; j++) {
      if (annotatedWords[j].heading !== startHeading) {
        // Only split if the first part is big enough to be useful
        if (j - i >= 20) {
          end = j;
        }
        break;
      }
    }

    const slice = annotatedWords.slice(i, end);
    if (slice.length < 20) {
      // Merge tiny trailing fragment into previous chunk instead of dropping it
      if (chunks.length > 0) {
        chunks[chunks.length - 1].text += ' ' + slice.map((w) => w.word).join(' ');
      }
      break;
    }

    const sectionHeading = slice[0].heading;
    const chunkBody = slice.map((w) => w.word).join(' ');
    const enrichedText = sectionHeading
      ? `[Section: ${sectionHeading}]\n${chunkBody}`
      : chunkBody;

    chunks.push({
      id: `${sourceId}-${chunks.length}`,
      source: sourceName,
      sourceId,
      priority,
      text: enrichedText,
    });

    // Advance with overlap, but if we split on a heading boundary, start at that boundary
    const normalAdvance = i + (chunkWordCount - overlapWords);
    i = (end < i + chunkWordCount) ? end : normalAdvance;
  }

  return chunks;
}

async function embedChunks(chunks, apiKey) {
  const batchSize = 100; // OpenAI allows up to 2048 inputs per request
  const allEmbeddings = [];
  const maxRetries = 5;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map((c) => c.text);

    console.log(`  Embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(chunks.length / batchSize)} (${texts.length} chunks)...`);

    let lastErr;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
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
          const errText = await response.text();
          const retryable = [429, 500, 502, 503, 504].includes(response.status);
          if (!retryable) {
            throw new Error(`OpenAI embeddings API error: ${response.status} ${errText}`);
          }
          throw new Error(`Retryable API error: ${response.status} ${errText}`);
        }

        const data = await response.json();
        const embeddings = data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);

        if (embeddings.length !== batch.length) {
          throw new Error(`Expected ${batch.length} embeddings, got ${embeddings.length}`);
        }

        allEmbeddings.push(...embeddings);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < maxRetries) {
          const delay = 1000 * 2 ** (attempt - 1);
          console.log(`  Retry ${attempt}/${maxRetries} after ${delay}ms: ${err.message}`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    if (lastErr) throw lastErr;
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
    if (!source.content || !source.name || !source.id || source.priority == null) {
      throw new Error(`Source file ${file} is missing required fields (content, name, id, priority)`);
    }
    const chunks = chunkText(source.content, source.name, source.id, source.priority);
    allChunks.push(...chunks);
    console.log(`  ${source.name}: ${chunks.length} chunks`);
  }

  console.log(`\nTotal: ${allChunks.length} chunks\n`);

  console.log('Step 2: Generating embeddings...\n');

  const embeddings = await embedChunks(allChunks, apiKey);

  if (embeddings.length !== allChunks.length) {
    throw new Error(`Embedding count mismatch: got ${embeddings.length}, expected ${allChunks.length}`);
  }

  console.log(`\nGenerated ${embeddings.length} embeddings (dimension: ${embeddings[0].length})\n`);

  console.log('Step 3: Saving embeddings...\n');

  const output = allChunks.map((chunk, i) => ({
    ...chunk,
    embedding: embeddings[i],
  }));

  const json = JSON.stringify(output);
  const outputPath = join(dataDir, 'embeddings.json');
  writeFileSync(outputPath, json);

  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(1);
  console.log(`  Saved ${output.length} chunks with embeddings to embeddings.json (${sizeMB} MB)`);
  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
