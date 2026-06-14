# Refund Agent — Implementation Plan (v3)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** A **production-grade, eval-verified** e-commerce refund agent a services studio would hand to a client: it auto-resolves refunds via tool-calling, **holds the line under pressure**, **negotiates multi-turn**, escalates low-confidence cases to a human, and proves it works with an adversarial eval harness. One agent core, chat + (secondary) voice. Built to be **defended live in a 30-min code walkthrough.**

**Architecture:** Next.js 15 + AI SDK v6. **LLM decides intent; deterministic code executes the money** — the model emits a Zod-validated decision, then a pure `applyRefundPolicy()` (no LLM) computes the refund. Hard-sequenced tools (`prepareStep`+`activeTools`+`toolChoice`), policy-as-code oracle, bespoke guardrails (injection middleware + output schema + arg validator), live reasoning dashboard, eval harness with trajectory-diffs + `pass^3`.

**Tech Stack:** Next.js 15, TS strict, `ai@^6` + `@ai-sdk/react@^6` + `@ai-sdk/anthropic` (swappable), Zod, Tailwind + shadcn/ui (+ `assistant-ui` Approval Card), `@deepgram/sdk` v3 + `@cartesia/cartesia-js` v3 (voice, ephemeral tokens), Langfuse (hosted free) + `@ai-sdk/devtools`, Vitest (`MockLanguageModelV3`), GitHub Actions, pnpm.

---

## v3 changes (from the 8-agent Opus review)

**REPOSITION (Loopp is a services studio — "would I hand this to a client?"):**
- README/Loom **lead with the production-deliverable story**, not the tech stack.
- **Policy-as-code = a client-configurable primitive** → ship a 2nd policy config (different retailer) that "just works" (10 min, huge "reusable systems" signal).
- **Eval harness + tracing = the headline quality gate**, tied to a number: "12+ scenarios, 0 policy violations, pass³=100%."
- Add one line: "mirrors patterns from a production voice-AI system I run."

**ADD (high signal):**
- **Multi-turn NEGOTIATION** — customer pushes back → agent re-checks policy → holds the line / offers partial / escalates. **The memorable centerpiece.**
- **Confidence score (0–1) + auto-escalation UX** — <0.65 → "Escalating to human" with context handoff; badge on every decision.
- **Human-in-the-loop Approval Card** (`needsApproval` on `decide_refund` when amount > threshold) via `assistant-ui` — tangible production-readiness.
- **LLM-decides / code-executes:** `decide_refund` gets Zod `{decision, reason, confidence, proposed_amount}` → pure `applyRefundPolicy(parsed, order)` does the math → 100% unit-testable. Write it as an ADR.
- **Injection guard as pre-loop MIDDLEWARE** (regex → `escalate`, no LLM, log to Langfuse) — not a prompt instruction.
- **Eval: trajectory-diff on failure + `pass^3`** on adversarial cases; **`/eval` results page in the UI** + README badge.
- **One-click Deploy button** + a `// SWAP_ME` CRM adapter marker.
- **`npx @ai-sdk/devtools`** wired in dev for the *live interview* walkthrough (zero-setup local trace UI).

**VOICE — reconciled verdict:** **KEEP it, de-risked, SECONDARY.** Loopp lists voice as 1 of 5 verticals (not voice-first), so it's a breadth signal, not the centerpiece. Browser Deepgram→core→Cartesia with a **Web Speech fallback**; if it's flaky on Loom day, show VantaWeb's real prod voice as the backup clip. Build it **only after** the core + negotiation + evals are solid (Day 4).

**CUT/DEFER:** CRM fault-injection retry; per-step UI timers; self-hosted Langfuse (use hosted free + traceId link); heavy CI matrix. Keep `docs/INTERVIEW-PREP.md` but short.

---

## Core patterns (verified)

**Hard tool sequencing** (`lib/agent/orchestrate.ts`):
```ts
streamText({ model, system, messages, tools: { crm_lookup, policy_check, decide_refund },
  stopWhen: [hasToolCall('decide_refund'), stepCountIs(8)],
  prepareStep: ({ stepNumber }) => stepNumber === 0 ? { activeTools:['crm_lookup'], toolChoice:{type:'tool',toolName:'crm_lookup'} }
    : stepNumber === 1 ? { activeTools:['policy_check'], toolChoice:{type:'tool',toolName:'policy_check'} }
    : { activeTools:['decide_refund'] },
  onStepFinish: ({ stepType, text, toolCalls, toolResults, usage }) => emitTrace(...) });
```

**LLM decides / code executes** (`lib/agent/policy.ts` + `tools.ts`):
```ts
const decide_refund = tool({
  inputSchema: z.object({ decision: z.enum(['approve','deny','escalate']),
    reason: z.string().min(20), confidence: z.number().min(0).max(1), proposed_amount: z.number().nullable() }),
  execute: async (parsed) => applyRefundPolicy(parsed, currentOrder), // PURE, no LLM → final amount + audit
});
// applyRefundPolicy = deterministic: validates against evaluatePolicy() oracle, computes restocking fee, caps amount∈[0,price], forces escalate if confidence<0.65 or out-of-policy.
```

