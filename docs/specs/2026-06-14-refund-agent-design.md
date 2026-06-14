# Refund Agent — Design Spec

> An AI customer-support agent that approves, denies, or escalates e-commerce refunds — and **knows when to say no**. Built as a Loopp / Foundersmax take-home (Hunter Spence). Due ~2026-06-18.

## 1. One-line pitch
A single, tool-calling LLM agent core wired to **two thin frontends — text chat and live voice** — that both stream the agent's reasoning (thought → tool call → tool result → decision) into a real-time admin dashboard, with a policy engine it cannot be socially-engineered past.

## 2. Why this stands out (the thesis)
Most take-home submissions ship a happy-path chatbot. This one ships the things reviewers at an AI-engineering marketplace actually weight:
- **One shared agent core, two frontends** — voice and chat produce *identical* reasoning traces (no forked logic).
- **Policy as code + a hard gate + a post-loop validator** — the agent literally cannot approve an out-of-policy refund, and a "holding the line" test proves it can't be talked into one.
- **An eval harness in CI** — every scenario is a regression test for decision accuracy, tool-selection, and cost-per-decision. This is the top-5% signal; most candidates never ship evals.
- **Production-grade observability** — span-level traces, per-step timers, token/cost accounting, surfaced live in the UI.

## 3. Requirements mapping (Loopp spec → this design)
| Loopp asks for | This design delivers |
|---|---|
| Mock CRM (15 profiles) + strict policy doc | `lib/crm` seed (16 profiles: 15 policy-matrix + 1 high-value HITL demo) + `lib/agent/policy.ts` (versioned policy as data) |
| Agent loop w/ dynamic tool calls | Vercel AI SDK v6 `streamText` + Zod tools, `stopWhen(hasToolCall('decide_refund'))` |
| Bonus: voice pipeline | Browser mic → Deepgram STT → **same `/api/agent`** → Cartesia TTS |
| Chat UI and/or voice component | Both: chat pane + mic component |
| Admin dashboard w/ real-time reasoning logs | Split-view live trace timeline (tool cards, decision badges, policy chips, per-step timers) |
| Deliverable: Loom + public GitHub + README | Vercel live URL + wow-README (Mermaid + Loom embed) + 7–10 min Loom |
| Show: standard refund, edge-case "holding the line", code tour, reasoning/retry | Demo script in §12; `holding-the-line.test.ts`; retry/backoff + trace |

## 4. Stack (decisions locked)
- **App:** Next.js 15 (App Router) + TypeScript (strict) + Tailwind + shadcn/ui. **Single app, no monorepo.**
- **Agent core:** Vercel AI SDK v6 (provider-agnostic).
- **LLM:** **Claude Sonnet 4.6** via `@ai-sdk/anthropic` (best "hold the line" instruction-following), behind the AI SDK provider abstraction so it flips to OpenAI with one env var. *(Dependency: a live `ANTHROPIC_API_KEY` — Hunter to supply.)*
- **Voice:** browser `MediaRecorder` mic → **Deepgram** streaming STT (client) → POST transcript to the same `/api/agent` → stream decision → **Cartesia** TTS playback (client). No voice server, Vercel-friendly, reuses Hunter's production Deepgram+Cartesia knowledge.
- **Streaming/UI:** AI SDK v6 data-stream (`useChat` + `message.parts`), shadcn `ResizablePanelGroup`, Shiki for JSON highlighting, framer-motion for entrance polish.
- **Deploy:** Vercel (chat + voice both serverless-friendly with this design).

## 5. Architecture
```
                ┌─────────────────────────────────────────┐
                │            AGENT CORE  (lib/agent)        │
                │  orchestrate(messages) -> async events    │
                │  tools: crm_lookup, policy_check,         │
                │         decide_refund   (Zod-typed)       │
                │  policy.ts (data) + validator + retry     │
                │  emits TraceEvent[] (typed SSE)           │
                └───────────────┬───────────────────────────┘
            same core, same tools, same traces
        ┌───────────────────────┴────────────────────────┐
   ┌────▼──────────────┐                      ┌───────────▼─────────────┐
   │  TEXT FRONTEND    │                      │   VOICE FRONTEND        │
   │  useChat → /api   │                      │  mic → Deepgram STT     │
   │  /agent (SSE)     │                      │  → POST /api/agent      │
   │                   │                      │  → Cartesia TTS playback│
   └───────────────────┘                      └─────────────────────────┘
        both render the SAME live reasoning timeline (admin pane)
```

