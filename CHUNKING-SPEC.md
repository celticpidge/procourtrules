# Chunking Pipeline Spec — Tennis Rules RAG System

Implementation spec for an AI coding agent. Self-contained; assumes no prior knowledge of the codebase.

---

## 1. Goals

The chunking pipeline converts raw PDF-extracted tennis regulations into discrete text chunks suitable for embedding-based retrieval. A user asks a natural-language tennis rules question; the system embeds that question, finds the most similar chunks, and feeds them to an LLM as context.

This means every chunk must be:

1. **Semantically self-contained.** A chunk should answer (or contribute to answering) a single question without needing surrounding context. A retriever that returns one chunk in isolation must get a useful fragment, not something that starts mid-sentence after a heading that lives in a different chunk.
2. **Section-aware.** Tennis regulations are hierarchical: they have numbered section headings, titled subsections, and inline sub-contexts (e.g., different lateness rules for regular matches vs. playoff matches). Chunk boundaries should align with these headings, not cut across them.
3. **Labelled.** Each chunk must carry metadata that identifies its source document, section, and priority tier so the retriever can boost or filter at query time.
4. **Reasonably sized.** Too small = poor embedding quality and retrieval noise. Too large = wasted context window and diluted relevance. The target is ~200–300 words per chunk.

Non-goals: This spec does not cover prompt construction, answer generation, or UI. It covers everything up to and including the embedding step.

---

## 2. Input Assumptions

Each source document is a JSON file with this schema:

```json
{
  "id": "pnw-league-regs",
  "name": "PNW League Regulations",
  "priority": 1,
  "description": "...",
  "content": "...full text extracted from PDF..."
}
```

The `content` field is a single string of raw text extracted from a PDF. It has these known properties:

- **Line breaks** (`\n`) exist but are not reliable paragraph markers. Some are mid-sentence wraps from the PDF layout.
- **Page numbers** appear as bare digits on their own lines (e.g., `\n6\n`), or as page header/footer text (e.g., `2026 USTA LEAGUE NATIONAL REGULATIONS Page 14`).
- **Tables** are tab-delimited and may span multiple lines.
- **Headings** are inline in the text — they are not pre-tagged. They follow source-specific conventions (see Section 5).

There are five source documents, listed here in priority order:

| Priority | ID                  | Name                                  | Size   | Heading style           |
|----------|---------------------|---------------------------------------|--------|-------------------------|
| 1        | `pnw-league-regs`   | PNW League Regulations                | ~26K   | `1.04C(1)a TITLE...`   |
| 2        | `usta-league-regs`  | USTA League Regulations (National)    | ~110K  | `1.04B(3)a TITLE...`   |
| 3        | `the-code`          | The Code (Unofficiated Matches)       | ~19K   | ALL CAPS + numbered     |
| 4        | `friend-at-court`   | Friend at Court (USTA Comments/Cases) | ~360K  | `USTA Comment 1.1:` / `USTA Case 1.1:` |
| 5        | `itf-rules`         | ITF Rules of Tennis (2026)            | ~82K   | `Rule 1 THE COURT`     |

The pipeline must not assume the number or shape of sources is fixed. New sources (e.g., USTA Wheelchair regulations) may be added by dropping another JSON file with the same schema.

### Validation

Before processing each source, assert:
- `content` is a non-empty string.
- `name` is a non-empty string.
- `id` is a non-empty string.
- `priority` is a number (including 0).

Fail hard with a clear error message naming the file if any field is missing. Do not silently produce empty chunks.

---

## 3. Preprocessing

Preprocessing transforms the raw `content` string before it reaches the chunker. Its job is to clean up PDF extraction artifacts and inject structural markers that the heading detector and chunker will use.

### 3a. Page-artifact removal

Strip lines that are pure page numbers or repeated page headers/footers. These add noise to embeddings and create false heading matches.

- Remove lines matching `^\d{1,3}$` (bare page numbers).
- Remove lines matching known page-header patterns like `2026 USTA LEAGUE NATIONAL REGULATIONS Page \d+`.

Why: A bare `6` on its own line can trigger the heading detector or land in a chunk as meaningless content.

