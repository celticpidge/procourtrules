# Pro Court Rules — Work Log

> Historical note: this file tracks the original buildout. The current production architecture is **RAG-first** (`embeddings.json` + `retrieval.js`), includes `/api/feedback`, uses **50/day** client and server limits, and has **58 tests across 7 files**. Older sections below describe how the app evolved and are not always a complete picture of the current runtime path.

## Session Overview

Built a complete AI-powered Progressive Web App (PWA) called **Pro Court Rules** that answers natural language questions about PNW tennis league regulations using OpenAI's API. The app was developed from scratch using a **test-driven development (TDD)** approach across 6 development loops, deployed to Vercel, and iteratively improved for accuracy, style, and multi-source rule support.

---

## What Was Built

### Phase 1: Core Architecture (TDD Loops 1–5)

Each loop followed red-green-refactor: write failing tests first, implement to pass, then refine.

**Loop 1 — Chat Service** (`src/services/chatService.js`, 8 tests)
- Factory function `createChatService()` that manages conversation state
- Methods: `addUserMessage()`, `addAssistantMessage()`, `getMessages()`, `reset()`
- Returns defensive copies of the messages array to prevent external mutation
- Validates that messages cannot be empty or whitespace-only

**Loop 2 — Payload Builder** (`src/services/payloadBuilder.js`, 11 tests)
- `buildChatPayload(conversation, rules)` constructs the OpenAI Chat Completions API request payload
- `buildSystemPrompt(rules)` flattens the structured rules JSON into text and wraps it in a detailed system prompt with:
  - Strict guardrails (only answer from provided regulations, never guess)
  - Citation requirements (must reference specific regulation numbers)
  - Response style instructions (friendly, thorough, practical examples)
- `formatTable(table)` renders tabular rule data as readable markdown tables
- Model: started with `gpt-4o-mini`, upgraded to `gpt-5.4-nano` (400k context window)
- Temperature: 0.4 for factual accuracy with some conversational warmth

**Loop 3 — Rate Limiter** (`src/services/rateLimiter.js`, 8 tests)
- `createRateLimiter({ maxRequests, windowMs })` creates an in-memory, IP-based rate limiter
- Initial configuration: 20 questions per IP per 24-hour rolling window
- Returns `{ allowed, remaining, retryAfter }` on each check
- Independent tracking per client IP

**Loop 4 — Serverless API Endpoint** (`api/chat.js`, 7 tests)
- Vercel serverless function handling `POST /api/chat`
- Request validation (requires non-empty messages array)
- Rate limiting by `x-forwarded-for` IP header
- Builds payload via `payloadBuilder`, calls OpenAI API, returns assistant response + remaining quota
- Exports both `handleChatRequest` (testable) and default `handler` (Vercel entry point)
- Uses `readFileSync` for JSON imports (ESM `import ... with { type: 'json' }` not supported on Vercel)

**Loop 5 — Frontend** (`src/utils/api.js`, `src/hooks/useChat.js`, `src/components/*`, 12 tests)
- `sendMessage(messages)` — fetch wrapper that POSTs to `/api/chat`, handles HTTP errors and network failures
- `useChat()` — React hook managing `{ messages, isLoading, error, remaining, send, reset }`
- Components:
  - `ChatWindow.jsx` — Main chat container with message list, text input form, suggested questions on empty state, error display, remaining quota counter, and auto-scroll
  - `MessageBubble.jsx` — User messages (green) and assistant messages (dark) with 🎾 avatar
  - `SuggestedQuestions.jsx` — 6 pre-written example questions displayed as clickable chips
  - `TypingIndicator.jsx` — Animated bouncing dots shown while waiting for AI response
  - `Header.jsx` — App title "Pro Court Rules", subtitle, and conditional "New Chat" reset button

### Phase 2: PWA Configuration & Deployment (Loop 6)

- `vite-plugin-pwa` configured with autoUpdate service worker registration and Workbox caching
- `public/manifest.json` with standalone display, dark theme colors, SVG icon
- `index.html` with viewport meta, theme-color, manifest link, apple-touch-icon
- Full dark theme CSS (`src/assets/styles/App.css`) with CSS custom properties:
  - Background: `#0f0f0f`, accent: `#4caf50` (green), user bubbles: `#1b5e20`
  - Responsive layout, max-width 680px, smooth animations
- Git initialized, pushed to GitHub (`celticpidge/court-rules`)
- Deployed to Vercel with serverless function support
- `vercel.json` with API rewrites and SPA fallback routing
- Build command: `chmod +x node_modules/.bin/* && vite build` (permission fix required after git history rewrite)

### Phase 3: Accuracy & Style Improvements

