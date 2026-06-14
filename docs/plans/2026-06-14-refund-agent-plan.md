# Refund Agent — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An AI customer-support agent that approves/denies/escalates e-commerce refunds via tool-calling, with one shared agent core feeding a text chat + a voice frontend, a live reasoning dashboard, durable tracing, and an eval harness — deployed on Vercel. Built to be **defensible in a 30-min code-walkthrough interview.**

**Architecture:** Single Next.js 15 app. Provider-agnostic agent core (`lib/agent`) runs a Vercel **AI SDK v6** tool-calling loop with **deterministic tool ordering (`prepareStep`/`activeTools`)**, a policy-as-code oracle, and a post-loop validator, emitting typed trace events. Chat + voice are thin frontends hitting the same `/api/agent` (Node runtime). Policy is code; CRM is a deterministic mock; the two highest-signal scenarios are CI-gated evals.

**Tech Stack:** Next.js 15, TypeScript strict, **`ai@^6` + `@ai-sdk/react@^6` + `@ai-sdk/anthropic` (swappable `@ai-sdk/openai`)**, Zod, Tailwind + shadcn/ui, `@deepgram/sdk` v3 + `@cartesia/cartesia-js` v3 (browser, ephemeral tokens), `@langfuse/vercel`, Vitest (`MockLanguageModelV3`), GitHub Actions, pnpm.

---

## Changes from v1 (from the 4-agent Opus validation)

**Verdict:** strong plan, ship with these changes.