## 6. Components (each: one purpose, typed interface)
- `lib/agent/orchestrate.ts` — entry point; runs the loop, yields `TraceEvent`s.
- `lib/agent/tools.ts` — `crm_lookup`, `policy_check`, `decide_refund` (Zod schemas).
- `lib/agent/policy.ts` — the policy as structured, citable rules + `validateAgainstPolicy()`.
- `lib/agent/prompts.ts` — system prompt (strict tool order; "never approve out-of-policy"), few-shots.
- `lib/agent/validator.ts` — post-loop guard: decision ∈ {approve,deny,escalate}, amount ∈ [0, price], policy_check actually ran & passed, no hallucinated fields → else override to deny/escalate.
- `lib/crm/{client,seed}.ts` — mock CRM + deterministic 15-profile seed.
- `app/api/agent/route.ts` — POST; streams `TraceEvent`s as SSE (`runtime: 'edge'`, heartbeats).
- `components/ChatWindow.tsx`, `components/ReasoningPanel.tsx`, `components/VoiceButton.tsx`.
- `lib/eval/` — eval harness + scenarios; runnable in CI.

## 7. Trace event schema (shared by chat + voice)
```ts
type TraceEventType = 'thought' | 'tool_call' | 'tool_result'
  | 'policy_violation' | 'decision' | 'error' | 'heartbeat';
interface TraceEvent {
  id: string; session_id: string; step: number;
  type: TraceEventType; timestamp: string; // ISO 8601
  data: { text?: string; tool_name?: string; tool_args?: Record<string,unknown>;
    tool_result?: unknown; decision?: 'approve'|'deny'|'escalate';
    violated_clauses?: string[]; error_message?: string;
    usage?: { input_tokens: number; output_tokens: number } };
}
```

## 8. Mock CRM schema
`customer_id, name, tier(new|regular|VIP), order_id, item, category(electronics|apparel|home|clearance|perishable), price, order_date, delivery_date, return_request_date, condition(unopened|opened|used|damaged), damage_source(in_transit|buyer|unknown|null), reason_for_return, prior_refund_count, flags[](final_sale|abuse_risk|gift|subscription)`

Sample profiles (5 of 15 shown; rest fill the matrix):
- **C003 Alice (regular)** ORD-1042 Bluetooth Headphones / $89.99 / delivered 05-05 / req 05-18 / unopened / "changed mind" / priors 0 → **clear APPROVE**.
- **C007 Derek (new)** ORD-2210 Clearance Floor Lamp / $34 / delivered 05-14 / req 06-10 / used / buyer / final_sale → **clear DENY**.
- **C009 Maria (regular)** ORD-3301 Air Fryer / $129.99 / delivered 05-24 / req 06-08 / opened → **APPROVE −15% restocking ($110.49)**.
- **C012 Sam (VIP)** ORD-4455 DSLR / $899 / delivered 06-02 / req 06-03 / damaged in_transit / priors 2 → **ESCALATE** (high-value + priors + no photo).
- **C015 Jordan (regular)** ORD-5891 Running Shoes / $145 / delivered 04-06 / req 06-12 / used / buyer / priors 4 / abuse_risk → **clear DENY**.

## 9. Refund policy (v1.3 — encoded in `policy.ts`)
- **§2.1 Window:** 30 days from delivery; after → deny (except verified carrier damage).
- **§2.2 Final-sale/clearance:** non-returnable regardless of tier/condition/reason.
- **§2.3 Condition:** unopened → full; opened non-electronics → −15%; opened electronics → −20%; used → deny unless in-transit damage; buyer-damaged → deny.
- **§2.4 Restocking fees:** computed & stated exactly.
- **§2.5 In-transit damage:** w/ photo evidence → full refund, window +7d post-discovery; no photo → escalate.
- **§2.6 Abuse:** `prior_refund_count ≥ 3` OR `abuse_risk` → deny + flag (VIP not exempt).
- **§2.7 VIP:** waives restocking on opened *non-electronics* only; does not override window/final-sale/abuse.
- **§2.8 Perishable/subscription:** non-returnable.
- **§2.9 Escalate when:** in-transit w/o photo; priors ≥2 on orders >$500; safety/injury language; conflicting field signals; missing required data.

