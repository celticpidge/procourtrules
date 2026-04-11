# Pro Court Rules — Work Log

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
- Configuration: 20 questions per IP per 24-hour rolling window
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

### Phase 5: Multi-Source Rule Expansion (In Progress)

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

**Remaining steps:**
- Update `payloadBuilder.js` to load all 5 sources with priority hierarchy
- Update system prompt with hierarchy reasoning instructions
- Update `api/chat.js` to load multi-source data
- Update tests
- Deploy and test with multi-source questions

---

## File Reference

### Application Entry Points
| File | Purpose |
|---|---|
| `index.html` | HTML shell with PWA meta tags, loads React app |
| `src/main.jsx` | React root render with StrictMode |
| `src/App.jsx` | Root component wiring `useChat` hook to `Header` and `ChatWindow` |

### Services (Business Logic)
| File | Purpose |
|---|---|
| `src/services/chatService.js` | Factory for managing conversation message state |
| `src/services/payloadBuilder.js` | Builds OpenAI API payload with system prompt + rules + conversation |
| `src/services/rateLimiter.js` | In-memory IP-based rate limiting (20 req/day/IP) |

### API Layer
| File | Purpose |
|---|---|
| `api/chat.js` | Vercel serverless function — validates, rate-limits, calls OpenAI |
| `src/utils/api.js` | Frontend fetch wrapper for `/api/chat` |

### React Hooks & Components
| File | Purpose |
|---|---|
| `src/hooks/useChat.js` | Hook managing messages, loading, errors, remaining quota |
| `src/components/ChatWindow.jsx` | Main chat UI with input form, messages, suggestions |
| `src/components/MessageBubble.jsx` | Individual message display (user vs assistant styling) |
| `src/components/SuggestedQuestions.jsx` | 6 clickable example questions |
| `src/components/TypingIndicator.jsx` | Animated loading dots |
| `src/components/Header.jsx` | App title bar with "New Chat" button |

### Styles & Assets
| File | Purpose |
|---|---|
| `src/assets/styles/App.css` | Full dark theme with CSS custom properties |
| `public/manifest.json` | PWA manifest (standalone, dark theme) |
| `public/icons/icon-192x192.svg` | App icon |

### Data
| File | Purpose |
|---|---|
| `src/data/rules.json` | Original structured PNW rules (12 categories, ~50 rules with tables) |
| `src/data/pnw-league-regs.json` | Extracted PNW League Regulations text |
| `src/data/usta-league-regs.json` | Extracted USTA National League Regulations text |
| `src/data/the-code.json` | Extracted The Code text |
| `src/data/friend-at-court.json` | Extracted Friend at Court text |
| `src/data/itf-rules.json` | Extracted ITF Rules of Tennis text |

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

### Tests
| File | Tests |
|---|---|
| `src/services/chatService.test.js` | 8 tests — message management, validation, immutability |
| `src/services/payloadBuilder.test.js` | 11 tests — payload structure, model, temperature, system prompt content |
| `src/services/rateLimiter.test.js` | 8 tests — allow/block, window expiry, independent tracking |
| `api/chat.test.js` | 7 tests — validation, rate limiting, OpenAI integration, error handling |
| `src/utils/api.test.js` | 4 tests — fetch wrapper, HTTP errors, network failures |
| `src/hooks/useChat.test.js` | 8 tests — hook state management, API calls, error handling, reset |

**Total: 46 tests, all passing**

---

## Technology Stack

| Category | Technology |
|---|---|
| Frontend | React 18.3, Vite 5.4, vite-plugin-pwa |
| Testing | Vitest 4.1.2, @testing-library/react, jsdom |
| AI | OpenAI API (gpt-5.4-nano, 400k context window) |
| Hosting | Vercel (free tier, serverless functions) |
| VCS | Git, GitHub (celticpidge/court-rules) |
| PDF Processing | pdf-parse 2.4.5 (dev tooling only) |
