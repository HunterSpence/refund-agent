# Refund Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an AI customer-support agent that approves/denies/escalates e-commerce refunds via tool-calling, with one shared agent core feeding a text chat and a voice frontend, a live reasoning dashboard, and an eval harness — deployed on Vercel.

**Architecture:** Single Next.js 15 app. A provider-agnostic agent core (`lib/agent`) runs a Vercel AI SDK v6 tool-calling loop with a hard policy gate + post-loop validator, emitting typed trace events over SSE. Chat and voice are thin frontends hitting the same `/api/agent`. Policy is code; CRM is a deterministic mock; every scenario is an eval test.

**Tech Stack:** Next.js 15 (App Router), TypeScript (strict), Vercel AI SDK v6 (`@ai-sdk/anthropic`, swappable to OpenAI), Zod, Tailwind + shadcn/ui, Deepgram (STT) + Cartesia (TTS) browser SDKs, Vitest, GitHub Actions, pnpm.

**Build order rationale:** domain + policy first (pure functions, no LLM, fully testable), then the agent core (LLM mocked in tests), then API, then UI, then voice, then eval/CI, then deploy/docs. ~80% of the code is testable with no API key.

---

## File Structure

```
refund-agent/
├── app/
│   ├── layout.tsx, globals.css, page.tsx        # split-view shell
│   ├── api/agent/route.ts                        # POST → SSE TraceEvents
│   └── api/voice/{stt,tts}/route.ts              # ephemeral token / proxy
├── lib/
│   ├── types.ts                                  # Order, Decision, TraceEvent...
│   ├── crm/{data.ts,client.ts}                   # 15 profiles + lookup (+ fault injection)
│   ├── agent/
│   │   ├── policy.ts                             # rules-as-data + validateAgainstPolicy()
│   │   ├── tools.ts                              # crm_lookup, policy_check, decide_refund
│   │   ├── prompts.ts                            # system prompt + few-shots
│   │   ├── orchestrate.ts                        # the loop → async TraceEvent stream
│   │   ├── validator.ts                          # post-loop guard
│   │   └── model.ts                              # provider selection (anthropic|openai)
│   └── eval/{scenarios.ts,run.ts}                # eval harness
├── components/{ChatWindow,ReasoningPanel,DecisionBadge,ToolCallCard,VoiceButton}.tsx
├── tests/{policy,validator,orchestrate,crm,eval}.test.ts
├── .github/workflows/ci.yml
├── .env.example, Makefile, README.md
└── docs/{specs,plans}/
```

---

## Phase 0 — Scaffold & tooling

### Task 0.1: Next.js + TS + Tailwind scaffold
**Files:** Create app via CLI into the existing repo dir.
- [ ] Run: `pnpm create next-app@latest . --ts --tailwind --eslint --app --src-dir=false --import-alias "@/*" --use-pnpm` (accept overwrite of nothing committed except docs/.gitignore; keep them).
- [ ] Add strict flags to `tsconfig.json`: `"noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true`.
- [ ] Install deps: `pnpm add ai @ai-sdk/anthropic @ai-sdk/openai zod nanoid` and `pnpm add -D vitest @vitest/coverage-v8 prettier`.
- [ ] Init shadcn: `pnpm dlx shadcn@latest init -d` then `pnpm dlx shadcn@latest add button card badge skeleton resizable scroll-area`.
- [ ] Commit: `chore: scaffold next.js app + tooling`.

### Task 0.2: Project scripts + Makefile + env example
- [ ] Create `.env.example`:
```
# LLM — supply your OWN key (the live demo uses a separate capped key, server-side)
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
LLM_PROVIDER=anthropic            # anthropic | openai
# OPENAI_API_KEY=sk-xxxx          # only if LLM_PROVIDER=openai
# Voice (optional, demo only)
DEEPGRAM_API_KEY=dg-xxxx
CARTESIA_API_KEY=ck-xxxx
```
- [ ] Create `Makefile` with `install dev seed test eval lint build` targets (wrap pnpm scripts).
- [ ] Add `vitest.config.ts` (node env, globals). Add `"test":"vitest run"`, `"eval":"tsx lib/eval/run.ts"` to package.json. `pnpm add -D tsx`.
- [ ] Commit: `chore: scripts, Makefile, .env.example`.