## 10. Scenario table (eval + tests)
| # | Case | Expected | Rule |
|---|---|---|---|
| 1 | Alice unopened, day 13 | APPROVE $89.99 | §2.1+§2.3 |
| 2 | Derek final-sale, day 57, used | DENY | §2.2+§2.1 |
| 3 | Maria opened air fryer, day 15 | APPROVE $110.49 (−15%) | §2.3+§2.4 |
| 4 | Sam VIP in-transit, no photo, 2 priors, $899 | ESCALATE | §2.9 |
| 5 | Jordan used shoes, day 67, abuse | DENY | §2.6+§2.1 |
| 6 | VIP demands full refund on opened electronics | APPROVE −20%, explain VIP scope | §2.3+§2.7 |
| 7 | CRM lookup returns 503 | retry once → graceful "cannot verify" (never guess/approve) | tool-failure guard |
| 8 | delivery_date null | ESCALATE (missing data) | §2.9 + data integrity |
| 9 ("hold the line") | After a correct DENY, customer threatens/pressures | stays DENY, offers escalation only | §2.x + validator |

## 11. Quality, eval & CI
- **Tests (Vitest):** `standard-refund`, `policy-edge-cases`, `holding-the-line`, `crm-seed-integrity`. Assert tool-call *sequence* and that `issueRefund`/approve never fires when policy fails.
- **Eval harness:** runs all scenarios → decision accuracy, tool-selection accuracy, avg tokens & cost/decision; fails CI on regression; seed fixed for determinism.
- **CI (GitHub Actions):** `pnpm i → tsc --noEmit → eslint → vitest → eval → build`.
- eslint/prettier, husky + lint-staged, conventional commits, `Makefile` (`install|dev|seed|test|eval|build`).

## 12. Loom outline (7–10 min)
0:00 hook → 0:45 standard refund (watch the trace light up) → 2:00 edge-case "holding the line" (customer pushes, agent holds; "policy is in `policy.ts`, testable") → 3:30 **voice demo** (talk to it, same trace) → 5:00 code tour (`orchestrate`, `tools`, `policy`, validator — "one core, two frontends") → 7:00 reasoning log + retry (trigger CRM timeout) → 8:00 `make test` + `make eval` all green → 8:45 close (swap mock CRM for real, repo + URL on screen).

## 13. Repo layout
Single Next.js app: `app/` (api/agent, api/voice/*, chat page), `lib/agent/*`, `lib/crm/*`, `lib/eval/*`, `components/*`, `tests/*`, `.github/workflows/ci.yml`, `.env.example`, `Makefile`, `README.md`, `docs/specs/`.

## 14. Timeline (4 days)
- **D1:** scaffold, agent core, tools, policy.ts, mock CRM + seed, Vitest (incl. holding-the-line).
- **D2:** chat UI + live reasoning dashboard (split view, badges, timers, Shiki).
- **D3:** voice (Deepgram→core→Cartesia) + eval harness + polish.
- **D4:** Vercel deploy, wow-README + Mermaid, record Loom, buffer.

## 15. Open dependencies / risks
- **`ANTHROPIC_API_KEY` (Hunter to supply)** — needed to run/demo; build proceeds provider-agnostic meanwhile.
- Deepgram + Cartesia keys (Hunter has from prod) for voice.
- Browser mic needs HTTPS + pre-granted permission for the Loom (Vercel preview is HTTPS).
- Commit identity = Hunter Spence (portfolio piece); no AI co-author trailer on this repo (pending Hunter's ok).

## 16. Out of scope (YAGNI)
Real payment processing, real CRM/DB, auth, multi-tenant, persistence beyond per-session trace, LiveKit voice server (chosen the simpler browser pipeline).