- **System prompt refinements**: Added stronger guardrails to prevent hallucination, required specific regulation citations, added "I don't have a regulation for that" fallback
- **Table data support**: `formatTable()` renders structured table data (team composition charts, scoring tables) as readable text in the prompt
- **Response style tuning**: Adjusted from terse factual answers to warm, conversational tone with practical examples and proactive edge-case mentions
- **Temperature adjustment**: `0.2` → `0.4` for better conversational quality while maintaining accuracy
- **JSON import fix**: Switched from ESM `import ... with { type: 'json' }` to `readFileSync` for Vercel compatibility

### Phase 4: Security Incident & Recovery

- API key was accidentally committed in `.env` and pushed to GitHub
- Used `git filter-branch` to scrub `.env` from entire git history
- Force-pushed cleaned history to GitHub
- Rotated API key on OpenAI dashboard
- Updated `OPENAI_API_KEY` environment variable in Vercel
- Added `.env` and `.env.local` to `.gitignore`
- Post-cleanup: Vercel build broke with permission error 126 (filter-branch corrupted file modes) — fixed by adding `chmod +x node_modules/.bin/*` to `vercel.json` buildCommand

### Phase 5: Multi-Source Rule Expansion

**Goal**: Expand from 1 rule source to 5, with a priority hierarchy for conflict resolution.

**Source hierarchy** (most specific → most general):
| Priority | Source | Est. Tokens | Description |
|---|---|---|---|
| 1 | PNW League Regulations | ~6k | Local section regulations, highest authority |
| 2 | USTA League Regulations (National) | ~27k | National league rules, apply unless PNW overrides |
| 3 | The Code (Unofficiated Matches) | ~5k | Player conduct and fair play guidelines |
| 4 | Friend at Court | ~155k | Comprehensive USTA handbook (includes The Code + ITF Rules with commentary) |
| 5 | ITF Rules of Tennis (2026) | ~20k | International base rules |

**Completed steps:**
1. Installed `pdf-parse` (v2.4.5) as dev dependency
2. Created `extract-pdfs.cjs` — Node.js script using `pdf-parse` v2 API (`PDFParse` class with `load()` → `getText()`) to extract text from 5 PDFs in `pdf-sources/`
3. Successfully extracted all 5 sources to JSON files in `src/data/`:
   - `pnw-league-regs.json` (4,342 words)
   - `usta-league-regs.json` (17,331 words)
   - `the-code.json` (3,407 words)
   - `friend-at-court.json` (87,482 words)
   - `itf-rules.json` (14,368 words)
4. Upgraded model from `gpt-4o-mini` (128k context) to `gpt-5.4-nano` (400k context) — all ~214k tokens of source material fits comfortably
5. Updated `payloadBuilder.js` to load all 5 sources with priority hierarchy and hierarchy reasoning instructions in the system prompt
6. Updated `api/chat.js` to load multi-source data
7. Updated tests — payloadBuilder tests expanded from 11 to 13

### Phase 6: Rename & Observability

- **Renamed** application from `court-rules` to `procourtrules` across package.json, manifest, and GitHub repo
- **Fixed `.gitignore` encoding** — `pdf-sources/` entry had been written in UTF-16LE causing NUL bytes; rewrote as clean UTF-8
- **Added Vercel Speed Insights** (`@vercel/speed-insights`) — `<SpeedInsights />` component in `App.jsx` for Core Web Vitals reporting
- **Added Vercel Analytics** (`@vercel/analytics`) — `<Analytics />` component in `App.jsx` for page view and event tracking

### Phase 7: Retrieval, Cached Answers, and Feedback

- **Shifted the app from full-context prompting to RAG-first runtime behavior**
  - Added `src/services/retrieval.js` with:
    - query embeddings via `text-embedding-3-small`
    - query rewrite via `gpt-4.1-nano`
    - cosine-similarity ranking
    - dual-embedding scoring with capped rewrite boost
    - source-diversity pass so strong chunks from additional sources are not dropped
- **Built the chunking + embedding pipeline**
  - Added `build-embeddings.cjs` to preprocess source text, detect section headings, split text into section-aware chunks, and embed the corpus
  - Runtime corpus now lives in `src/data/embeddings.json`
  - Current corpus size: **620 embedded chunks**
- **Added evaluation tooling**
  - Added `run-evals.cjs` for retrieval and answer eval runs against the embedded corpus
  - Added `evals/` cases to check controlling-source retrieval and answer quality
- **Added cached first-turn answers**
  - `src/hooks/useChat.js` now short-circuits exact-match first-turn suggestions to `src/data/cachedAnswers.json`
  - This reduces latency and cost for the six suggested starter prompts
- **Added user feedback and source suggestions**
  - Added `api/feedback.js`
  - Added `src/components/FeedbackForm.jsx` for thumbs-up/down feedback on assistant answers
  - Added `src/components/SourcesModal.jsx` so users can inspect sources and suggest missing ones
  - Optional webhook forwarding persists feedback to Google Sheets
- **Raised visible usage limits to 50/day**
  - Browser-side cookie quota in `useChat()` is now 50/day
  - Server-side IP limiter in `api/chat.js` is also configured to 50/day

---

## File Reference

