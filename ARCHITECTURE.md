# Pro Court Rules — Application Architecture

```mermaid
flowchart TB
    subgraph Browser["Browser (PWA)"]
        direction TB
        HTML["index.html"]
        Main["src/main.jsx<br/>React entry point"]
        App["src/App.jsx<br/>Root component"]
        SpeedInsights["@vercel/speed-insights"]
        Analytics["@vercel/analytics"]

        subgraph Components["React Components"]
            Header["Header.jsx<br/>Sources + New Chat"]
            ChatWindow["ChatWindow.jsx<br/>Messages, input, quota display"]
            MessageBubble["MessageBubble.jsx<br/>Markdown answer + actions"]
            FeedbackForm["FeedbackForm.jsx<br/>Thumbs up/down + comment"]
            SourcesModal["SourcesModal.jsx<br/>Source list + suggestions"]
            Suggestions["SuggestedQuestions.jsx"]
            Typing["TypingIndicator.jsx"]
        end

        Hook["useChat.js<br/>messages, loading, errors,<br/>cookie quota, cached answers"]
        ApiClient["src/utils/api.js<br/>sendMessage(), sendFeedback()"]
        CachedAnswers["cachedAnswers.json<br/>6 exact-match first-turn answers"]
    end

    subgraph Vercel["Vercel Serverless"]
        direction TB
        ChatHandler["api/chat.js<br/>POST /api/chat"]
        FeedbackHandler["api/feedback.js<br/>POST /api/feedback"]

        subgraph Services["Service Layer"]
            RateLimiter["rateLimiter.js<br/>50 req/IP/24h"]
            Retrieval["retrieval.js<br/>embed, rewrite, rank, format"]
            PayloadBuilder["payloadBuilder.js<br/>buildRagPayload()<br/>buildChatPayload()"]
            ChatService["chatService.js<br/>legacy helper, still tested"]
        end

        subgraph Data["Runtime Data"]
            Embeddings["embeddings.json<br/>620 embedded chunks"]
            Sources["5 source JSON files<br/>PNW / USTA / Code / FAC / ITF"]
        end
    end

    subgraph OpenAI["OpenAI API"]
        EmbeddingModel["text-embedding-3-small"]
        RewriteModel["gpt-4.1-nano<br/>query rewrite"]
        AnswerModel["gpt-5.4-nano<br/>final answer"]
    end

    subgraph Tooling["Build & Eval Tooling"]
        Extract["extract-pdfs.cjs<br/>PDF -> source JSON"]
        BuildEmbeddings["build-embeddings.cjs<br/>chunk + embed corpus"]
        Evals["run-evals.cjs<br/>retrieval / answer evals"]
        PDFs["pdf-sources/"]
    end

    subgraph Tests["Test Suite (58 tests / 7 files)"]
        T1["chat.test.js · 7"]
        T2["chatService.test.js · 8"]
        T3["payloadBuilder.test.js · 15"]
        T4["rateLimiter.test.js · 8"]
        T5["retrieval.test.js · 8"]
        T6["utils/api.test.js · 4"]
        T7["useChat.test.js · 8"]
    end

    HTML --> Main --> App
    App --> SpeedInsights
    App --> Analytics
    App --> Header
    App --> ChatWindow
    Header --> SourcesModal
    ChatWindow --> MessageBubble
    ChatWindow --> Suggestions
    ChatWindow --> Typing
    MessageBubble --> FeedbackForm
    App --> Hook --> ApiClient
    Hook --> CachedAnswers

    ApiClient -- "POST /api/chat" --> ChatHandler
    ApiClient -- "POST /api/feedback" --> FeedbackHandler

    ChatHandler --> RateLimiter
    ChatHandler --> Retrieval
    Retrieval --> Embeddings
    Retrieval -- "embed query" --> EmbeddingModel
    Retrieval -- "rewrite query" --> RewriteModel
    ChatHandler --> PayloadBuilder
    PayloadBuilder --> Sources
    ChatHandler -- "chat completions" --> AnswerModel

    PDFs --> Extract --> Sources
    Sources --> BuildEmbeddings --> Embeddings
    Embeddings --> Evals

    T1 -.-> ChatHandler
    T2 -.-> ChatService
    T3 -.-> PayloadBuilder
    T4 -.-> RateLimiter
    T5 -.-> Retrieval
    T6 -.-> ApiClient
    T7 -.-> Hook
```

## Request Flow

### Chat answers

1. `useChat()` accepts input, checks the browser-side 50/day cookie limit, and short-circuits to `cachedAnswers.json` for exact-match first-turn prompts.
2. `src/utils/api.js` posts the conversation to `POST /api/chat`.
3. `api/chat.js` validates the request, strips non-user/assistant roles, caps history, and applies the server-side in-memory rate limiter.
4. If `src/data/embeddings.json` exists, the server:
   - embeds the recent user query
   - rewrites it into search-style phrases
   - embeds the rewrite
   - retrieves top chunks with a weighted dual-embedding score plus source diversity pass
   - formats those chunks into grouped source context
   - builds a RAG system prompt with source hierarchy instructions
5. The server sends that prompt to `gpt-5.4-nano` and returns `{ message, remaining }`.
6. The client renders the answer as sanitized markdown and exposes copy + feedback actions.

If `embeddings.json` is missing, `api/chat.js` falls back to the older full-context prompt path using the raw source JSON files.

### Feedback

1. `FeedbackForm.jsx` and `SourcesModal.jsx` post structured feedback to `POST /api/feedback`.
2. `api/feedback.js` validates the payload, logs it in a structured format, and optionally forwards it to a Google Sheets webhook.

## Notes

- The primary runtime data path is now **embedded chunk retrieval**, not sending the full corpus on every request.
- `src/services/chatService.js` and `src/data/rules.json` remain in the repo, but they are not part of the main runtime path.
- The rate limit shown in the UI and enforced in the current code is **50/day**, not 20/day.