### 3b. Context-marker injection

Some documents contain distinct sub-contexts buried inside a single section. The most important example: USTA lateness penalties differ for "Regular Local League Matches" vs. "Weekend Leagues and Local League Playoffs," but both appear under section `2.01C(5)b` with no distinct heading.

When a user asks "What is the lateness penalty?", the system must return the correct context (or both, disambiguated). If both contexts live in one chunk with one section label, the LLM cannot tell them apart.

**Strategy:** Define an array of context-marker rules, each with:
- `pattern`: a regex matching the start of a distinct sub-context.
- `label`: a heading string to inject before the matched text.

The preprocessor inserts `\n{label}\n` immediately before each match. This turns the sub-context into a "heading" that the heading detector will pick up, causing the chunker to split there.

Example (sequential sub-contexts within a section):

```
Input text (fragment):
  "...2.01C(5)b (PNW REG) - When a player is late..."

After injection:
  "...
  2.01C(5)b LATENESS PENALTIES - REGULAR LOCAL LEAGUE MATCHES.
  2.01C(5)b (PNW REG) - When a player is late..."
```

These markers are source-specific and hard-coded. This is intentional. The alternative — trying to auto-detect sub-contexts — is fragile and hard to test. Hard-coding is the right tradeoff for a small, stable corpus where you know the pain points. Keep the marker array near the top of the file so future maintainers can add new markers without touching the core algorithm.

### 3c. Multi-column table restructuring

PDF extraction flattens side-by-side table columns into interleaved lines. This is a critical problem when the columns represent distinct answer contexts.

The most important case: **Friend at Court Table 16 (Penalties for Lateness)** has two columns of penalties — one for "Best of 3/5 set matches and pro sets to 7+ games" and one for "Short set matches and pro sets to 6 or fewer games." The PDF extractor interleaves them:

```
5:01 - 10 minutes: Loss of toss plus 2 games       ← best-of-3/5 column
5:01 - 10 minutes: Loss of toss plus 1 game         ← short set column
    and 2 points
10:01 - 15 minutes: Loss of toss plus 3 games       ← best-of-3/5 column
10:01 - 15 minutes: Loss of toss plus 2 games       ← short set column
```

When these land in a single chunk, the LLM cannot reliably distinguish which penalty applies to which match format.

**Strategy:** Fix this in the source data, not the chunker. Restructure the interleaved text into sequential labeled blocks:

```
A.1 LATENESS PENALTIES - BEST OF 3 AND 5 SET MATCHES (...)
If one player or team is late:
• 5 minutes or less: Loss of toss plus 1 game
• 5:01 - 10 minutes: Loss of toss plus 2 games
• 10:01 - 15 minutes: Loss of toss plus 3 games
• More than 15 minutes: default

A.2 LATENESS PENALTIES - BEST OF 3 SHORT SET MATCHES (...)
If one player or team is late:
• 5 minutes or less: Loss of toss plus 1 game
• 5:01 - 10 minutes: Loss of toss plus 1 game and 2 points
• 10:01 - 15 minutes: Loss of toss plus 2 games
• More than 15 minutes: default
```

Then add context markers in the chunking pipeline so each block gets its own heading and becomes a separate chunk:

```js
{ pattern: /A\.1 LATENESS PENALTIES - BEST OF 3 AND 5 SET MATCHES/g,
  prefix: 'LATENESS PENALTIES - BEST-OF-THREE AND FIVE SET MATCHES' },
{ pattern: /A\.2 LATENESS PENALTIES - BEST OF 3 SHORT SET MATCHES/g,
  prefix: 'LATENESS PENALTIES - SHORT SET AND PRO SET MATCHES' },
```

**Why fix the source data instead of auto-detecting columns?** Auto-recovering column structure from interleaved text is guesswork — you need to infer which lines are parallel, how many columns exist, and where each column starts. For a single known table, manually restructuring is faster, more reliable, and auditable. If additional multi-column tables surface, apply the same pattern: restructure in source, add context markers.

