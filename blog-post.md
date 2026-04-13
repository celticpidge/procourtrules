# I Haven't Coded in 20 Years. I Just Built an AI App Anyway.

Last month I shipped [Pro Court Rules](https://procourtrules.vercel.app) — an AI-powered app that answers natural-language questions about tennis regulations. You type "What happens if my opponent is 12 minutes late?" and it gives you the exact rule, with citations, from five different official source documents.

I'm a tennis player and team captain, not a software engineer. The last time I wrote code professionally, we were deploying to physical servers and JavaScript was something you used to validate form fields. Two decades later, I partnered with an AI coding assistant and built a production app from nothing in a series of evenings.

This is the story of how it went — including every wall I hit and how I got past it.

---

## The Problem I Wanted to Solve

If you've ever captained a USTA league tennis team, you know the feeling: something happens during a match — an opponent shows up late, makes a questionable line call, or disputes the score — and you need to know the rule *right now*. But the rules live across five different documents:

1. **PNW League Regulations** (my local section)
2. **USTA National League Regulations**
3. **The Code** (conduct rules for matches without an umpire)
4. **Friend at Court** (the massive USTA reference handbook)
5. **ITF Rules of Tennis**

These documents are dense, overlapping, and sometimes contradictory. The local PNW rules override the national ones, which override the ITF base rules. Nobody memorizes all of this. I wanted an app where I could just *ask*.

---

## Step 1: The "Just Stuff It All In" Approach

My first idea was simple: feed all the rule text into an LLM as context, and let it answer questions.

I started by extracting text from the five source PDFs using a Node.js script and `pdf-parse`. Each document became a JSON file. Then I built a React chat interface — a text box, some message bubbles, a dark theme — and wired it up to a Vercel serverless function that called OpenAI's API.

The system prompt told the model: "Here are the official tennis regulations. Only answer from these. Cite specific rule numbers. If you don't know, say so."

**And it worked.** Sort of. For straightforward questions the answers were good. I could ask "Can my opponent call a foot fault?" and get a correct, cited answer from The Code.

**The problem:** All five sources totaled about 214,000 tokens. That's a *lot* of context. I was using `gpt-4o-mini` with a 128K context window, so the bigger documents didn't even fit. I upgraded to `gpt-5.4-nano` (400K context window), which solved the immediate size problem but introduced another: cost per query was higher than I wanted, and the model sometimes got confused by the sheer volume of text, pulling rules from the wrong source or missing nuances when two documents addressed the same topic differently.

I needed a smarter approach.

---

## Step 2: Building a RAG Pipeline (and Failing at Chunking)

I'd heard the term **RAG** — Retrieval-Augmented Generation — tossed around, and the concept made sense. Instead of shoving all 214K tokens into every request, split the documents into small chunks, create vector embeddings for each chunk, and at query time, only retrieve the chunks most relevant to the user's question.

This sounded elegant. The reality was messier.

### Failure: Chunks That Made No Sense

My first attempt at chunking was naive: split on double newlines, cap at 300 words, done. The results were terrible. Chunks would start mid-sentence. A rule's heading would end up in one chunk and its body in the next. The lateness penalty *table* got sliced in half. Section numbers like `2.01C(5)b` were separated from the text they labeled.

When I tried to retrieve chunks for the question "What are the lateness penalties?", the system returned fragments that individually made no sense — a piece of a table here, a heading without its body there.

### The Fix: Source-Aware Chunking

I stopped trying to write one generic splitter and instead studied each document's structure. PNW and USTA regulations use numbered heading patterns like `2.01C(5)b LATENESS PENALTIES`. The Code uses numbered paragraphs with ALL CAPS section headers. Friend at Court has `USTA Comment 1.1:` and `USTA Case 1.1:` markers. ITF rules use `Rule 1 THE COURT` format.

I wrote heading-detection regexes for each source, split on those headings, kept every chunk with its heading as a label, and injected `[Section: HEADING TEXT]` markers at the start of each chunk. Now when the retriever pulled a chunk, it carried its own context.

I also added a trailing-chunk fix — my original code silently dropped whatever text came after the last heading match. That was losing real content from every document.

### Failure: The Table From Hell

Friend at Court has a Table 16 that lists point penalty schedules. In the PDF, it's a multi-column layout: one column for the offense, adjacent columns for different match formats. After PDF extraction, the columns came out interleaved — offense descriptions from column A mixed with penalty values from column B, line by line.

No amount of text splitting would make this coherent. The chunk for "Table 16" was gibberish.

### The Fix: Manual Restructuring

I restructured the source JSON by hand, adding context markers like `[Table 16 — Point Penalty Schedule: Standard Match]` and linearizing each column into its own readable block. It's the least automated part of the pipeline, but the data is stable (these tables don't change often), and the improvement in answer quality was dramatic.

