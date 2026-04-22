# Pro Court Rules

An AI-powered Progressive Web App that answers natural language questions about PNW tennis league regulations. Built for tennis players and team captains who need quick, accurate rule lookups without reading through pages of regulations.

**Live app:** [procourtrules.vercel.app](https://procourtrules.vercel.app)

## How It Works

Ask a question in plain English (for example, "What happens if my opponent is 12 minutes late?") and get a conversational answer with specific regulation citations. The assistant only answers from official source documents and will say when a question falls outside the available rules.

### Runtime flow

1. The browser sends the conversation to `POST /api/chat`.
2. The API embeds the recent user query, rewrites it into search-style phrases, and retrieves the most relevant rule chunks from `src/data/embeddings.json`.
3. The server builds a hierarchy-aware RAG prompt from those retrieved chunks and sends it to OpenAI (`gpt-5.4-nano`).
4. The frontend renders the answer as markdown and lets users copy it or submit feedback.

If `src/data/embeddings.json` is not present, the server falls back to the older full-context prompt path that loads the raw source documents directly.

### Rule Sources (Priority Order)

1. **PNW League Regulations** — Local section rules, highest authority
2. **USTA League Regulations (National)** — Apply unless overridden by PNW
3. **The Code** — Player conduct for unofficiated matches
4. **Friend at Court** — Comprehensive USTA handbook
5. **ITF Rules of Tennis (2026)** — International base rules

When rules conflict, higher-priority sources take precedence.

## Tech Stack

- **Frontend:** React 18 + Vite, PWA with offline support
- **AI:** OpenAI API (`gpt-5.4-nano` for answers, `gpt-4.1-nano` for query rewrite, `text-embedding-3-small` for retrieval)
- **Hosting:** Vercel (serverless functions + static site)
- **Observability:** Vercel Speed Insights + Vercel Analytics
- **Testing:** Vitest with 58 tests across 7 test files

## Project Structure

```text
procourtrules/
├── api/
│   ├── chat.js                 # Main chat endpoint
│   ├── chat.test.js            # API endpoint tests
│   └── feedback.js             # Feedback + source suggestion endpoint
├── src/
│   ├── App.jsx                 # Root component
│   ├── main.jsx                # React entry point
│   ├── assets/styles/          # Dark theme CSS
│   ├── components/
│   │   ├── ChatWindow.jsx
│   │   ├── FeedbackForm.jsx
│   │   ├── Header.jsx
│   │   ├── MessageBubble.jsx
│   │   ├── SourcesModal.jsx
│   │   ├── SuggestedQuestions.jsx
│   │   └── TypingIndicator.jsx
│   ├── hooks/
│   │   └── useChat.js          # Chat state + cached-answer path
│   ├── services/
│   │   ├── chatService.js      # Legacy message-state helper, still tested
│   │   ├── payloadBuilder.js   # System prompt + RAG payload construction
│   │   ├── rateLimiter.js      # In-memory server-side IP limiter
│   │   └── retrieval.js        # Embedding, rewrite, retrieval helpers
│   ├── utils/
│   │   └── api.js              # Fetch wrappers for /api/chat and /api/feedback
│   └── data/
│       ├── *.json              # Source documents, cached answers, embeddings
│       └── embeddings.json     # Retrieved chunk corpus used at runtime
├── evals/                      # Retrieval / answer eval cases
├── build-embeddings.cjs        # Chunk + embed source documents
├── extract-pdfs.cjs            # Extract PDF text to JSON
├── generate-cached-answers.mjs # Refresh first-turn cached answers
├── run-evals.cjs               # Run retrieval and answer evals
├── vercel.json                 # Vercel deployment config
└── vite.config.js              # Vite + PWA + Vitest config
```

## Development

### Prerequisites

- Node.js 18+
- OpenAI API key

### Setup

```bash
git clone https://github.com/celticpidge/procourtrules.git
cd procourtrules
npm install
```

Create a `.env` file:

```bash
OPENAI_API_KEY=your-key-here
```

### Commands

```bash
npm run dev              # Start local dev server
npm run build            # Production build
npm run test             # Run all tests
npm run test:watch       # Run tests in watch mode
npm run build:embeddings # Rebuild embeddings from source JSON files
node extract-pdfs.cjs    # Extract raw text from PDFs into src/data/
node run-evals.cjs       # Run retrieval evals against embeddings.json
```

### Data Pipeline

1. Put source PDFs in `pdf-sources/`
2. Run `node extract-pdfs.cjs`
3. Run `npm run build:embeddings`

This produces normalized source JSON files plus the chunked embedding corpus in `src/data/embeddings.json`.

## Rate Limiting

The app currently uses two limits:

1. **Browser-side:** `useChat()` tracks a **50-question daily limit** in a cookie and shows the remaining count in the UI.
2. **Server-side:** `api/chat.js` applies an in-memory **50 requests per IP per 24 hours** limiter, with an optional bypass key for trusted callers.

The browser limit is the user-visible quota; the server limit is a lightweight cost-control backstop.

## Feedback and Source Suggestions

Assistant messages include a feedback form that posts to `POST /api/feedback`. The same endpoint also accepts source suggestions from the Sources modal.

Feedback is always logged in the Vercel function logs, and can optionally be forwarded to a Google Sheets webhook by setting:

```bash
GOOGLE_SHEET_WEBHOOK=https://example.com/your-webhook
```

## Deployment

The app auto-deploys to Vercel on push to the `main` branch. The `OPENAI_API_KEY` environment variable must be set in the Vercel project settings. If feedback forwarding is enabled, set `GOOGLE_SHEET_WEBHOOK` as well.
