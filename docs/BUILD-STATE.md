# 🟢 BUILD STATE / RESUME HANDOFF — Refund Agent

> **Purpose:** precise saving point so a fresh session (or Hunter) can resume this build with zero re-derivation. Written 2026-06-14. Companion to `docs/HANDOFF.md` (original kickoff) and `docs/plans/2026-06-14-refund-agent-plan.md` (the v3 plan being executed).

## TL;DR
- **Phases 1–5 are COMPLETE, committed, and pushed to `origin/main`** (`HunterSpence/refund-agent`, private).
- **247/247 Vitest tests pass · `tsc --noEmit` clean · `pnpm build` succeeds.**
- **Remaining: Phase 6 (voice), Phase 7 (docs/deploy/2nd-config/observability), then the end-game QA loop (below).**
- Build executed via **superpowers:subagent-driven-development** — one sonnet implementer per task, strict TDD, controller verifies (`pnpm test:run`+`typecheck`) + reads each file. Implementers run **sequentially** (concurrent `git add/commit` to one repo races the index).

## Repo facts (don't re-discover)
- Local: `C:\Users\hspen\refund-agent`. Branch `main`. Remote `HunterSpence/refund-agent` (**PRIVATE** until submission).
- Commit identity already set locally: **Hunter Spence <hspence21190@gmail.com>, NO AI co-author trailer** (portfolio piece). Just `git commit` — never `--author`, never `Co-Authored-By`.
- **`.env.local` is gitignored** and holds the **capped ~$5 throwaway `ANTHROPIC_API_KEY`** + `LLM_PROVIDER=anthropic` (verified live earlier). Never print/commit it. Vaulted as `REFUND_AGENT_ANTHROPIC_KEY`. Revoke after Loopp review.
- Deepgram/Cartesia/Langfuse keys are **NOT** present locally (commented placeholders only) → voice uses the keyless Web Speech path; Langfuse is env-gated.
- Stack: **Next.js 16.2.9** (App Router, Turbopack), React 19.2.4, **Tailwind v4** (CSS `@theme`, no tailwind.config.js), TS strict, **AI SDK v6** (`ai@6.0.205`, `@ai-sdk/anthropic@3.0.84`, `@ai-sdk/openai@3.0.71`, `@ai-sdk/react@3.0.207`), `zod@4.4.3`, Vitest 4.1.8, pnpm.

## Commands
```
pnpm test:run    # 247 tests (unit + deterministic eval gate)
pnpm typecheck   # tsc --noEmit (strict) — must be 0
pnpm build       # next build (prod) — must succeed
pnpm eval        # runs the deterministic eval gate (tests/eval.test.ts)
pnpm dev         # local dev server at http://localhost:3000  (UI at /, eval at /eval)
# LIVE keyed eval (NOT in CI; needs the key):
RUN_LIVE_EVAL=1 pnpm vitest run tests/eval.live.test.ts   # regenerates lib/eval/results.json (mode:live)
```