---

## Step 3: Embeddings and Retrieval

With coherent chunks, I built an embedding pipeline using OpenAI's `text-embedding-3-small` model (1536 dimensions). Each chunk got embedded and stored in a JSON file alongside its text and metadata.

At query time:
1. Embed the user's question
2. Compute cosine similarity against all 618 chunk embeddings
3. Return the top 20 most similar chunks
4. Feed those chunks to the LLM as context

This cut token usage from 214K per request down to maybe 8–12K. Answers got more focused. Costs dropped. Response time improved.

**But I had no way to know if the answers were actually *correct*.**

---

## Step 4: Building an Eval System (and Learning Why It Matters)

I was testing by hand — asking questions and eyeballing answers — which is how you end up shipping confidently wrong responses. I needed automated evaluation.

I created 22 gold-standard test cases, each with:
- A user question
- The expected controlling source document
- Specific concepts the answer **must include**
- Concepts the answer **must not include** (common misconceptions)

For example, test case E001:
- **Query:** "During a local league game, 2.5 level, an opponent called a foot fault. Is that allowed?"
- **Must include:** "limited circumstances", "warning or reasonable efforts", "clear/flagrant foot fault"
- **Must not include:** "never allowed", "opponents can freely call any suspected foot fault"

The eval runner has two layers:
1. **Retrieval eval:** Did the right source document appear in the top 20 retrieved chunks?
2. **Answer quality eval:** I used an LLM-as-judge (GPT-4.1-mini) to check whether each must_include concept appears in the generated answer.

### First Run: 20/22 Pass

Not bad for a first attempt. The two failures taught me something important.

### Failure: E029 and E030 (Cross-Cutting Questions)

E029 asked about a hindrance during a point — what happens immediately *and* what penalties could follow. The answer covered the in-point outcome (from ITF Rules) but missed the penalty escalation (from Friend at Court). E030 had a similar pattern: it needed information from multiple sources, but the model only used one.

### The Fix: Prompt Engineering

I added a "COMBINING SOURCES FOR COMPLETE ANSWERS" section to the system prompt with explicit examples: "If someone asks about a hindrance, explain the in-point ruling from ITF Rules AND the penalty structure from Friend at Court." This was enough — both cases started passing.

---

## Step 5: The "Excerpts" Problem

While testing in the deployed app, I noticed the AI saying things like "Based on the excerpts provided..." and "The sources you gave me indicate..." — language that made no sense to an end user who just asked a question.

The model was leaking its own architecture. It knew it was reading retrieved chunks and was narrating that fact.

### The Fix: Stronger Guardrails

I hardened the system prompt instruction from a simple "don't reference the source material" to an explicit ban list: never say "the excerpts", "the sources you provided", "the passages", "based on what you gave me", etc. I also added a `REMINDER` line right before the source material block: "You are a knowledgeable tennis official answering from memory. Do not reference these materials directly."

This fixed the leaking without changing answer quality.

---

## Step 6: The Vocabulary Gap (Where Simple RAG Breaks Down)

This is where things got really interesting.

A user asked: **"Someone directed a racial slur at my opponent during a league match. What should happen?"**

The answer was weak. It talked about "unsportsmanlike conduct" in vague terms and missed key information about penalties, grievance procedures, and potential suspension.

I investigated and discovered the root cause: **the words "racial", "slur", and "ethnic" don't appear anywhere in any of the five source documents.** The rules talk about this topic using different vocabulary — "unsportsmanlike conduct", "abuse of ball/racket/equipment or officials", "default for misconduct", "hindrance". The embedding for the user's question had low similarity to the relevant chunks because the words simply didn't overlap.

This is the fundamental limitation of pure embedding-based retrieval. If the user says "racist" and the rulebook says "unsportsmanlike conduct", the vectors don't match well.

### Failure: The Brute Force Approach

My first idea was to just increase the number of retrieved chunks. If the relevant ones scored low, maybe casting a wider net would catch them. I tried top 30, top 40. This added more noise without reliably catching the right chunks, and it burned more tokens.