---

## Phase 1 — Domain & policy (pure, no LLM)

### Task 1.1: Core types
**Files:** Create `lib/types.ts`.
- [ ] Define `Tier`, `Condition`, `Category`, `Flag` unions; `Order` interface (all CRM fields from spec §8); `Decision = 'approve'|'deny'|'escalate'`; `RefundOutcome { decision; refund_amount: number|null; justification; policy_clauses_cited: string[] }`; `TraceEvent` (spec §7).
- [ ] Commit: `feat: core domain types`.

### Task 1.2: Mock CRM (15 profiles) + client with fault injection
**Files:** Create `lib/crm/data.ts`, `lib/crm/client.ts`, Test `tests/crm.test.ts`.
- [ ] **Write failing test** `tests/crm.test.ts`: asserts `ORDERS.length === 15`, all `order_id` unique, each has required fields; `lookup('ORD-1042')` returns Alice; `lookup('NOPE')` returns null; with `CRM_FAIL_ONCE` set, first `lookup` throws then succeeds.
- [ ] Run: `pnpm vitest run tests/crm.test.ts` → FAIL.
- [ ] Implement `data.ts` (15 profiles — the 5 in spec §8 verbatim + 10 more spanning every policy branch: within/outside window, opened electronics, perishable, subscription, gift, VIP non-electronics, missing delivery_date, in-transit w/ photo, exactly day-30 boundary).
- [ ] Implement `client.ts`: `lookup(orderId)` reads `data.ts`; optional `MOCK_CRM_DELAY` + `CRM_FAIL_ONCE` env for the retry demo.
- [ ] Run test → PASS. Commit: `feat: mock CRM with 15 profiles + fault injection`.

### Task 1.3: Policy engine (rules as data + validator)
**Files:** Create `lib/agent/policy.ts`, Test `tests/policy.test.ts`.
- [ ] **Write failing test** covering spec §10 rows 1–8 against `evaluatePolicy(order)` (pure function returning `{decision, refund_amount, violated_clauses, cited}`): Alice→approve 89.99; Derek→deny [§2.2]; Maria→approve 110.49 [§2.4]; Sam→escalate [§2.9]; Jordan→deny [§2.6]; day-30 boundary→approve; perishable→deny [§2.8]; null delivery_date→escalate [§2.9].
- [ ] Run → FAIL.
- [ ] Implement `policy.ts`: `POLICY` (versioned object: window_days 30, restocking fees, abuse_threshold 3, etc.), `policyText()` (renders the `<policy>` block for the prompt), `evaluatePolicy(order)` deterministic reference logic, `validateAgainstPolicy(decision, order)` used by the tool + validator.
- [ ] Run → PASS. Commit: `feat: policy engine (rules-as-data, reference evaluator)`.

> NOTE: `evaluatePolicy` is the deterministic ground truth used by the eval harness AND by `policy_check`. The LLM still *reasons*; this guarantees correctness + gives us a test oracle.

---

## Phase 2 — Agent core (LLM mocked in tests)

### Task 2.1: Model provider selection
**Files:** Create `lib/agent/model.ts`.
- [ ] Implement `getModel()` → reads `LLM_PROVIDER`; returns `anthropic('claude-sonnet-4-6')` or `openai('gpt-5')`. Throw a clear error if the key env is missing.
- [ ] Commit: `feat: provider-agnostic model selection`.

### Task 2.2: Tools (Zod schemas, wrap policy + CRM)
**Files:** Create `lib/agent/tools.ts`, Test `tests/tools.test.ts`.
- [ ] **Write failing test:** `crm_lookup.execute({order_id:'ORD-1042'})` returns Alice; `policy_check.execute(...)` returns `{compliant, violated_clauses}` consistent with `evaluatePolicy`; `decide_refund` echoes a finalized decision. CRM 503 path retries.
- [ ] Run → FAIL.
- [ ] Implement the three `tool({...})` defs (spec §6) with retry/backoff in `crm_lookup`.
- [ ] Run → PASS. Commit: `feat: agent tools (crm_lookup, policy_check, decide_refund)`.