**General rule:** When PDF extraction destroys structure that matters for retrieval, fix Upstream (in the source data) rather than downstream (in the chunker). The chunker should handle clean sequential text, not reconstruct table layouts.

---

## 4. Heading Detection

The heading detector is a pure function: given a single line of text, return a heading string if the line is a section heading, or `null` if it is not.

This function is the most corpus-specific part of the pipeline. It must be tested against real source text.

### Pattern priority order

Evaluate patterns in this order. Return on first match.

1. **Regulation-style** (PNW, USTA National):
   Pattern: `^(\d+\.\d{2}[A-Z]?(?:\(\d+\))?[a-z]?)\s+([A-Z].+)`
   Examples: `1.04C(1)a OFFICIAL INFORMATION SYSTEM.`, `2.01C(5)b LATENESS...`
   Extract the regulation number and the title. Truncate the title at the first `. ` (period + space) to strip body text that continues on the same line. Cap title at 80 chars.
   Return: `"1.04C OFFICIAL INFORMATION SYSTEM"`

2. **ITF Rule-style**:
   Pattern: `^Rule \d+\s+[A-Z][A-Z\s]+` (case-insensitive)
   Examples: `Rule 1 THE COURT`, `Rule 16 THE SERVICE`
   Strip trailing page numbers (a bare `\d+` at end of line).
   Return: `"Rule 1 THE COURT"`

3. **USTA Comment/Case-style**:
   Pattern: `^USTA (Comment|Case) \d+\.\d+:`
   Examples: `USTA Comment 1.1: Net cord tension.`, `USTA Case 4.1: ...`
   Return: `"USTA Comment 1.1"` (strip everything after the colon)

4. **Numbered heading** (The Code):
   Pattern: `^\d+\.\s+[A-Z][A-Z\s&]+$`
   Must be all-caps after the number, must not contain runs of 3+ spaces (which indicate a table row).
   Examples: `2. PERMANENT FIXTURES`
   Return: the full line.

5. **ALL-CAPS standalone header**:
   Pattern: `^[A-Z][A-Z\s&,\-]{3,}$`
   Length between 4 and 60 chars. Must contain at least 2 words of 2+ characters. Must not contain runs of 3+ spaces.
   Examples: `MAKING CALLS`, `WARM-UP`, `SERVING`
   Return: the full line.

**Why this order matters:** The regulation-style pattern is the most specific and highest-value. ALL-CAPS is the most permissive and therefore the most likely to false-positive (table headers, OCR artifacts). Evaluate it last.

**Why the 3+ spaces guard:** Tab-delimited table rows (e.g., `TEAM A      TEAM B      RESULT`) are all-caps, multi-word, and within the length range. The triple-space test rejects them cheaply.

---

## 5. Chunk-Building Algorithm

### 5a. Annotate words with heading context

Before chunking, convert the preprocessed text into an array of annotated words. Each word carries the most recent heading that appeared before it.

```
Input:  "MAKING CALLS\n5. Player makes calls on own side..."
Output: [
  { word: "MAKING",  heading: "MAKING CALLS" },
  { word: "CALLS",   heading: "MAKING CALLS" },
  { word: "5.",       heading: "MAKING CALLS" },
  { word: "Player",  heading: "MAKING CALLS" },
  ...
]
```

This is the core data structure the chunker operates on.