### The Fix: LLM Query Rewriting

The solution was to use a small, fast LLM (GPT-4.1-nano) to *rewrite* the user's question into the vocabulary a rulebook would use. Before embedding the query, I send it through a rewriter that outputs 3–5 search phrases:

**User query:** "Someone directed a racial slur at my opponent during a league match. What should happen?"

**Rewritten phrases:**
- unsportsmanlike conduct penalties
- abuse of officials or players
- default for misconduct
- grievance procedure after match
- player suspension league discipline

These rewritten phrases get embedded too, and I score each chunk against both the original query embedding and the rewrite embedding.

### Failure: The Rewrite Override Problem

My first scoring approach was `max(original_score, rewrite_score)` — take whichever embedding scored higher for each chunk. This worked great for the racism question (ITF Rules on unsportsmanlike conduct jumped into the top 20) but *broke* other cases.

Test case E027 asks: "My opponent is making terrible line calls and won't change them. What am I allowed to do?"

With the original embedding alone, The Code's line-calling rules ranked #2–6. Perfect. But the rewriter produced phrases like "appealing line call decisions" and "line call dispute procedures" — language associated with *officiated* matches. The rewrite embedding boosted Friend at Court's officiating procedures above The Code's unofficiated rules, pushing the correct chunks from rank 2 down to rank 16.

The rewrite was actively harmful for queries where the user's natural language already matched the rulebook vocabulary well.

### The Fix: Weighted Blend

Instead of `max(original, rewrite)`, I used a weighted blend:

```
score = original + 0.3 × max(0, rewrite - original)
```

The original embedding always dominates. The rewrite can *add* a little boost (30% of its advantage), but it can never override a strong original match. This preserved The Code at rank 2 for E027 while still lifting the ITF unsportsmanlike conduct chunks for the racism question.

### The Source Diversity Pass

One more refinement: even with query rewriting, some sources still didn't appear in the top 20 for cross-cutting questions. I added a diversity pass that checks which sources are represented in the results and appends the best chunk from any missing source, as long as it scores above a minimum relevance threshold (0.38).

This doesn't replace any existing results — it only appends. So you never lose a good Code chunk to make room for a marginal USTA regulations chunk.

---

## Step 7: The Security Incident

This one still makes me cringe.

Early in development, I committed my `.env` file — containing my OpenAI API key — and pushed it to GitHub. A public repository. With a live API key.

I caught it quickly, but "quickly" in git terms still means the key was in the commit history. Deleting `.env` and committing again doesn't remove it from history.

### The Fix

1. Used `git filter-branch` to scrub `.env` from the entire commit history
2. Force-pushed the cleaned history to GitHub
3. Rotated the API key on OpenAI's dashboard immediately
4. Updated the key in Vercel's environment variables
5. Added `.env` and `.env.local` to `.gitignore` (should have been there from the start)

**Lesson learned:** Add sensitive files to `.gitignore` *before you create them*. Not after.

### The Aftermath

The force-push corrupted file permissions in the git history, which broke Vercel's build — it couldn't `chmod +x` the Vite binary. I had to add `chmod +x node_modules/.bin/*` to the build command in `vercel.json`. A small price, but a reminder that recovering from security mistakes always has a tax.

---

## Where It Ended Up

After all of this iteration, the eval suite runs 25 test cases:

- **24/25 overall PASS** (with one known flicker)
- **46/50 must_include criteria met**
- **37/37 must_not_include criteria met**
- **24/25 expected sources found in retrieval**

The one missing must_include criterion is the racism case (E039), where the answer correctly explains the relevant rules but doesn't use one specific term the eval expects — because that term isn't in the source corpus. The system correctly identifies it as unsportsmanlike conduct and cites the right rules. Close enough for a vocabulary gap that can't be solved by retrieval alone.

---

## Step 8: User Feedback and Polishing for Real Users

With the core Q&A working well, I turned to the experience of someone actually *using* the app.

### Feedback Mechanism

I wanted to know which answers were helpful and which weren't — without requiring users to create accounts or fill out surveys. I added a simple thumbs-up / thumbs-down UI beneath every assistant response.

