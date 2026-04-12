const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('fs');
const { join } = require('path');

// ---------------------------------------------------------------------------
// Inlined retrieval functions (avoids ESM/CJS interop with src/services/)
// ---------------------------------------------------------------------------

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function retrieveChunks(queryEmbedding, chunks, topK = 20) {
  const scored = chunks.map((chunk) => ({
    ...chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

function formatRetrievedChunks(chunks) {
  const grouped = {};
  for (const chunk of chunks) {
    if (!grouped[chunk.source]) {
      grouped[chunk.source] = { priority: chunk.priority, texts: [] };
    }
    grouped[chunk.source].texts.push(chunk.text);
  }
  const sorted = Object.entries(grouped).sort(([, a], [, b]) => a.priority - b.priority);
  return sorted
    .map(([name, { priority, texts }]) =>
      `=== SOURCE: ${name} (Priority ${priority}) ===\n\n${texts.join('\n\n')}`)
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// OpenAI helpers
// ---------------------------------------------------------------------------

async function embedQuery(text, apiKey) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embeddings API error: ${response.status} ${err}`);
  }
  const data = await response.json();
  return data.data[0].embedding;
}

async function chatCompletion(messages, apiKey, model = 'gpt-4.1-nano') {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, temperature: 0.4, messages }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Chat API error: ${response.status} ${err}`);
  }
  const data = await response.json();
  return data.choices[0].message.content;
}

// ---------------------------------------------------------------------------
// Query rewriting (mirrors retrieval.js rewriteQuery)
// ---------------------------------------------------------------------------

const REWRITE_PROMPT = `You are a search query rewriter for a tennis rules database. The database contains:
- ITF Rules of Tennis (rules about play, scoring, hindrance, lets, point penalties)
- The Code (unofficiated match conduct — line calls, sportsmanship, hindrance)
- Friend at Court (USTA comments, officiating, penalties, unsportsmanlike conduct, defaults)
- USTA League Regulations (grievances, suspensions, league discipline)
- PNW League Regulations (local league rules, lateness, playoffs)

Given a user's tennis question, output 3-5 short search phrases a rulebook would use.
Think about ALL aspects: what happens during the point (hindrance, let, point loss), what penalties apply (warning, default), and what post-match processes exist (grievance, suspension).
Only output the phrases, one per line. No numbering, no explanation.`;

async function rewriteQuery(userQuery, apiKey) {
  try {
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
    if (!response.ok) return null;
    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch {
    return null;
  }
}

function retrieveChunksDualEmbed(queryEmbedding, rewriteEmbedding, chunks, topK = 20) {
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

// ---------------------------------------------------------------------------
// System prompt (mirrors payloadBuilder.js buildRagPayload)
// ---------------------------------------------------------------------------

function buildSystemPrompt(retrievedContext) {
  const hierarchyList = [
    '  1. PNW League Regulations — Local section regulations, highest authority.',
    '  2. USTA League Regulations (National) — Apply unless overridden by PNW.',
    '  3. The Code — Player conduct for unofficiated matches.',
    '  4. Friend at Court — Comprehensive USTA handbook.',
    '  5. ITF Rules of Tennis — International base rules.',
  ].join('\n');

  return `You are Pro Court Rules, a friendly and helpful assistant that answers questions about tennis rules and PNW league regulations. Your users are tennis players and team captains, not lawyers — so explain things in warm, conversational English.

RULE HIERARCHY — CRITICAL:
When answering, you must follow this priority order. If two sources conflict, the LOWER-numbered (higher-priority) source wins:
${hierarchyList}

COMBINING SOURCES FOR COMPLETE ANSWERS:
Many questions touch rules from MULTIPLE sources. Always check whether both The Code AND the ITF Rules address the topic. For example:
- Hindrance questions need BOTH The Code (what players should do) AND ITF Rule 26 (deliberate vs unintentional — different outcomes).
- Dispute questions in unofficiated matches need The Code (players call their own side) AND may contrast with officiated rules (chair umpire decides).
- If The Code describes player conduct for a situation, also check whether the ITF Rules define the underlying rule and any important distinctions (e.g., deliberate vs accidental).

CRITICAL INSTRUCTIONS:
1. ONLY answer using the source material provided below. Do NOT use outside knowledge.
2. BEFORE answering, mentally scan ALL provided source material for relevant rules, cases, and comments — not just the first match you find. Multiple sources may address the same topic with different details. If you find a topic covered in The Code, also check the ITF Rules (and vice versa).
3. Always cite which source document your answer comes from.
4. If the provided sources don't cover the question, say so.

Here are the relevant source excerpts, in priority order:

${retrievedContext}`;
}

// ---------------------------------------------------------------------------
// Judge prompt
// ---------------------------------------------------------------------------

function buildJudgePrompt(evalCase, answer) {
  return `You are an eval judge. Given a tennis rules question, the expected answer criteria, and the actual answer from an AI assistant, evaluate the answer.

QUESTION: ${evalCase.user_query}

EXPECTED ANSWER SUMMARY: ${evalCase.right_answer}

ACTUAL ANSWER:
${answer}

Evaluate the following criteria. For each, respond with PASS or FAIL and a brief reason.

MUST INCLUDE (the answer should convey these concepts — not necessarily these exact words):
${evalCase.must_include.map((c, i) => `${i + 1}. ${c}`).join('\n')}

MUST NOT INCLUDE (the answer should NOT contain these):
${evalCase.must_not_include.map((c, i) => `${i + 1}. ${c}`).join('\n')}

OVERALL: Is the answer factually consistent with the expected answer summary? PASS or FAIL.

Respond in this exact JSON format (no markdown fencing):
{
  "must_include": [{"concept": "...", "result": "PASS|FAIL", "reason": "..."}],
  "must_not_include": [{"concept": "...", "result": "PASS|FAIL", "reason": "..."}],
  "overall": {"result": "PASS|FAIL", "reason": "..."}
}`;
}

// ---------------------------------------------------------------------------
// Eval runners
// ---------------------------------------------------------------------------

async function runRetrievalEval(evalCase, embeddings, apiKey) {
  const [queryEmbedding, rewrittenText] = await Promise.all([
    embedQuery(evalCase.user_query, apiKey),
    rewriteQuery(evalCase.user_query, apiKey),
  ]);
  const rewriteEmbedding = rewrittenText
    ? await embedQuery(rewrittenText, apiKey)
    : null;
  const topChunks = retrieveChunksDualEmbed(queryEmbedding, rewriteEmbedding, embeddings);

  const expectedSource = evalCase.expected_controlling_source;
  const matchingChunks = topChunks.filter((c) => c.source === expectedSource);
  const firstMatchRank = topChunks.findIndex((c) => c.source === expectedSource);

  return {
    id: evalCase.id,
    query: evalCase.user_query,
    expectedSource,
    found: matchingChunks.length > 0,
    firstMatchRank: firstMatchRank >= 0 ? firstMatchRank + 1 : null,
    matchCount: matchingChunks.length,
    topSources: [...new Set(topChunks.slice(0, 5).map((c) => c.source))],
    topChunkPreviews: topChunks.slice(0, 3).map((c) => ({
      source: c.source,
      score: c.score.toFixed(4),
      text: c.text.substring(0, 150) + '...',
    })),
  };
}

async function runAnswerEval(evalCase, embeddings, apiKey) {
  // Step 1: Retrieve with dual-embed
  const [queryEmbedding, rewrittenText] = await Promise.all([
    embedQuery(evalCase.user_query, apiKey),
    rewriteQuery(evalCase.user_query, apiKey),
  ]);
  const rewriteEmbedding = rewrittenText
    ? await embedQuery(rewrittenText, apiKey)
    : null;
  const topChunks = retrieveChunksDualEmbed(queryEmbedding, rewriteEmbedding, embeddings);
  const context = formatRetrievedChunks(topChunks);

  // Step 2: Generate answer
  const systemPrompt = buildSystemPrompt(context);
  const answer = await chatCompletion([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: evalCase.user_query },
  ], apiKey, 'gpt-5.4-nano');

  // Step 3: Judge
  const judgeResponse = await chatCompletion([
    { role: 'system', content: 'You are a precise eval judge. Output only valid JSON.' },
    { role: 'user', content: buildJudgePrompt(evalCase, answer) },
  ], apiKey, 'gpt-4.1-mini');

  let judgment;
  try {
    judgment = JSON.parse(judgeResponse);
  } catch {
    judgment = { parse_error: true, raw: judgeResponse };
  }

  return {
    id: evalCase.id,
    query: evalCase.user_query,
    answer,
    judgment,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const filterIdx = args.indexOf('--filter');
  const filterId = filterIdx >= 0 ? args[filterIdx + 1] : null;
  const verbose = args.includes('--verbose');

  // Load API key
  const envPath = join(__dirname, '.env');
  if (existsSync(envPath)) {
    const envLines = readFileSync(envPath, 'utf-8').split('\n');
    for (const line of envLines) {
      const cleaned = line.replace(/\r$/, '');
      const match = cleaned.match(/^([^#=]+)=(.*)$/);
      if (match) process.env[match[1].trim()] = match[2].trim();
    }
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Error: OPENAI_API_KEY required. Set in .env or environment.');
    process.exit(1);
  }

  // Load data
  console.log('Loading embeddings...');
  const embeddings = JSON.parse(readFileSync(join(__dirname, 'src', 'data', 'embeddings.json'), 'utf-8'));
  let cases = JSON.parse(readFileSync(join(__dirname, 'evals', 'tennis_rules_gold_subset_exact_v2.json'), 'utf-8'));

  if (filterId) {
    cases = cases.filter((c) => c.id === filterId);
    if (cases.length === 0) {
      console.error(`No eval case found with id "${filterId}"`);
      process.exit(1);
    }
  }

  console.log(`Running ${cases.length} eval(s)${full ? ' (retrieval + answer)' : ' (retrieval only)'}...\n`);

  // Run evals
  const retrievalResults = [];
  const answerResults = [];

  for (const evalCase of cases) {
    process.stdout.write(`  ${evalCase.id}: `);

    // Retrieval eval
    const retrieval = await runRetrievalEval(evalCase, embeddings, apiKey);
    retrievalResults.push(retrieval);

    const rank = retrieval.firstMatchRank;
    const retrievalStatus = retrieval.found
      ? `✓ source found at rank ${rank}${rank <= 3 ? '' : ' (low)'}`
      : '✗ expected source NOT in top 20';
    process.stdout.write(retrievalStatus);

    // Answer eval (if --full)
    if (full) {
      process.stdout.write(' | generating answer...');
      const answer = await runAnswerEval(evalCase, embeddings, apiKey);
      answerResults.push(answer);

      if (answer.judgment.parse_error) {
        process.stdout.write(' judge parse error');
      } else {
        const mi = answer.judgment.must_include || [];
        const mni = answer.judgment.must_not_include || [];
        const miPass = mi.filter((r) => r.result === 'PASS').length;
        const mniPass = mni.filter((r) => r.result === 'PASS').length;
        const overall = answer.judgment.overall?.result || '?';
        process.stdout.write(` | must_include: ${miPass}/${mi.length} | must_not_include: ${mniPass}/${mni.length} | overall: ${overall}`);
      }
    }

    console.log();
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('RETRIEVAL SUMMARY');
  console.log('='.repeat(70));

  const found = retrievalResults.filter((r) => r.found).length;
  const top3 = retrievalResults.filter((r) => r.firstMatchRank && r.firstMatchRank <= 3).length;
  const top5 = retrievalResults.filter((r) => r.firstMatchRank && r.firstMatchRank <= 5).length;
  console.log(`  Source found in top 20: ${found}/${retrievalResults.length}`);
  console.log(`  Source in top 3:        ${top3}/${retrievalResults.length}`);
  console.log(`  Source in top 5:        ${top5}/${retrievalResults.length}`);

  if (full && answerResults.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('ANSWER QUALITY SUMMARY');
    console.log('='.repeat(70));

    let totalMI = 0, passMI = 0, totalMNI = 0, passMNI = 0, overallPass = 0;
    for (const a of answerResults) {
      if (a.judgment.parse_error) continue;
      const mi = a.judgment.must_include || [];
      const mni = a.judgment.must_not_include || [];
      totalMI += mi.length;
      passMI += mi.filter((r) => r.result === 'PASS').length;
      totalMNI += mni.length;
      passMNI += mni.filter((r) => r.result === 'PASS').length;
      if (a.judgment.overall?.result === 'PASS') overallPass++;
    }
    console.log(`  must_include pass:      ${passMI}/${totalMI}`);
    console.log(`  must_not_include pass:  ${passMNI}/${totalMNI}`);
    console.log(`  overall pass:           ${overallPass}/${answerResults.length}`);
  }

  // Write detailed results
  const resultsDir = join(__dirname, 'evals', 'results');
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = {
    timestamp: new Date().toISOString(),
    mode: full ? 'full' : 'retrieval',
    filter: filterId,
    totalCases: cases.length,
    retrieval: retrievalResults,
    ...(full ? { answers: answerResults } : {}),
  };

  const outPath = join(resultsDir, `eval-${timestamp}.json`);
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nDetailed results: evals/results/eval-${timestamp}.json`);

  // Verbose output
  if (verbose) {
    console.log('\n' + '='.repeat(70));
    console.log('DETAILED RETRIEVAL RESULTS');
    console.log('='.repeat(70));
    for (const r of retrievalResults) {
      console.log(`\n  ${r.id}: "${r.query.substring(0, 80)}..."`);
      console.log(`    Expected: ${r.expectedSource}`);
      console.log(`    Found: ${r.found} (rank ${r.firstMatchRank || 'N/A'}, ${r.matchCount} chunks)`);
      console.log(`    Top sources: ${r.topSources.join(', ')}`);
    }

    if (full) {
      console.log('\n' + '='.repeat(70));
      console.log('DETAILED ANSWER RESULTS');
      console.log('='.repeat(70));
      for (const a of answerResults) {
        console.log(`\n  ${a.id}: "${a.query.substring(0, 80)}..."`);
        console.log(`    Answer: ${a.answer.substring(0, 200)}...`);
        if (!a.judgment.parse_error) {
          for (const r of (a.judgment.must_include || [])) {
            console.log(`    [must_include] ${r.result}: "${r.concept}" — ${r.reason}`);
          }
          for (const r of (a.judgment.must_not_include || [])) {
            console.log(`    [must_not_include] ${r.result}: "${r.concept}" — ${r.reason}`);
          }
          console.log(`    [overall] ${a.judgment.overall?.result}: ${a.judgment.overall?.reason}`);
        }
      }
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