**Why words, not sentences or lines?** Lines in PDF-extracted text are unreliable units — they may be 3 words (a column fragment) or 80 words (a full paragraph that didn't wrap). Words give uniform granularity. The heading annotation carries the structural signal.

### 5b. Chunking loop

Parameters:
- `TARGET_WORDS = 240` — target chunk size in words.
- `OVERLAP_WORDS = 24` — number of words to overlap between consecutive chunks within the same section.

Walk the annotated word array with a cursor `i`:

```
while i < annotatedWords.length:
    startHeading = annotatedWords[i].heading
    end = min(i + TARGET_WORDS, length)

    # Scan for heading change within the window
    for j in (i+1 .. end):
        if annotatedWords[j].heading != startHeading:
            if j - i >= MIN_CHUNK_WORDS:   # only split if left part is big enough
                end = j
            break

    slice = annotatedWords[i .. end]

    if slice.length < MIN_CHUNK_WORDS:
        # Trailing fragment: merge into previous chunk (see §5d)
        break

    build chunk from slice
    append to chunks[]

    # Advance cursor (see §5c)
    if end < i + TARGET_WORDS:
        # We split on a heading boundary — no overlap across headings
        i = end
    else:
        # Normal advance with overlap
        i = i + (TARGET_WORDS - OVERLAP_WORDS)
```

### 5c. Overlap strategy

**Within a section:** When a section is longer than `TARGET_WORDS`, consecutive chunks overlap by `OVERLAP_WORDS` (24 words, ~10%). This ensures a sentence that straddles a chunk boundary appears in both chunks, so it can be retrieved by either.

**Across a heading boundary:** No overlap. When the chunker detects a heading change, it ends the current chunk cleanly and starts the next chunk at the new heading. Overlapping across headings would contaminate one section's embedding with text from another section.

**Why this is the right tradeoff for rules text:** Unlike narrative prose, rules text has hard semantic boundaries at section headings. Rule 1.04C and Rule 1.04D answer different questions. Cross-section overlap would add noise, not context.

### 5d. Minimum chunk size

`MIN_CHUNK_WORDS = 20`

If the trailing fragment of a document (or a section) is shorter than 20 words:
- **Merge it into the previous chunk** by appending the fragment's text to that chunk's `text` field.
- If there is no previous chunk (the entire document is < 20 words), this is a data error. Log a warning and skip.

**Why merge, not drop:** Short trailing fragments in regulations often contain critical content — cross-references, exceptions, penalty schedules. Dropping them silently is a retrieval bug. Merging preserves the content in the closest relevant chunk.

### 5e. Maximum chunk size

There is no hard maximum. The effective maximum is `TARGET_WORDS` (~240 words, ~1200 chars), but:
- A section shorter than `TARGET_WORDS` becomes a single chunk, which may be as small as 20 words.
- A trailing merge can make a chunk up to ~260 words.

Both of these are fine. Embedding models (particularly `text-embedding-3-small`) handle variable-length input well. A hard max would force mid-section splits that hurt semantic coherence.

If a future source contains individual sections longer than ~2× `TARGET_WORDS`, the overlap-based splitting handles it automatically. No special case needed.

### 5f. Section label enrichment

Each chunk's text is prefixed with a section label in brackets:

```
[Section: 1.04C OFFICIAL INFORMATION SYSTEM]
1.04C(1)a (PNW REG) - Players may be added to the roster at any time...
```

**Why:** This gives the embedding model a strong topical signal. Without it, a chunk that begins mid-section with "Players may be added..." has weak lexical overlap with the query "What are the roster rules?" The section label bridges that gap.

**Formatting:** Use `[Section: {heading}]` on its own line, followed by a newline, then the chunk body. This is a convention that the embedding model treats as a lightweight title. Do not use XML tags or markdown headers — keep it minimal.

If a chunk has no detected heading (e.g., front-matter at the start of a document before any heading appears), omit the prefix entirely.

---

## 6. Metadata Schema

Each chunk is a JSON object:

```json
{
  "id": "pnw-league-regs-7",
  "source": "PNW League Regulations",
  "sourceId": "pnw-league-regs",
  "priority": 1,
  "text": "[Section: 1.04C OFFICIAL INFORMATION SYSTEM]\n1.04C(1)a (PNW REG) - Players may be added...",
  "embedding": [0.0123, -0.0456, ...]
}
```

| Field       | Type       | Description |
|-------------|------------|-------------|
| `id`        | `string`   | Globally unique. Format: `{sourceId}-{chunkIndex}`. The chunk index is a zero-based sequential counter within the source. |
| `source`    | `string`   | Human-readable source document name. Used in attribution ("According to the PNW League Regulations..."). |
| `sourceId`  | `string`   | Machine-readable source identifier. Used for filtering (e.g., "only search PNW rules"). |
| `priority`  | `number`   | Source priority tier (1 = highest). Used by the retriever to boost or break ties. When PNW and USTA National say conflicting things, priority determines which wins. |
| `text`      | `string`   | The full chunk text including the `[Section: ...]` prefix. This is what gets embedded and what gets passed to the LLM as context. |
| `embedding` | `number[]` | 1536-dimensional vector from `text-embedding-3-small`. |

**Why `priority` lives on the chunk, not just the source:** The retriever operates on chunks, not sources. Carrying priority on each chunk avoids a join at query time.

**Why `source` and `sourceId` are both present:** `source` is for display, `sourceId` is for programmatic filtering. They will diverge (e.g., `sourceId` stays stable while `source` changes to "PNW League Regulations (2027 Edition)").

---

## 7. Embedding Step

After all chunks are built from all sources, embed them in batches via the OpenAI API.

### Parameters
- Model: `text-embedding-3-small` (1536 dimensions)
- Batch size: 100 chunks per API call (well within the 2048 limit)

### Retry logic

The embedding step calls an external API. It must handle transient failures:

- On HTTP 429, 500, 502, 503, 504: retry up to 5 times with exponential backoff (1s, 2s, 4s, 8s, 16s).
- On HTTP 4xx (other than 429): fail immediately with a clear error. This indicates a code bug (bad API key, malformed request), not a transient issue.
- On network errors (fetch failure): retry with the same backoff.

After each successful batch response:
- Sort the returned embeddings by `index` to guarantee alignment with the input order. (The OpenAI API does not guarantee response order.)
- Assert that the number of returned embeddings equals the batch size. Fail hard if not.

After all batches complete:
- Assert `embeddings.length === chunks.length` before writing output. This is the final integrity check.

### Output

Write the final array of chunk objects (metadata + embedding) to `src/data/embeddings.json` as a single JSON file. Serialize once into a variable; use the same string for both the file write and the size calculation.

For this corpus (~600 chunks, ~19 MB output), a single JSON file is the right format. It loads in <1 second and avoids infrastructure dependencies. If the corpus grows past ~5,000 chunks or ~100 MB, reconsider (JSONL, SQLite, or a vector DB).

---

## 8. Failure Modes and Safeguards

| Failure mode | Impact | Safeguard |
|---|---|---|
| Source file missing a required field | Silent garbage chunks | Schema validation before chunking (§2) |
| Heading detector matches a table row as a heading | Spurious section splits, chunks with wrong labels | Triple-space guard rejects tab-delimited rows (§4). Test against real corpus. |
| Heading detector misses a real heading | Chunks span multiple sections. Embeddings lose topic focus | Review chunk output manually when adding new sources. Add new patterns to heading detector as needed. |
| Trailing content dropped | Important short rules lost | Merge into previous chunk (§5d) |
| Sub-contexts mixed into one chunk | LLM can't distinguish match types when answering | Context-marker injection (§3b) |
| API rate limit or transient error | Build script crashes, no output | Retry with exponential backoff (§7) |
| API returns wrong number of embeddings | Embedding/chunk misalignment, wrong vectors on wrong text | Assert embedding count per batch and total (§7) |
| Embedding model changes dimensions | Downstream retrieval breaks silently | Log dimension on output. Retrieval code should validate at load time. |

---

## 9. Function Decomposition

```
main()
├── for each source file:
│   ├── loadAndValidate(filePath)        → { id, name, priority, content }
│   ├── preprocess(content)              → cleaned content string
│   │   ├── stripPageArtifacts(text)
│   │   └── injectContextMarkers(text)
│   └── chunkText(text, name, id, prio)  → Chunk[]
│       ├── annotateWords(lines)         → { word, heading }[]
│       │   └── extractHeading(line)     → string | null
│       └── buildChunks(annotatedWords)  → Chunk[]
├── embedChunks(allChunks, apiKey)       → number[][]
│   └── (retry loop per batch)
├── validateAlignment(chunks, embeddings)
└── writeOutput(chunks, embeddings, path)
```

Key design rules:
- `extractHeading` is a pure function. Easy to unit-test against real lines from each source.
- `chunkText` is a pure function. Given the same text, it always returns the same chunks. No network, no state.
- `embedChunks` is the only function with side effects (network calls). It is the only function that needs retry logic.
- `preprocess` is the only place where source-specific hacks live (context-marker injection). The rest of the pipeline is generic.

---

## 10. Worked Example

**Input:** A fragment of the PNW League Regulations covering two short sections.

```text
1.04C OFFICIAL INFORMATION SYSTEM. 1.04C(1)a (PNW REG) - Players may be added
to the roster at any time before the last two scheduled matches of the season
providing the team remains in compliance with all other regulations. 1.04C(1)b
(PNW REG) - Single Team Leagues must comply with the local league registration
deadline for registering their team.
1.04D GRIEVANCE COMMITTEE. The Local League Coordinator shall appoint a
Grievance Committee of at least three members to hear protests.
```

**Step 1 — Preprocessing:** No page artifacts or context markers apply. Text passes through unchanged.

**Step 2 — Heading detection + word annotation:**

The heading detector fires on two lines:
- `1.04C OFFICIAL INFORMATION SYSTEM.` → heading `"1.04C OFFICIAL INFORMATION SYSTEM"`
- `1.04D GRIEVANCE COMMITTEE.` → heading `"1.04D GRIEVANCE COMMITTEE"`

Word annotation produces:

```
[
  { word: "1.04C",      heading: "1.04C OFFICIAL INFORMATION SYSTEM" },
  { word: "OFFICIAL",   heading: "1.04C OFFICIAL INFORMATION SYSTEM" },
  ...
  { word: "deadline",   heading: "1.04C OFFICIAL INFORMATION SYSTEM" },  // word ~40
  { word: "1.04D",      heading: "1.04D GRIEVANCE COMMITTEE" },          // heading changes
  { word: "GRIEVANCE",  heading: "1.04D GRIEVANCE COMMITTEE" },
  ...
  { word: "protests.",  heading: "1.04D GRIEVANCE COMMITTEE" },          // word ~58
]
```

**Step 3 — Chunking:**

Iteration 1: `i = 0`. `startHeading = "1.04C OFFICIAL INFORMATION SYSTEM"`. Window end = min(0 + 240, 58) = 58. Scan for heading change: heading changes at word ~41. Since 41 - 0 = 41 >= 20, split there. `end = 41`. Slice length = 41. Passes minimum check.

→ **Chunk 0:**
```
id: "pnw-league-regs-0"
text: "[Section: 1.04C OFFICIAL INFORMATION SYSTEM]\n1.04C OFFICIAL INFORMATION SYSTEM. 1.04C(1)a (PNW REG) - Players may be added to the roster...deadline for registering their team."
```

Since this was a heading-boundary split (`end < i + TARGET_WORDS`), no overlap. `i = 41`.

Iteration 2: `i = 41`. `startHeading = "1.04D GRIEVANCE COMMITTEE"`. Window end = min(41 + 240, 58) = 58. No heading change. Slice length = 17. **Below minimum (20).** Merge into previous chunk.

→ **Chunk 0 (updated):** Previous text + `" The Local League Coordinator shall appoint a Grievance Committee of at least three members to hear protests."`

**Final output:** 1 chunk containing both sections, because section 1.04D was too short to stand alone.

This is the correct behavior. A 17-word chunk ("The Local League Coordinator shall appoint...") would produce a poor embedding. Merging it preserves the content in a retrievable chunk.

---

## 11. Testing Recommendations

1. **Unit-test `extractHeading`** against 5–10 real lines from each source document. Include at least one negative case per source (a line that looks like a heading but isn't, e.g., a table row).

2. **Snapshot-test `chunkText`** on a known ~500-word fragment from each source. Assert chunk count, chunk IDs, and that each chunk's text starts with the expected `[Section: ...]` prefix.

3. **Assert no silent drops.** After chunking a full source, verify that the total word count across all chunks is within 1% of the original word count. Any large discrepancy means content is being lost.

4. **Manual review on first run.** After generating embeddings for the first time (or after changing heading patterns), grep the chunk texts for known important rules (e.g., "lateness penalty", "warm-up", "default") and confirm they appear in well-scoped chunks with correct section labels.