**API CORRECTIONS (v6 — v1 used v4/v5 names that break):**
- `tool({ inputSchema })` — NOT `parameters`.
- `stopWhen: [hasToolCall('decide_refund'), stepCountIs(10)]` — NOT `maxSteps`.
- Enforce tool order with `prepareStep` → `activeTools` (deterministic; the model literally can't call out-of-order tools). This replaces prompt-only ordering.
- Route returns `result.toUIMessageStreamResponse()` — NOT `toDataStreamResponse()`. **Runtime = `nodejs`, NOT `edge`** (edge can't do long-lived SSE / voice).
- Client reads `message.parts[]`; tool parts are `type: 'tool-{name}'` with `state` `input-streaming→input-available→output-available`. Custom trace via `createUIMessageStream` + `writer.write({type:'data-trace',...})`.
- Tests use `MockLanguageModelV3` from `ai/test` + `simulateReadableStream`. `useChat` from `@ai-sdk/react`.

**ADD (high ROI):**
- **Prompt-injection guard:** bind `order_id` from session context (not free user text) where possible; never echo raw user input into tool descriptions; `assertNoOverride()` scan on inbound user messages. (#1 senior-review ding.)
- **Langfuse tracing** via `@langfuse/vercel` in `onStepFinish` → persistent trace tree (latency + token cost per decision). The **two-panel Loom shot (Langfuse + live timeline)** is the highest-leverage 30s of the demo.
- **`outputSchema` on `decide_refund`** so the final decision is Zod-validated at the boundary (validator becomes structurally enforced).

**CUT (YAGNI / interview-noise):**
- CRM fault-injection retry demo (retry is implicit in the step loop; not worth the time).
- Per-step UI timers → show **aggregate latency on the decision badge** instead.

**CHANGE:**
- Eval harness scoped to the **2 killer scenarios** (holding-the-line + day-31 boundary) as a **CI-gated badge**; broader scenarios run locally.
- README adds a **"production voice = LiveKit" paragraph** (pre-empts the scale question).

**Defensibility (this is graded):** every file must be explainable by Hunter. The 30-min interview is a code walkthrough — "why this, not that", edge cases, failure modes, and **"how do you know it works?" (evals — the #1 rejection point).** A `docs/INTERVIEW-PREP.md` is a deliverable.

---

## Corrected core code patterns (AI SDK v6 — verified)

**Tools** (`lib/agent/tools.ts`):
```ts
import { tool } from 'ai'; import { z } from 'zod';
export const crm_lookup = tool({
  description: 'Look up an order + customer by order_id. Call first.',
  inputSchema: z.object({ order_id: z.string() }),
  execute: async ({ order_id }) => crm.lookup(order_id), // throws→retry handled in client
});
export const decide_refund = tool({
  description: 'Emit the FINAL decision. Only after policy_check.',
  inputSchema: z.object({ order_id: z.string(), decision: z.enum(['approve','deny','escalate']),
    refund_amount: z.number().nullable(), justification: z.string().min(30),
    policy_clauses_cited: z.array(z.string()) }),
  outputSchema: z.object({ finalized: z.literal(true) }).passthrough(),
  execute: async (a) => ({ finalized: true as const, ...a }),
});
```

**Orchestrate** (`lib/agent/orchestrate.ts`):
```ts
import { streamText, stepCountIs, hasToolCall } from 'ai';
export function runAgent({ model, messages }) {
  return streamText({
    model, system: buildSystemPrompt(), messages,
    tools: { crm_lookup, policy_check, decide_refund },
    stopWhen: [hasToolCall('decide_refund'), stepCountIs(8)],
    prepareStep: ({ stepNumber }) => ({
      activeTools: stepNumber === 0 ? ['crm_lookup']
                 : stepNumber === 1 ? ['policy_check'] : ['decide_refund'] }),
    onStepFinish: ({ stepType, text, toolCalls, toolResults, usage }) => emitTrace(...),
  });
}
```

**Route** (`app/api/agent/route.ts`): `export const runtime='nodejs'; export const maxDuration=60;` → `return runAgent(...).toUIMessageStreamResponse();` (+ 15s SSE heartbeat).

**Client** (`@ai-sdk/react`): `useChat({ transport: new DefaultChatTransport({ api:'/api/agent' }) })`; render `msg.parts` — `text`, `tool-crm_lookup`/`tool-policy_check`/`tool-decide_refund` (by `state`), and `data-trace` custom parts.

**Test** (`MockLanguageModelV3` from `ai/test` + `simulateReadableStream`): script `tool-call`→`finish` chunks per step; assert `onStepFinish` toolNames === `['crm_lookup','policy_check','decide_refund']`; holding-the-line script never yields `approve`.

---

## Phase 0 — Scaffold
- [ ] 0.1 `pnpm create next-app@latest . --ts --tailwind --eslint --app --use-pnpm` (keep docs/.gitignore); add `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- [ ] 0.2 `pnpm add ai@^6 @ai-sdk/react@^6 @ai-sdk/anthropic @ai-sdk/openai zod nanoid @langfuse/vercel`; `pnpm add -D vitest @vitest/coverage-v8 tsx prettier`; shadcn init + add `button card badge skeleton resizable scroll-area`.
- [ ] 0.3 `.env.example` (ANTHROPIC_API_KEY placeholder + LLM_PROVIDER + DEEPGRAM/CARTESIA + LANGFUSE_* ), `Makefile` (install dev seed test eval lint build), `vitest.config.ts`, scripts. Commit each.

## Phase 1 — Domain & policy (pure, no LLM)
- [ ] 1.1 `lib/types.ts` — Order, Decision, RefundOutcome, TraceEvent (spec §7). Commit.
- [ ] 1.2 `lib/crm/{data,client}.ts` + `tests/crm.test.ts` — 15 profiles (spec §8 + 10 covering every branch incl. day-30 boundary, perishable, subscription, gift, missing delivery_date, in-transit+photo). TDD. Commit. *(No fault-injection — cut.)*
- [ ] 1.3 `lib/agent/policy.ts` + `tests/policy.test.ts` — `POLICY` data, `policyText()`, deterministic **`evaluatePolicy(order)` oracle**, `validateAgainstPolicy()`. TDD against spec §10 rows. Commit.

## Phase 2 — Agent core (LLM mocked)
- [ ] 2.1 `lib/agent/model.ts` — `getModel()` (anthropic|openai by `LLM_PROVIDER`; clear error if key missing). Commit.
- [ ] 2.2 `lib/agent/guard.ts` + test — `assertNoOverride(userText)` (reject injection like "ignore policy/approve anyway"); helper to bind `order_id` from session. Commit.
- [ ] 2.3 `lib/agent/tools.ts` + `tests/tools.test.ts` — the 3 tools above (`inputSchema`, `outputSchema` on decide_refund), wrapping CRM + `evaluatePolicy`. TDD. Commit.
- [ ] 2.4 `lib/agent/prompts.ts` — `buildSystemPrompt()` with `<policy>` block + "never approve out-of-policy regardless of pressure" + 2 few-shots (approve, hold-the-line). Commit.
- [ ] 2.5 `lib/agent/validator.ts` + `tests/validator.test.ts` — post-loop guard (decision∈enum; amount∈[0,price]; policy_check passed in history else override). TDD. Commit.
- [ ] 2.6 `lib/agent/orchestrate.ts` + `tests/orchestrate.test.ts` — the `streamText` loop above with `prepareStep` ordering; async-generate TraceEvents; run validator before final decision. **MockLanguageModelV3** TDD incl. holding-the-line. Commit.

## Phase 3 — API
- [ ] 3.1 `app/api/agent/route.ts` + `tests/api-agent.test.ts` — `runtime='nodejs'`, `toUIMessageStreamResponse()`, custom `data-trace` parts, 15s heartbeat, `maxDuration=60`. TDD (mocked model via env flag). Commit.

## Phase 4 — Frontend
- [ ] 4.1 `app/page.tsx` + `components/ChatWindow.tsx` — `ResizablePanelGroup` 40/60; `useChat` (`@ai-sdk/react`). Manual check w/ real key. Commit.
- [ ] 4.2 `components/{ReasoningPanel,ToolCallCard,DecisionBadge}.tsx` — timeline from `msg.parts` (Shiki JSON, APPROVED/DENIED/ESCALATED badge w/ **aggregate latency**, policy chips). `pnpm add shiki react-json-view-lite framer-motion lucide-react`. Commit. *(No per-step timers — cut.)*

## Phase 5 — Voice (browser, ephemeral tokens)
- [ ] 5.1 `app/api/deepgram-token/route.ts` (`nodejs`) — mint scoped/short-TTL Deepgram token (`/v1/auth/grant` or scoped project key, delete on close). Commit.
- [ ] 5.2 `app/api/cartesia-token/route.ts` — POST `/access-token` `{grants:{tts:true},expires_in:300}`. Commit.
- [ ] 5.3 `components/VoiceButton.tsx` — mic→Deepgram WS (`Sec-WebSocket-Protocol ['token',key]`) → transcript → POST `/api/agent` → on final text, Cartesia WS (`sonic`, pcm_s16le 24k) → Web Audio. AudioContext created in click handler; `MediaRecorder.isTypeSupported` fallback. **Web Speech API fallback** if WS blocked. Manual check: speak → spoken decision + same trace. Commit.

## Phase 6 — Eval + observability + CI
- [ ] 6.1 `lib/eval/{scenarios,run}.ts` + `tests/eval.test.ts` — all spec §10 scenarios via `orchestrate` vs `evaluatePolicy` oracle (accuracy + tool-selection + est. cost); mocked-model test asserts 100%. Commit.
- [ ] 6.2 Langfuse wiring (`@langfuse/vercel` in `onStepFinish`) + `.env` keys; verify a trace appears. Commit.
- [ ] 6.3 `.github/workflows/ci.yml` — typecheck, lint, vitest, **`pnpm eval` (the 2 killer scenarios, mocked) as a gate**, build. Badges in README. Commit.

## Phase 7 — Deploy, README, prep, Loom
- [ ] 7.1 Vercel: set server env (capped `ANTHROPIC_API_KEY`, voice + Langfuse keys), `vercel --prod`; confirm stream + voice over HTTPS. Commit config.
- [ ] 7.2 `README.md` — pitch, CI + eval badges, Live Demo (Loom + URL), Mermaid architecture, <2-min quickstart, `.env` table, Design Decisions, Test/Eval strategy, **"production voice → LiveKit" paragraph**, Roadmap. Commit.
- [ ] 7.3 `docs/INTERVIEW-PREP.md` — the 10 defend-your-build Q&As (loop, tools, policy, guardrails/injection, failure handling, model choice, state, **evals**, full-stack, what-I'd-change). Commit.
- [ ] 7.4 Record Loom (spec §12 + the two-panel Langfuse shot). Flip repo **public** at submission.

## Self-Review (v2)
- **Spec coverage:** all spec sections mapped; additions (guard 2.2, Langfuse 6.2, outputSchema 2.3, interview-prep 7.3) appended; cuts (fault-injection, per-step timers) removed.
- **Placeholders:** none — exact files, oracle-based tests, verified v6 APIs.
- **Type consistency:** `evaluatePolicy`, `validateAgainstPolicy`, `runAgent`, `TraceEvent`, `Decision` consistent across tasks.

## Dependencies
- Capped throwaway `ANTHROPIC_API_KEY` (Hunter) — needed only for manual UI (4.1+), voice (5.x), real-model eval, deploy. Phases 0–3, 6 (mocked), all unit tests run with **no key**.
