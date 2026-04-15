# Pro Court Rules — Roadmap

## Phase 0: Design & Architecture
> UX foundations and shared data model — before feature code.

- [ ] **Mode-switching UX design** — How users enter/exit modes (Dispute, Show Opponent, Scenario). Wireframes for navigation.
- [ ] **Persistence architecture decision** — Local-first (IndexedDB) vs. backend (Vercel KV). Needed for History, League Personalization.

## Phase 1: Intelligence & Infrastructure (Weeks 1–2)

- [ ] **Confidence + Source Strength Indicators** — Show whether a ruling is a direct rule citation, code interpretation, or contextual guidance. Feeds into every subsequent feature. *(#1)*
- [ ] **League-Aware Personalization** — User sets USTA league, level, and match type; answers adapt accordingly. Introduces the user-preferences layer. *(#2)*
- [ ] **Escalation Guidance** — Structured next-steps when players can't agree (replay point, call captain, self-report). Extends existing chat answers. *(#3)*

## Phase 2: Structured Modes (Weeks 3–5)

- [ ] **Scenario-Based Entry** — Quick-access flows for common issues: line calls, serve order, hindrance, lineup disputes. Establishes multi-step flow pattern. *(#4)*
- [ ] **Common Disputes Library** — Searchable repository of frequently contested situations. New page/route. *(#5)*
- [ ] **Resolve the Dispute Mode** — Guided conflict resolution: clarifying questions → decision → suggested language → rule citation. Flagship feature. *(#6)*
- [ ] **Show Opponent Mode** — One-tap clear ruling + authoritative source, optimized for quick on-court agreement. Display layer on Dispute Mode output. *(#7)*

## Phase 3: Interaction & Persistence (Weeks 5–7)

- [ ] **Dispute History / Match Log** — Track in-match questions and outcomes. Persistence layer (IndexedDB or backend). *(#8)*
- [ ] **Voice Input for On-Court Use** — Hands-free questions via Web Speech API. Can attach to any input. *(#9)*

## Phase 4: Native Apps (Weeks 7+)

- [ ] **iOS and Android App Availability** — Options: Capacitor wrapper (fastest), React Native rewrite, or enhanced PWA with install prompts + offline support. *(#10)*

---

*Issue numbers (e.g. #1) will be updated once GitHub Issues are created.*
