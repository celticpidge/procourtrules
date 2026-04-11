# Pro Court Rules

An AI-powered Progressive Web App that answers natural language questions about PNW tennis league regulations. Built for tennis players and team captains who need quick, accurate rule lookups without reading through pages of regulations.

**Live app:** [court-rules.vercel.app](https://court-rules.vercel.app)

## How It Works

Ask a question in plain English (e.g. "What happens if my opponent is 12 minutes late?") and get a conversational answer with specific regulation citations. The AI only answers from official source documents and will tell you when a question falls outside its knowledge.

### Rule Sources (Priority Order)

1. **PNW League Regulations** — Local section rules, highest authority
2. **USTA League Regulations (National)** — Apply unless overridden by PNW
3. **The Code** — Player conduct for unofficiated matches
4. **Friend at Court** — Comprehensive USTA handbook
5. **ITF Rules of Tennis (2026)** — International base rules

When rules conflict, higher-priority sources take precedence.

## Tech Stack

- **Frontend:** React 18 + Vite, PWA with offline support
- **AI:** OpenAI API (gpt-5.4-nano, 400k context window)
- **Hosting:** Vercel (serverless functions + static site)
- **Testing:** Vitest with 46 tests across 6 test files

## Project Structure

```
court-rules/
├── api/
│   ├── chat.js              # Vercel serverless endpoint
│   └── chat.test.js         # API endpoint tests
├── src/
│   ├── App.jsx              # Root component
│   ├── main.jsx             # React entry point
│   ├── assets/styles/       # Dark theme CSS
│   ├── components/
│   │   ├── ChatWindow.jsx   # Main chat UI
│   │   ├── MessageBubble.jsx
│   │   ├── SuggestedQuestions.jsx
│   │   ├── TypingIndicator.jsx
│   │   └── Header.jsx
│   ├── hooks/
│   │   └── useChat.js       # Chat state management hook
│   ├── services/
│   │   ├── chatService.js   # Conversation state factory
│   │   ├── payloadBuilder.js # OpenAI API payload construction
│   │   └── rateLimiter.js   # IP-based rate limiting
│   ├── utils/
│   │   └── api.js           # Fetch wrapper for /api/chat
│   └── data/                # Rule source JSON files
├── public/                  # PWA manifest, icons
├── extract-pdfs.cjs         # PDF text extraction tool
├── vercel.json              # Vercel deployment config
└── vite.config.js           # Vite + PWA + Vitest config
```

## Development

### Prerequisites

- Node.js 18+
- OpenAI API key

### Setup

```bash
git clone https://github.com/celticpidge/court-rules.git
cd court-rules
npm install
```

Create a `.env` file:

```
OPENAI_API_KEY=your-key-here
```

### Commands

```bash
npm run dev         # Start local dev server
npm run build       # Production build
npm run test        # Run all tests
npm run test:watch  # Run tests in watch mode
```

### Extracting Rule Data from PDFs

Place PDF files in `pdf-sources/` and run:

```bash
node extract-pdfs.cjs
```

This extracts text from each PDF and writes JSON files to `src/data/`.

## Rate Limiting

The app limits each IP address to 20 questions per 24-hour window to manage API costs. The remaining question count is displayed below the chat input.

## Deployment

The app auto-deploys to Vercel on push to the `main` branch. The `OPENAI_API_KEY` environment variable must be set in the Vercel project settings.