## What's DONE (commit SHAs)
| Phase | What | Commit |
|---|---|---|
| scaffold | Next 16 + Vitest + AI SDK v6 + Zod, `.gitattributes` (LF) | `d337643`, `57f5620` |
| 1.1 | `lib/types.ts` — Order, Decision, ConfidenceDecision, RefundOutcome, TraceEvent (+`photo_evidence`) | `96c0794`, `c67975b` |
| 1.2 | `lib/crm/{data,adapter,client}.ts` — 15-profile seed (C001–C015), `SWAP_ME` adapter, 25 integrity tests | `166f567` |
| 1.3 | `lib/agent/policy.ts` — deterministic `evaluatePolicy()` oracle + pure `applyRefundPolicy()` executor (52 tests) | `e6b2a23` |
| 1.4 | `lib/agent/guard.ts` — `sanitizeInput()` injection middleware + `validateToolArgs()` (66 tests) | `c6b78c7` |
| 2.1/2.2 | `lib/agent/{model,prompts,tools}.ts` — provider select, system prompt, 3 Zod tools via per-run session factory | `9cc6ad5` |
| 2.3/2.4 | `lib/agent/orchestrate.ts` — hard-sequenced loop (`prepareStep`+`activeTools`+`toolChoice`), trace emission, multi-turn hold-the-line | `328f27c` |
| 3.1 | `app/api/agent/route.ts` — `runtime='nodejs'`, `sanitizeInput` pre-loop short-circuit, `createUIMessageStream`+`writer.merge`+`data-trace`, `buildAgentStream(messages, model?)` testable seam | `83caa0c` |
| 4 | UI — `app/page.tsx` (useChat + scenario picker), `components/{ChatWindow,ReasoningPanel,ApprovalCard,DecisionBadge}.tsx`, dark premium dashboard | `5c0bc08` |
| 5 | Eval — `lib/eval/{golden,run,run-live}.ts`, `results.json`, `tests/eval.test.ts`, `app/eval/page.tsx`, `.github/workflows/ci.yml`, `scripts/generate-results.ts` | `f3afa20` |

### Eval headline (deterministic, committed `lib/eval/results.json`)
**23 scenarios — 23/23 passed · decision accuracy 100% · 0 policy violations · pass³=100% · guard precision 100%** (3 adversarial cases overridden = the held line). 8 attack vectors covered: direct/indirect injection, roleplay, legal threat, authority claim, day-31 gaming, negative-amount, conflicting-data.

## The SPINE (what makes this top-1% — preserve)
1. **LLM decides intent → pure `applyRefundPolicy()` computes the money.** The oracle is authoritative; the model's `proposed_amount` is ignored; `overridden` flags blocked over-approvals → **un-jailbreakable** (proven by the held-line tests + evals). Write this as the README ADR.
2. **Holds the line + multi-turn negotiation** — pushback/threats/authority don't flip a correct decision (prompt + deterministic oracle).
3. **Adversarial eval harness** — golden set + 8 attacks, pass³, CI-gated, `/eval` page.
4. **Guardrails** — injection guard as PRE-LOOP middleware (route), strict Zod tool schemas, `validateToolArgs`, hard tool sequencing.
5. **Production wows** — live reasoning dashboard, HITL Approval Card (>$500), confidence + auto-escalation, `/eval` page.

## ⚠️ AI SDK v6.0.205 gotchas (verified in-build — needed to resume)
- `tool({ inputSchema })` NOT `parameters`. `stopWhen:[hasToolCall('decide_refund'), stepCountIs(8)]`. Tool order via `prepareStep` → `{ activeTools: Array<keyof typeof tools>, toolChoice:{type:'tool',toolName} }`.
- Route: `createUIMessageStream({execute:({writer})=>{...}})` + `writer.merge(result.toUIMessageStream())` + `writer.write({type:'data-trace', data})`; wrap `createUIMessageStreamResponse({stream})`. **`runtime='nodejs'`** (not edge).
- Custom data parts typed via `UIMessage<unknown, { trace: TraceEvent }>` → parts surface as `{type:'data-trace', data}`. Manual text: `text-start`/`text-delta {id,delta}`/`text-end`.
- Client: `useChat` from `@ai-sdk/react`; `DefaultChatTransport` from `ai`; `sendMessage({text})`; `status ∈ submitted|streaming|ready|error`.
- `convertToModelMessages` is **async** → orchestrate uses a sync `flatMap` over `UIMessage.parts` instead.
- Tests: `MockLanguageModelV3` + `simulateReadableStream` from `ai/test`; **`doStream` array is effectively 1-indexed** (prepend a placeholder); stream-part `type` fields need `as const`; chunk shape `{type:'tool-call', toolCallId, toolName, input: JSON.stringify(args)}`.
- `@ai-sdk/provider` not top-level importable → derive model type as `ReturnType<typeof anthropic>|ReturnType<typeof openai>`.