### Application Entry Points
| File | Purpose |
|---|---|
| `index.html` | HTML shell with PWA meta tags, loads React app |
| `src/main.jsx` | React root render with StrictMode |
| `src/App.jsx` | Root component wiring `useChat` hook to `Header` and `ChatWindow`, includes Vercel Speed Insights and Analytics |

### Services (Business Logic)
| File | Purpose |
|---|---|
| `src/services/chatService.js` | Factory for managing conversation message state |
| `src/services/payloadBuilder.js` | Builds OpenAI API payloads for both full-context and RAG paths |
| `src/services/retrieval.js` | Query embedding, rewrite, ranking, and formatting for RAG retrieval |
| `src/services/rateLimiter.js` | In-memory IP-based rate limiting (currently used at 50 req/day/IP in `api/chat.js`) |

### API Layer
| File | Purpose |
|---|---|
| `api/chat.js` | Vercel serverless function — validates, rate-limits, calls OpenAI |
| `api/feedback.js` | Vercel serverless function for feedback and source suggestions |
| `src/utils/api.js` | Frontend fetch wrapper for `/api/chat` and `/api/feedback` |

### React Hooks & Components
| File | Purpose |
|---|---|
| `src/hooks/useChat.js` | Hook managing messages, loading, errors, remaining quota |
| `src/components/ChatWindow.jsx` | Main chat UI with input form, messages, suggestions |
| `src/components/MessageBubble.jsx` | Individual message display (user vs assistant styling) |
| `src/components/FeedbackForm.jsx` | Assistant-answer feedback UI |
| `src/components/SourcesModal.jsx` | Source list modal with source suggestion form |
| `src/components/SuggestedQuestions.jsx` | 6 clickable example questions |
| `src/components/TypingIndicator.jsx` | Animated loading dots |
| `src/components/Header.jsx` | App title bar with "Sources" and "New Chat" actions |

### Styles & Assets
| File | Purpose |
|---|---|
| `src/assets/styles/App.css` | Full dark theme with CSS custom properties |
| `public/manifest.json` | PWA manifest (standalone, dark theme) |
| `public/icons/icon-192x192.svg` | App icon |

### Data
| File | Purpose |
|---|---|
| `src/data/pnw-league-regs.json` | Extracted PNW League Regulations text |
| `src/data/usta-league-regs.json` | Extracted USTA National League Regulations text |
| `src/data/the-code.json` | Extracted The Code text |
| `src/data/friend-at-court-unique.json` | De-duplicated Friend at Court text used by runtime and embeddings |
| `src/data/itf-rules.json` | Extracted ITF Rules of Tennis text |
| `src/data/cachedAnswers.json` | Exact-match cached answers for suggested first-turn prompts |
| `src/data/embeddings.json` | Embedded chunk corpus used by the runtime retriever |

### Build & Config
| File | Purpose |
|---|---|
| `package.json` | Dependencies, scripts (`dev`, `build`, `test`, `test:watch`) |
| `vite.config.js` | Vite + React + PWA plugin config, Vitest jsdom environment |
| `vercel.json` | Build command (with chmod fix), API rewrites, SPA fallback |
| `.gitignore` | Excludes `node_modules/`, `dist/`, `.env`, `.env.local`, logs |

### Tooling
| File | Purpose |
|---|---|
| `extract-pdfs.cjs` | PDF text extraction script using pdf-parse v2 |
| `build-embeddings.cjs` | Section-aware chunking + embedding pipeline |
| `generate-cached-answers.mjs` | Refreshes cached answers from the live API |
| `run-evals.cjs` | Runs retrieval and answer evals against the corpus |

### Tests
| File | Tests |
|---|---|
| `src/services/chatService.test.js` | 8 tests — message management, validation, immutability |
| `src/services/payloadBuilder.test.js` | 15 tests — payload structure, model, temperature, system prompt content |
| `src/services/rateLimiter.test.js` | 8 tests — allow/block, window expiry, independent tracking |
| `src/services/retrieval.test.js` | 8 tests — similarity ranking and source-grouped formatting |
| `api/chat.test.js` | 7 tests — validation, rate limiting, OpenAI integration, error handling |
| `src/utils/api.test.js` | 4 tests — fetch wrapper, HTTP errors, network failures |
| `src/hooks/useChat.test.js` | 8 tests — hook state management, API calls, error handling, reset |

**Total: 58 tests, all passing**

---

## Technology Stack

| Category | Technology |
|---|---|
| Frontend | React 18.3, Vite 5.4, vite-plugin-pwa |
| Testing | Vitest 4.1.2, @testing-library/react, jsdom |
| AI | OpenAI API (gpt-5.4-nano, 400k context window) |
| Hosting | Vercel (free tier, serverless functions) |
| VCS | Git, GitHub (celticpidge/procourtrules) |
| Observability | Vercel Speed Insights, Vercel Analytics |
| PDF Processing | pdf-parse 2.4.5 (dev tooling only) |