The implementation is lightweight: two emoji buttons that expand into an optional comment form with an email field for follow-up. The backend is a Vercel serverless function that forwards feedback as structured JSON to a Google Sheet via Apps Script webhook. Every submission gets a row in the spreadsheet — timestamp, rating, query, response, comment, email — where I can sort, filter, and reply directly. If the user provides an email, the Apps Script auto-sends a "thanks for your feedback" reply. No database, no paid services, just a spreadsheet.

I originally logged feedback to Vercel's function logs, but learned the hard way that the free tier only retains logs for about an hour. The Google Sheets approach is free, persistent, and lets me manage feedback from my phone.

The UI went through several iterations. First the buttons only appeared on hover — but on mobile, hover doesn't exist. I made them always visible. Then the thumbs and the copy button were on separate lines, which wasted space. I used a CSS `display: contents` trick to keep the buttons inline while letting the comment form expand full-width below. Then I over-styled the buttons with green borders and had to rein it back to subtle gray with green on hover.

Small details, but they added up. The toggle behavior was the last touch — clicking a selected thumb deselects it and hides the form, so users can change their mind without submitting.

### Cached Suggested Questions

The home screen shows six "Try asking:" suggestions to guide first-time users. Every time someone clicked one, it hit the OpenAI API — costing money and adding latency for what should be a *demo* moment.

The fix was dead simple: I stored pre-generated answers for all six suggested questions in a static JSON file. When the first message matches a cached question exactly, the hook returns the cached answer immediately — no API call, no loading spinner, no cost. If the user asks a follow-up or types a different question, it goes through the normal RAG pipeline.

This means the "tire-kicker" experience — clicking a suggestion to see what the app does — is instant and free.

### Sources Transparency

One last thing nagged me: users had no idea where the answers were coming from. The model cited rule numbers, but where would someone go to verify? I added a "Sources" button to the header that opens a modal listing all five official documents with direct PDF links. It's a small touch, but it signals that this isn't a hallucination machine — every answer traces back to a real, publicly available document.

### Mobile Responsive Design

I'd been testing on desktop the whole time. When I finally opened the app on my phone, the header was cramped, the suggestion chips were too wide, and everything felt squeezed. The app had zero responsive CSS.

I added a `@media (max-width: 600px)` breakpoint that hides the subtitle in the header, stacks the suggestion chips vertically, tightens padding throughout, and adjusts font sizes. Small changes, but the mobile experience went from "functional but uncomfortable" to "feels like a native app."

### The Scroll Problem

A subtler UX issue: the chat messages scrolled inside a fixed container, not the page itself. If your mouse wasn't hovering directly over the message area, scrolling did nothing. This is a common pattern in chat apps (Slack, ChatGPT), but for a simple Q&A tool it felt broken.

The fix was switching from an inner-scroll layout to full-page scroll with a sticky header and sticky input bar. Now you can scroll from anywhere on the page, and the header and text input stay pinned where you expect them.

This was the kind of issue I'd never have caught without testing on real devices with real people. The PWA service worker made it worse — cached old CSS meant I had to clear Safari's site data on my phone to even verify the fix worked.

---

## Step 9: Rate Limiting and Security Hardening

With the app live and working, I started thinking about what could go wrong if strangers found it.

### The Cost Problem

Every question costs money — embedding the query, rewriting it, embedding the rewrite, and generating the answer. Four OpenAI API calls per question. At low volume it's pennies, but there's nothing stopping someone from scripting 10,000 requests and running up my bill.

I set an OpenAI spending cap as a hard backstop, but I wanted something less blunt.

### Client-Side Rate Limiting

The first layer is a cookie-based counter in the browser. Each question increments a counter stored in a base64-encoded cookie (`pcr_count`) that tracks the date and count. When you hit 50 questions in a day, the app shows an error and stops sending requests. The display updates to show "X of 50 questions used today."

Is this bypassable? Absolutely — clear your cookies, open incognito, or edit the cookie value. It's a speed bump, not a wall. Its job is to prevent accidental overuse and give casual users a clear quota.

### Server-Side Rate Limiting

The second layer is an in-memory rate limiter on the Vercel serverless function, keyed by IP address. Same 50-request daily limit. This catches anyone who bypasses the client-side cookie.

**Caveat:** Vercel serverless functions are stateless — the in-memory Map resets on every cold start. So this limiter works well when the function is warm (which it usually is during active use) but doesn't persist across deploys or cold starts. A persistent store like Redis would be better, but I didn't want another account and another service to manage. Between the client cookie, the server limiter, and the OpenAI spending cap, the risk is bounded.

### The Security Review