## ▶️ REMAINING WORK (resume here)

### Phase 6 — Voice (secondary, de-risked) [task]
- `components/VoiceButton.tsx`: **Web Speech API is the working default** (browser `SpeechRecognition` STT → `sendMessage({text})` to the SAME `/api/agent` → speak the latest assistant text via `speechSynthesis`). No vendor keys needed for the demo. Integrate into `app/page.tsx` (mic toggle).
- `app/api/deepgram-token/route.ts` + `app/api/cartesia-token/route.ts`: ephemeral server-minted tokens (keys never client-side); return a clear 501/"not configured" when keys absent. Documented as the production upgrade.
- Keep it from eating time — Web Speech path is enough; note VantaWeb prod voice as the Loom backup.

### Phase 7 — Observability, deploy, docs [task]
- **2nd retailer `POLICY` config** (e.g., `POLICY_RETAILER_B`: 14-day window, 25% restocking, no VIP waiver) + a test showing `evaluatePolicy(order, POLICY_RETAILER_B)` differs — proves the **client-configurable primitive** in one file. (High signal — don't skip.)
- **Langfuse** via AI SDK `experimental_telemetry` in `orchestrate`, **gated on `LANGFUSE_*` env** (no-op when absent). Note `npx @ai-sdk/devtools` for the live interview walkthrough.
- **`.env.example`** (placeholders only: ANTHROPIC_API_KEY, LLM_PROVIDER, optional DEEPGRAM/CARTESIA/LANGFUSE).
- **`README.md`** — REPOSITIONED: lead with the production-deliverable story (Loopp is a services studio), CI + eval badges, Loom + live-URL placeholders, **Mermaid** architecture diagram, **ADR: LLM-decides/code-executes**, the **2nd-policy-config demo**, quickstart, "voice = LiveKit in prod" note, `SWAP_ME` CRM adapter callout.
- **`docs/INTERVIEW-PREP.md`** — 10 defend-your-build Q&As (agent loop, tool schemas, policy enforcement, guardrails/injection, failure handling, model choice, state/context, **evals**, full-stack boundary, what-I'd-change).
- **Deploy prep**: "Deploy to Vercel" button + env-var docs in README. (Actual deploy = Hunter; needs Vercel login.)

### END-GAME QA LOOP (Hunter's explicit request 2026-06-14)
1. **Finish 6 + 7.**
2. **Verify everything works:** full `pnpm test:run` + `typecheck` + `pnpm build`; **run the LIVE keyed eval** (`RUN_LIVE_EVAL=1 ...`) to regenerate `results.json` (mode:live) and prove the real model; **live keyed agent smoke** (one real `/api/agent` decision); **visual check** of `/` dashboard + `/eval` (dev server + browser/screenshot).
3. **Dispatch 3 sonnet review subagents IN PARALLEL** (read-only, no commits → safe to parallelize). Suggested split: (a) spec/plan/handoff coverage + the spine; (b) code quality + AI SDK v6 correctness + tests/eval rigor; (c) UI/UX + security/guardrails + "would I hand this to a client?". Each returns findings ranked by severity.
4. **Opus plan** synthesizing all findings into a prioritized fix/improve plan.
5. **Opus implements** the fixes (sequential or one comprehensive Opus pass — model:"opus").
6. **Re-verify** (tests/typecheck/build/eval) and report.

## Left for Hunter (cannot be automated)
- Authorize the **Vercel deploy** (interactive login) + set `ANTHROPIC_API_KEY` server env.
- Record the **Loom** (outline will be in README/INTERVIEW-PREP; demo: standard refund → held-line/negotiation → guardrail/injection → code tour → `make test`/eval green → voice).
- Flip the repo **public** at submission. Revoke the capped key after review.

## Progress tracker
Controller TodoWrite/Task list mirrors the plan: tasks 1–12 done; tasks 13 (voice) + 14 (docs/deploy) pending; end-game QA loop appended above.