**Injection middleware** (`lib/agent/guard.ts`): regex `[/ignore (previous|all) instructions/i, /you are now/i, /system prompt/i, /override.*refund/i, ...]` → if match: skip LLM, `escalate`, log `injection_blocked`.

---

## Phased plan (4 days)

### Phase 1 — Domain, policy, guard (pure, keyless) — Day 1
- [ ] 1.1 `lib/types.ts` (Order, Decision, RefundOutcome, ConfidenceDecision, TraceEvent). Commit.
- [ ] 1.2 `lib/crm/{data,client,adapter}.ts` + test — 15 profiles (every policy branch incl. day-30/31 boundary), `// SWAP_ME` adapter interface. TDD. Commit.
- [ ] 1.3 `lib/agent/policy.ts` + test — `POLICY`, `policyText()`, deterministic **`evaluatePolicy(order)` oracle**, pure **`applyRefundPolicy(parsed, order)`** (fees, caps, confidence<0.65→escalate, out-of-policy→escalate). TDD vs scenario table. Commit.
- [ ] 1.4 `lib/agent/guard.ts` + test — `sanitizeInput()` injection middleware + `validateToolArgs()`. TDD. Commit.

### Phase 2 — Agent core (mocked LLM, keyless) — Day 1–2
- [ ] 2.1 `lib/agent/model.ts` (provider select). `lib/agent/prompts.ts` (policy block, "never approve out-of-policy", few-shots, **negotiation behavior**). Commit.
- [ ] 2.2 `lib/agent/tools.ts` + test — 3 tools w/ `inputSchema`; `decide_refund.execute → applyRefundPolicy`. TDD. Commit.
- [ ] 2.3 `lib/agent/orchestrate.ts` + test — hard-sequenced loop (above), emits TraceEvents; **MockLanguageModelV3** asserts **tool ORDER** + holding-the-line never approves. Commit.
- [ ] 2.4 Negotiation: multi-turn handling in orchestrate (pushback → re-evaluate → hold/partial/escalate) + test. Commit.

### Phase 3 — API — Day 2
- [ ] 3.1 `app/api/agent/route.ts` (`runtime='nodejs'`, `sanitizeInput` first, `toUIMessageStreamResponse()`, `data-trace` parts, heartbeat) + test. Commit.

### Phase 4 — Frontend — Day 3
- [ ] 4.1 `app/page.tsx` + `ChatWindow` (split view, `useChat`). Commit.
- [ ] 4.2 `ReasoningPanel` — timeline from `msg.parts` w/ **role badges [LOOKUP]/[POLICY]/[DECISION]**, decision badge + **confidence score**, policy chips, Shiki JSON. Commit.
- [ ] 4.3 **Approval Card** (`assistant-ui`) on `decide_refund` when amount>threshold; escalation UX. Commit.
- [ ] 4.4 `/eval` results page (renders the eval JSON: table + pass³ + badges). Commit.

### Phase 5 — Eval + guardrails + CI — Day 3
- [ ] 5.1 `lib/eval/{golden,run}.ts` + `tests/eval.test.ts` — golden set ~24 cases (incl. the **8 adversarial**: direct/indirect injection, legal threat, authority claim, day-31 gaming, negative-amount, roleplay, conflicting-data) vs `evaluatePolicy` oracle; metrics: tool-selection, trajectory τ, decision accuracy, **pass³**; **trajectory-diff on failure**. Commit.
- [ ] 5.2 `.github/workflows/ci.yml` — typecheck, lint, vitest, **eval gate** (decision + tool-selection = 100%, pass³ on adversarial), build. Badge `eval: N/N ✓ pass³=100%`. Commit.

### Phase 6 — Voice (secondary, de-risked) — Day 4
- [ ] 6.1 `app/api/{deepgram,cartesia}-token` (ephemeral). `VoiceButton` (mic→Deepgram WS→same `/api/agent`→Cartesia WS→Web Audio; AudioContext in click; **Web Speech fallback**). Commit. *(Skip if Day-4 is tight; VantaWeb prod voice = Loom backup.)*

### Phase 7 — Observability, deploy, docs, Loom — Day 4
- [ ] 7.1 Langfuse (hosted free) in `onStepFinish` (traceId link) + `@ai-sdk/devtools` in dev. Commit.
- [ ] 7.2 Vercel deploy (server-side capped key) + **Deploy button** in README. Commit.
- [ ] 7.3 `README.md` (production-deliverable lead, CI+eval badges, Loom+URL, Mermaid, **ADR: LLM-decides/code-executes**, **2nd policy config demo**, quickstart, "voice = LiveKit in prod" note) + `docs/INTERVIEW-PREP.md` (10 defend-your-build Q&As). Commit.
- [ ] 7.4 Loom (the **trajectory-diff clip** + negotiation + Approval Card; voice optional). Flip repo **public** at submission.

## Dependencies
- Capped throwaway `ANTHROPIC_API_KEY` (Hunter) — only for manual UI (4.x), voice (6), real-model eval, deploy. Phases 1–3, 5 (mocked), all unit tests run **keyless**.

## Self-Review (v3)
- Spec coverage: all required items + the 8-agent additions mapped to tasks; voice de-risked + sequenced last; cuts removed.
- The spine = hold-the-line + LLM-decides/code-executes + adversarial eval w/ trajectory-diff + pass³. Everything else supports it.
