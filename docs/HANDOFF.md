# 🚀 BUILD HANDOFF — Refund Agent (Loopp/Foundersmax take-home)

> **Read this first.** This is a self-contained kickoff for a fresh session to BUILD this project. Everything you need is here or linked. Builder = Hunter Spence (senior eng, runs VantaWeb — a production voice-AI product on LiveKit/Deepgram/Cartesia).

## 0. Mission (one paragraph)
Build a **production-grade e-commerce refund agent** for an AI-Engineer take-home at **Loopp** (an AI *build studio* — they ship agents/voice/chatbots for enterprise clients; this is a competence screen, **not** product theft). The agent approves/denies/escalates refunds via tool-calling, **holds the line under pressure**, **negotiates multi-turn**, escalates low-confidence cases to a human, and **proves it works with an adversarial eval harness**. Deliverable: public GitHub repo + 7–10 min Loom. Pass → a **30-min code-walkthrough interview** (they WILL quiz you on every decision; "Claude suggested it" = fail). **Deadline ~2026-06-18.** Remote, $150–225K + equity.

## 1. Repo + docs (already set up)
- **GitHub:** `HunterSpence/refund-agent` — **PRIVATE** (flip to public only at submission). Local: `C:\Users\hspen\refund-agent`, on `main`.
- **Commits as Hunter Spence <hspence21190@gmail.com>, NO AI co-author trailer** (it's his portfolio). Git identity already set local in the repo.
- **Spec:** `docs/specs/2026-06-14-refund-agent-design.md` (what/why).
- **Plan (BUILD FROM THIS):** `docs/plans/2026-06-14-refund-agent-plan.md` — **v3**, the task-by-task TDD plan. Execute it top-to-bottom.
- KB note (workspace): `memory/kb/projects/loopp-refund-agent-takehome-2026-06-14.md`.

## 2. The spine (what makes this top-1% — don't lose it)
Validated by 13 research agents. The differentiators, in priority:
1. **LLM decides, deterministic code executes.** `decide_refund` gets a Zod-validated `{decision, reason, confidence, proposed_amount}` from the model → a **pure `applyRefundPolicy(parsed, order)` (NO LLM)** computes the final amount/fees/caps. 100% unit-testable. (Write this as an ADR in the README — interviewers cite this exact senior-vs-junior line.)
2. **Holds the line + multi-turn NEGOTIATION** — customer pushes back → agent re-checks policy → holds / offers partial / escalates. The memorable demo moment.
3. **Adversarial eval harness** — golden set incl. 8 attack cases (injection, social-engineering, day-31 gaming, etc.), **trajectory-diff on failure**, **`pass^3`** (run each 3×, all must match), CI-gated, README badge. *Evals are the #1 rejection point — this is the headline.*
4. **Guardrails:** injection guard as **pre-loop middleware** (regex→escalate, log it), strict **`Output`/Zod schema** on the decision, tool-arg validator. Hard tool sequencing via `prepareStep`+`activeTools`+`toolChoice`.
5. **Production-readiness wows:** human-in-the-loop **Approval Card** (`needsApproval` on big refunds), **confidence score + auto-escalation UX**, a **`/eval` results page**, a **one-click Deploy button** + `// SWAP_ME` CRM adapter.

## 3. Positioning (Loopp is a SERVICES studio → "would I hand this to a client?")
- README/Loom **lead with the production-deliverable story, not the tech stack.**
- **Policy-as-code = a client-configurable primitive** → ship a 2nd policy config (different retailer) that "just works" (cheap, huge "reusable systems" signal).
- **Eval + tracing = the quality gate**, tied to a number ("12+ scenarios, 0 violations, pass³=100%").
- One line: "mirrors patterns from a production voice-AI system I run."

## 4. Voice — KEEP but SECONDARY + de-risked
Loopp lists voice as 1 of 5 verticals (not voice-first), so it's a **breadth signal, not the centerpiece.** Build it **last (Day 4), only after the core is solid.** Browser mic → Deepgram STT → the SAME `/api/agent` → Cartesia TTS, **ephemeral tokens** (keys never client-side), **Web Speech API fallback**. If flaky on Loom day, show **VantaWeb's real prod voice** as the backup clip. Don't let voice eat the deadline.

## 5. Stack + ⚠️ AI SDK v6 gotchas (v4/v5 syntax BREAKS — verified)
Next.js 15, TS strict, **`ai@^6` + `@ai-sdk/react@^6` + `@ai-sdk/anthropic`** (swappable `@ai-sdk/openai`), Zod, Tailwind + shadcn/ui (+ `assistant-ui` Approval Card), `@deepgram/sdk` v3 + `@cartesia/cartesia-js` v3, Langfuse (hosted free) + `@ai-sdk/devtools`, Vitest, pnpm.
- `tool({ inputSchema })` NOT `parameters`. `stopWhen:[hasToolCall('decide_refund'), stepCountIs(8)]` NOT `maxSteps`. Tool order via `prepareStep`→`activeTools`(+`toolChoice`). Route → `toUIMessageStreamResponse()` NOT `toDataStreamResponse()`, **`runtime='nodejs'` NOT edge**. Client `message.parts[]`; tool parts `type:'tool-{name}'` w/ `state`. Tests: `MockLanguageModelV3` from `ai/test` + `simulateReadableStream` (assert tool ORDER). `useChat` from `@ai-sdk/react`.

## 6. Credentials (NEVER commit — `.env.local` is gitignored)
- **`ANTHROPIC_API_KEY` — ✅ ALREADY IN PLACE & VERIFIED LIVE (2026-06-14, HTTP 200).** A capped ~$5 throwaway TEST key sits in `C:\Users\hspen\refund-agent\.env.local` (gitignored) with `LLM_PROVIDER=anthropic`, and is vaulted (`~/.env.secrets` → `REFUND_AGENT_ANTHROPIC_KEY`, masked in `~/.secrets/INDEX.md`). **Don't print it; don't commit it; revoke after Loopp review.** For Vercel deploy, set it as a server-side env var. `.env.example` (created during scaffold) carries only a placeholder; reviewers use their own key. Phases 1–3 + mocked 5 + all unit tests also run KEYLESS.
- Deepgram + Cartesia keys: Hunter has them (VantaWeb prod) — only for Phase 6 voice.
- Langfuse: hosted free-tier keys.

## 7. Build order (from plan v3)
Day 1: Phase 1 (types, CRM 15-profile mock + `SWAP_ME` adapter, `policy.ts` oracle + pure `applyRefundPolicy`, injection guard) + start Phase 2 (tools, hard-sequenced orchestrate) — **all keyless, TDD**.
Day 2: finish Phase 2 (negotiation) + Phase 3 (API route).
Day 3: Phase 4 (chat + reasoning dashboard w/ role badges + Approval Card + confidence) + Phase 5 (eval harness w/ 8 adversarial + trajectory-diff + pass³ + CI badge + `/eval` page).
Day 4: Phase 6 (voice, de-risked) + Phase 7 (Langfuse + devtools + Vercel deploy + Deploy button + repositioned README + ADR + 2nd policy config + INTERVIEW-PREP.md + record Loom). Flip repo public at submission.

## 8. How to execute (recommended)
- Use **superpowers:subagent-driven-development** — one fresh subagent per plan task, review between tasks, TDD (write failing test → run → implement → pass → commit). Frequent small commits.
- First commands: `cd C:\Users\hspen\refund-agent` → `pnpm create next-app@latest . --ts --tailwind --eslint --app --use-pnpm` (keep `docs/`, `.gitignore`) → install deps (§5) → start Phase 1.1.
- After each phase: `pnpm vitest run` green, commit, push.

## 9. Interview-prep (build to DEFEND)
Every file must be explainable. Ship `docs/INTERVIEW-PREP.md` answering the 10 questions they'll ask: agent loop, tool schemas, policy enforcement, guardrails/injection, failure handling, model choice, state/context, **evals (the #1 rejection point)**, full-stack boundary, what-you'd-change. For the live walkthrough, run `npx @ai-sdk/devtools` to show each step's I/O.

---
**START HERE:** open `docs/plans/2026-06-14-refund-agent-plan.md`, confirm Hunter has dropped a capped `ANTHROPIC_API_KEY` (or proceed keyless through Phase 3 + mocked Phase 5), and begin Phase 1.1.