Once rate limiting was in place, I did something I should have done earlier: a systematic code review across the entire codebase. Not "does it work" but "what can go wrong."

I found eight issues, ranging from crash bugs to injection vectors:

**Crash paths:** The RAG pipeline (embedding + rewriting) ran *outside* the try/catch block in the API handler. If OpenAI's embeddings API went down, the server threw an unhandled exception — no friendly error message, just a raw 500. Similarly, the cookie parser would crash the whole chat if someone tampered with the cookie value. And if OpenAI returned an empty `choices` array (content filter edge case), accessing `choices[0].message.content` threw.

**Prompt injection:** The server accepted whatever message roles the client sent. A malicious user could POST a message with `role: "system"` and `content: "Ignore all previous instructions"` — and the server would pass it straight to OpenAI alongside the real system prompt. The fix was simple: filter incoming messages to only allow `user` and `assistant` roles.

**Unbounded token cost:** The client sent the entire conversation history on every request. In a long conversation, this could be thousands of tokens of chat history on top of the system prompt and retrieved chunks. I capped it to the last 10 messages (5 exchanges) — enough context for follow-ups, bounded cost.

**IP spoofing:** The rate limiter used the `x-forwarded-for` header, which a client can fake. Switching to Vercel's `x-real-ip` header (set by Vercel's proxy, not spoofable) closed that gap.

**Misleading errors:** If the server returned a non-JSON error page (Vercel's raw 500 during an outage), the client's `response.json()` call threw, and the catch block said "Connection failed — check your network." The network was fine; the server was broken. Better error messages help users (and me) diagnose what's actually wrong.

None of these were visible to normal users. All of them would have been embarrassing in a code review or catastrophic in an adversarial scenario. The experience reinforced something I've heard engineers say: the features you ship are the easy part. The edges and failure modes are where the real work lives.

---

## What I Actually Learned

### AI assistants change what's possible, not what's easy

I couldn't have built this without an AI coding assistant. I don't know React. I don't know Vite. I hadn't heard of Vercel serverless functions. I didn't know what cosine similarity was.

But the AI didn't just write code and hand it to me. We went through a cycle — I described what I wanted, it built something, I tested it, it broke, I described what broke, it fixed it. Along the way I developed intuitions about how the system worked. By the time we were tuning the rewrite weight from `max` to `0.3 × boost`, I understood *why* that mattered.

### Evals are not optional

The single highest-leverage thing I did was building the eval system. Before evals, I was testing by vibes — "that answer looks about right." After evals, I could make a change and know within minutes whether it helped, hurt, or broke something unrelated. Every improvement after that point was measurable.

### Simple RAG has a ceiling

Embedding-based retrieval works remarkably well when the user's question uses similar vocabulary to the source material. It falls apart when there's a vocabulary gap. Query rewriting with a small LLM is an affordable bridge — a few cents per query to translate the user's language into the rulebook's language.

### The real engineering is in the data

The most impactful work wasn't the code — it was understanding the source documents. Learning that Friend at Court's Table 16 extracted as interleaved garbage. Discovering that each document used different heading conventions. Realizing that "racial slur" maps to "unsportsmanlike conduct" in rules language. The code was just the mechanism for encoding those insights.

### Shipping beats perfecting

The app has been live since the second day. Every improvement was deployed to production and tested by real users (my tennis teammates). Several of the eval cases came from their actual questions. The feedback loop of "ship → observe → fix" moved faster than any amount of up-front planning would have.

---

## The Stack (For the Curious)

- **Frontend:** React 18 + Vite, PWA with offline caching
- **Backend:** Vercel serverless functions (Node.js)
- **AI:** OpenAI API — `gpt-5.4-nano` for answers, `text-embedding-3-small` for retrieval, `gpt-4.1-nano` for query rewriting, `gpt-4.1-mini` for eval judging
- **Testing:** Vitest (58 unit tests) + custom eval runner (25 gold-standard cases)
- **Data:** 5 PDF sources → chunked JSON → 618 embedded chunks
- **UX:** Cached suggestion answers, thumbs-up/down feedback with Google Sheets + auto-reply, mobile responsive, full-page scroll
- **Security:** Client-side cookie rate limiting (50/day), server-side IP rate limiting, message role sanitization, conversation history cap, OpenAI spending cap

The full source is at [github.com/celticpidge/procourtrules](https://github.com/celticpidge/procourtrules).