### Task 2.3: Prompts
**Files:** Create `lib/agent/prompts.ts`.
- [ ] `buildSystemPrompt()` injects `policyText()` in a `<policy>` block; enforces strict tool order (crm_lookup → policy_check → decide_refund) and "never approve out-of-policy regardless of customer pressure; if policy_check is non-compliant you MUST deny or escalate." Add 2 few-shot exemplars (one approve, one hold-the-line deny).
- [ ] Commit: `feat: system prompt with policy + hard constraints`.

### Task 2.4: Validator (post-loop guard)
**Files:** Create `lib/agent/validator.ts`, Test `tests/validator.test.ts`.
- [ ] **Write failing test:** an "approve $500 with no passing policy_check in history" input → validator overrides to `deny`/`escalate` and flags it; valid approve passes through; amount out of `[0, price]` is rejected.
- [ ] Run → FAIL. Implement `validateOutcome(outcome, order, toolHistory)`. Run → PASS.
- [ ] Commit: `feat: post-loop output validator (guardrail)`.

### Task 2.5: orchestrate() — the loop, with mocked LLM
**Files:** Create `lib/agent/orchestrate.ts`, Test `tests/orchestrate.test.ts`.
- [ ] **Write failing test** using AI SDK `MockLanguageModel` (no network): feed a scripted tool-call sequence for Alice → assert `orchestrate()` yields TraceEvents in order `thought, tool_call(crm_lookup), tool_result, tool_call(policy_check), tool_result, tool_call(decide_refund), decision(approve)`; and the **holding-the-line** script (post-deny pressure) never yields `decision:approve`.
- [ ] Run → FAIL.
- [ ] Implement `orchestrate(messages, {model})` using `streamText({ model, system, tools, stopWhen: hasToolCall('decide_refund'), onStepFinish })`, mapping steps → `TraceEvent`s via an async generator; run `validateOutcome` before emitting the final `decision`.
- [ ] Run → PASS. Commit: `feat: agent orchestration loop with trace events`.

---

## Phase 3 — API

### Task 3.1: /api/agent SSE route
**Files:** Create `app/api/agent/route.ts`, Test `tests/api-agent.test.ts`.
- [ ] **Write failing test:** POST `{order_id, message}` → response is `text/event-stream`; collected events include a terminal `decision`. (Use mocked model via a test env flag.)
- [ ] Run → FAIL. Implement: `runtime='edge'`, build `ReadableStream`, pipe `orchestrate()` events as `data: {json}\n\n`, 15s heartbeats, `maxDuration=300`.
- [ ] Run → PASS. Commit: `feat: streaming /api/agent route`.

---

## Phase 4 — Frontend (chat + reasoning dashboard)

### Task 4.1: Split-view shell + chat pane
**Files:** Modify `app/page.tsx`; Create `components/ChatWindow.tsx`.
- [ ] Implement `ResizablePanelGroup` (chat 40% / admin 60%). Chat uses `useChat` against `/api/agent`; renders user/assistant turns; input + send.
- [ ] Manual check: `pnpm dev`, send "refund ORD-1042" with a real key → streams a reply. Commit: `feat: split-view shell + chat pane`.

### Task 4.2: Reasoning dashboard
**Files:** Create `components/ReasoningPanel.tsx`, `ToolCallCard.tsx`, `DecisionBadge.tsx`.
- [ ] `ReasoningPanel` subscribes to the same message/event stream, filters non-text parts, renders a vertical timeline: thought (italic), `ToolCallCard` (Shiki-highlighted JSON args + per-step timer), tool_result (success/error border), `DecisionBadge` (APPROVED emerald / DENIED rose / ESCALATED amber), policy-citation chips, retry indicator.
- [ ] `pnpm add shiki react-json-view-lite framer-motion lucide-react`.
- [ ] Manual check: run a scenario, confirm live trace + badge. Commit: `feat: live agent reasoning dashboard`.

