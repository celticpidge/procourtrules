# Pro Court Rules — Roadmap

## Phase 0: Design & Architecture
> UX foundations and shared data model — before feature code.

- [ ] **Mode-switching UX design** — How users enter/exit modes (Dispute, Show Opponent, Scenario). Wireframes for navigation.
- [ ] **Persistence architecture decision** — Local-first (IndexedDB) vs. backend (Vercel KV). Needed for History, League Personalization.

## Phase 1: Intelligence & Infrastructure (Weeks 1–2)

- [ ] **Confidence + Source Strength Indicators** — Show whether a ruling is a direct rule citation, code interpretation, or contextual guidance. Feeds into every subsequent feature. [#22](https://github.com/celticpidge/procourtrules/issues/22)
- [ ] **League-Aware Personalization** — User sets USTA league, level, and match type; answers adapt accordingly. Introduces the user-preferences layer. [#23](https://github.com/celticpidge/procourtrules/issues/23)
- [ ] **Escalation Guidance** — Structured next-steps when players can't agree (replay point, call captain, self-report). Extends existing chat answers. [#24](https://github.com/celticpidge/procourtrules/issues/24)

## Phase 2: Structured Modes (Weeks 3–5)

- [ ] **Scenario-Based Entry** — Quick-access flows for common issues: line calls, serve order, hindrance, lineup disputes. Establishes multi-step flow pattern. [#25](https://github.com/celticpidge/procourtrules/issues/25)
- [ ] **Common Disputes Library** — Searchable repository of frequently contested situations. New page/route. [#26](https://github.com/celticpidge/procourtrules/issues/26)
- [ ] **Resolve the Dispute Mode** — Guided conflict resolution: clarifying questions → decision → suggested language → rule citation. Flagship feature. [#27](https://github.com/celticpidge/procourtrules/issues/27)
- [ ] **Show Opponent Mode** — One-tap clear ruling + authoritative source, optimized for quick on-court agreement. Display layer on Dispute Mode output. [#28](https://github.com/celticpidge/procourtrules/issues/28)

## Phase 3: Interaction & Persistence (Weeks 5–7)

- [ ] **Dispute History / Match Log** — Track in-match questions and outcomes. Persistence layer (IndexedDB or backend). [#31](https://github.com/celticpidge/procourtrules/issues/31)
- [ ] **Voice Input for On-Court Use** — Hands-free questions via Web Speech API. Can attach to any input. [#29](https://github.com/celticpidge/procourtrules/issues/29)

## Phase 4: Native Apps (Weeks 7+)

- [ ] **iOS and Android App Availability** — Options: Capacitor wrapper (fastest), React Native rewrite, or enhanced PWA with install prompts + offline support. [#30](https://github.com/celticpidge/procourtrules/issues/30)