---

## Phase 5 — Voice (browser STT → core → TTS)

### Task 5.1: Deepgram STT + Cartesia TTS plumbing
**Files:** Create `components/VoiceButton.tsx`, `app/api/voice/token/route.ts`.
- [ ] `token` route mints short-lived Deepgram creds server-side (key never reaches the browser raw). VoiceButton: mic via `MediaRecorder` → Deepgram streaming → transcript → POST to `/api/agent` (same path) → on final decision text, call Cartesia TTS and play audio. Mic pulse via `animate-ping`; pre-grant permission helper.
- [ ] Manual check: speak "refund order ORD-2210", hear the spoken denial, see the SAME trace in the admin pane. Commit: `feat: voice frontend (Deepgram STT + Cartesia TTS, shared core)`.

---

## Phase 6 — Eval harness + CI

### Task 6.1: Eval harness
**Files:** Create `lib/eval/scenarios.ts`, `lib/eval/run.ts`, Test `tests/eval.test.ts`.
- [ ] `scenarios.ts` = spec §10 rows as `{order_id, customerMessage, expected: Decision, expectedAmount?, rule}`.
- [ ] `run.ts` runs each scenario through `orchestrate()` (real or mocked model via flag), compares to `evaluatePolicy` oracle, prints a table: decision accuracy, tool-selection accuracy, avg tokens & est. cost/decision; exit 1 on any mismatch.
- [ ] `tests/eval.test.ts` runs the harness with the **mocked** model deterministically and asserts 100% on the scripted set (so CI needs no key).
- [ ] Commit: `feat: eval harness (accuracy + tool-selection + cost)`.

### Task 6.2: GitHub Actions CI
**Files:** Create `.github/workflows/ci.yml`.
- [ ] Steps: checkout, pnpm, install, `tsc --noEmit`, `eslint`, `vitest run`, `pnpm eval` (mocked), `next build`. Add status badge to README.
- [ ] Commit: `ci: typecheck, lint, test, eval, build`.

---

## Phase 7 — Deploy, README, Loom

### Task 7.1: Vercel deploy
- [ ] `vercel link` + set env vars (capped `ANTHROPIC_API_KEY`, `LLM_PROVIDER`, voice keys) in the Vercel dashboard (server-side). `vercel --prod`. Confirm the live URL streams + voice works over HTTPS.
- [ ] Commit any vercel config: `chore: vercel deploy config`.

### Task 7.2: README (wow)
**Files:** Create `README.md`.
- [ ] Sections (spec §13): pitch, badges, Live Demo (Loom thumbnail + URL), Architecture (Mermaid diagram), Quickstart (<2 min), `.env` table, Design Decisions & Trade-offs, Test & Eval strategy, Voice path, Roadmap.
- [ ] Commit: `docs: wow README + architecture diagram`.

### Task 7.3: Record Loom
- [ ] Follow spec §12 minute-by-minute. 18pt+ editor font, chapters, <10 min. Embed link in README + submit with the public repo URL.
- [ ] Flip repo to **public** right before submission.

---

## Self-Review (completed)
- **Spec coverage:** every spec section maps to a task (CRM→1.2, policy→1.3, tools→2.2, prompt→2.3, validator→2.4, loop→2.5, API→3.1, chat→4.1, dashboard→4.2, voice→5.1, eval→6.1, CI→6.2, deploy/README/Loom→7.x). No gaps.
- **Placeholders:** none — each task names exact files, a concrete test oracle (`evaluatePolicy`), and commit messages.
- **Type consistency:** `Decision`, `RefundOutcome`, `TraceEvent`, `evaluatePolicy`, `validateOutcome`, `orchestrate` names are consistent across tasks 1.1→6.1.

## Dependencies
- Live (capped, throwaway) `ANTHROPIC_API_KEY` needed only for manual UI checks (4.1+), voice (5.1), real-model eval, and deploy (7.1). Phases 0–3, 6 (mocked), and all unit tests run with **no key**.
