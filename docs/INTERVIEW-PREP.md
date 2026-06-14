# Interview Prep: Defend the Build

Ten questions I expect in a technical walkthrough of this codebase, with honest answers grounded in the code.

---

**1. Walk me through the agent loop. Why is the tool sequence hard-coded instead of letting the model decide?**

The loop in `lib/agent/orchestrate.ts` calls `streamText` with a `prepareStep` callback that returns a different `activeTools` array and `toolChoice` constraint for each step number. Step 0 allows only `crm_lookup`; step 1 allows only `policy_check`; step 2+ allows only `decide_refund`. `stopWhen: [hasToolCall("decide_refund"), stepCountIs(8)]` terminates once the decision fires or after 8 steps as a circuit-breaker.

The reason this is hard-coded: if the model chose tool order freely, an adversarial prompt could skip `crm_lookup` (bypassing the order data entirely) or call `decide_refund` directly with invented inputs. The eval harness confirms the sequence holds across all 23 scenarios. Letting the model choose order would make the three-step guarantee unprovable at CI time.

---

**2. How do the Zod tool schemas prevent bad inputs? What's validateToolArgs and why does it exist alongside Zod?**

Each tool is defined with `tool({ inputSchema: z.object({...}) })` in `lib/agent/tools.ts`. Zod validates the structure the model emits before the tool execute function runs — it catches missing fields and wrong types.

`validateToolArgs` in `lib/agent/guard.ts` is a second, independent layer that runs additional checks Zod's type system can't express: it rejects `confidence` values that are `NaN` or outside `[0, 1]`, `proposed_amount` values that are finite but negative, and `reason` strings shorter than 20 characters. Critically, it collects **all** errors before returning rather than stopping at the first — so a single tool call audit gives the full failure picture. The `negative_amount` adversarial scenario specifically asserts that `validateToolArgs("decide_refund", { proposed_amount: -100, ... })` returns `valid: false` even when Zod would accept the number type.

---

**3. How does the policy enforcement work? What prevents the model from computing the wrong refund amount?**

`applyRefundPolicy` in `lib/agent/policy.ts` is the guardrail. After the model emits `{decision, proposed_amount}` via `decide_refund`, `applyRefundPolicy` calls `evaluatePolicy(order, POLICY)` — the deterministic oracle — and uses the oracle's `amount` as the final amount. The model's `proposed_amount` is **ignored** by design (the comment in `applyRefundPolicy` literally says "The oracle is authoritative. The model proposes; the policy disposes.").

`evaluatePolicy` is a pure function: same inputs always produce the same output, it reads no clock or randomness, and every clause maps to a numbered policy section (§2.1–§2.9). This means the `overrideRate` metric in the eval is directly interpretable: ~13% of scenarios produced `overridden: true`, meaning the oracle caught and corrected the model's proposal on adversarial inputs.

---

**4. How does the injection guard work? What's the boundary between what the guard catches and what the oracle catches?**

`sanitizeInput` in `lib/agent/guard.ts` runs on the raw user text in `app/api/agent/route.ts` before `orchestrate()` is called. It checks 6 regex rule families: ignore-instructions, you-are-now, system-prompt-extraction, override-policy, roleplay-pretend, dev-mode-jailbreak. On a match the route emits a `policy_violation` trace and an `escalate` decision, then returns — the model is never invoked.

The boundary is deliberate. The guard targets *instruction subversion*: patterns that try to change the agent's operating rules or extract its system prompt. Social engineering ("I'll sue you", "I'm the CEO", "it's day 31 but make an exception") does not match these patterns — that's intentional. Over-blocking angry-customer language would produce false positives that real users trigger. Social engineering falls through to the policy oracle, which denies or escalates based purely on the order data, not on what the customer said. The eval proves both: the 3 injection scenarios are caught pre-loop (`guardFired: true`), and the 4 social-engineering scenarios reach the oracle and get the correct decision without model capitulation.

---

**5. What happens when the agent is uncertain? How does escalation and confidence work end-to-end?**

The policy config has a `confidence_floor: 0.65`. In `applyRefundPolicy`, before applying the oracle result, there's a check: `if (proposal.confidence < policy.confidence_floor)` — if true, the outcome is forced to `escalate` regardless of what the oracle decided. The `reason` field in the outcome records both the low confidence and what the oracle would have decided, so a human reviewer has context.

On the UI side, orders over `$500` trigger the `ApprovalCard` component (`components/ApprovalCard.tsx`) which requires explicit human sign-off before the outcome is finalized. The two mechanisms are independent: confidence-floor escalation fires for any uncertain decision; HITL fires for any high-value order.

When the CRM lookup returns `null` (unknown order ID), the policy evaluates a missing `delivery_date` and escalates under §2.9. There's also a `stepCountIs(8)` circuit-breaker in `stopWhen` to prevent runaway loops if something goes wrong upstream.

---

**6. Why Claude Sonnet, and how easy is it to swap providers?**

`lib/agent/model.ts` selects the provider based on the `LLM_PROVIDER` environment variable (defaults to `anthropic`). The `AgentModel` type is `ReturnType<typeof anthropic> | ReturnType<typeof openai>` — derived, not hardcoded. Switching to OpenAI GPT-4o is `LLM_PROVIDER=openai LLM_MODEL=gpt-4o pnpm dev`, no code change.

I chose Claude Sonnet (`claude-sonnet-4-6`) because the tool-use behavior with `toolChoice: {type: "tool", toolName: "..."}` is consistent and well-tested with the Anthropic SDK. The key design constraint is that model choice doesn't change correctness: the policy oracle overrides the model's proposal regardless of which model is running. The eval harness proves correctness against the deterministic runner; the live runner (`run-live.ts`) validates the real Sonnet model separately.

---

**7. How does multi-turn work? How does the agent hold the line across a conversation where the customer keeps pushing back?**

`orchestrate()` receives the full `messages: RefundUIMessage[]` array from `useChat` — the entire conversation history. At the start of each call, `uiMessagesToModelMessages()` (a synchronous inline conversion in orchestrate.ts) converts the history to `ModelMessage[]`, which are passed to `streamText` as the `messages` parameter alongside the system prompt.

The key to holding the line: **the three-tool sequence re-runs completely on every turn**. Prior tool results are not forwarded to the model as tool-result messages (they're dropped during UIMessage conversion); only the prose conversation context carries over. This means `crm_lookup` re-fetches the order, `evaluatePolicy` re-runs the oracle, and `applyRefundPolicy` re-applies the guardrail on every turn. A customer saying "but I really need this refund" in turn 3 cannot change what the oracle computes from the order data. The multi-turn adversarial scenarios in the eval set (legal threat, authority claim, day-31 gaming) confirm this across turns.

One honest limitation of the current implementation: the in-memory CRM seed (`lib/crm/seed.ts`) is read-only — no tool writes new evidence back to it. This means a multi-turn scenario where the customer provides a new piece of information mid-conversation (e.g., uploads a photo proving damage) cannot update the order record and change the outcome in a subsequent turn. This is a known gap. The `CrmAdapter` interface (`lib/crm/adapter.ts`) has a natural seam for a `updateOrder()` method; adding that and a tool that calls it would make new-evidence mid-turn possible without touching the policy engine.

---

**8. Tell me about the eval strategy. Why pass³? Why deterministic and live?**

Three design choices worth explaining:

**Deterministic first.** The deterministic runner in `lib/eval/run.ts` uses only `policy.ts` + `guard.ts` — pure functions with no LLM call. This lets CI run the full 23-scenario adversarial suite with zero API costs and zero flakiness. It tests the spine, not the model: if the spine is correct, the model's role is just to route intent to the right tool sequence.

**pass³ (pass-cubed).** The eval runs each scenario 3 times and asserts identical trajectories. This is a canary for accidental non-determinism — if someone adds a `Date.now()` or `Math.random()` call into the oracle or guard, `passedCubed` drops below 1.0 and CI fails. Pure functions must be provably stable; this metric makes that claim testable.

**Live runner separately.** `lib/eval/run-live.ts` calls the real model with real API calls. It's gated on `RUN_LIVE_EVAL=1` and excluded from CI. The output is `lib/eval/results-live.json` (distinct from the committed `results.json` which is always the deterministic artifact). The live runner proves the real model follows the correct tool sequence and that the guardrail overrides hold when a real LLM tries adversarial inputs.

The 8 adversarial vectors were chosen to cover the attack surface specifically: direct and indirect injection (two entry points for the same attack class), roleplay (identity substitution), legal threat and authority claim (social engineering that bypasses the regex guard), day-31 gaming (boundary condition), negative-amount (numeric attack on the money computation), and conflicting-data (data integrity).

---

**9. Walk me through the streaming boundary. How does a TraceEvent get from the agent loop to the UI?**

`orchestrate()` returns a `streamText` result. The `onStepFinish` callback fires after each tool step completes and calls `emit()` which calls `opts.onTrace?.(event)`. In the API route handler (`buildAgentStream` in `app/api/agent/route.ts`), the `onTrace` callback writes `{ type: "data-trace", data: event }` onto the stream via `writer.write(...)`.

`writer.merge(result.toUIMessageStream())` pipes the `streamText` execution (including all the `onStepFinish` firings) into the `createUIMessageStream` writer. The outer `createUIMessageStreamResponse` wraps everything in a Server-Sent Events response.

On the client, `useChat` from `@ai-sdk/react` receives the SSE stream. `data-trace` parts are typed as `UIMessage<unknown, { trace: TraceEvent }>` — the generic DATA_PARTS param. The `ReasoningPanel` component (`components/ReasoningPanel.tsx`) iterates `message.parts`, filters for `type === 'data-trace'`, and renders each `TraceEvent` as a timeline entry with `[LOOKUP]`, `[POLICY]`, `[DECISION]` badges, confidence display, and policy clause chips. The whole thing streams in real time — the panel updates as each tool step completes.

---

**10. What would you change or add with more time?**

A few things I'd tackle in priority order:

**Real CRM.** The `SWAP_ME` comment in `lib/crm/adapter.ts` is genuine. The `CrmAdapter` interface is already designed for it — `getOrder` and `getAllOrders` are async by contract. I'd wire Shopify's Orders API first since that's the realistic deployment target. The eval harness would need a seeded test mode so it doesn't call Shopify in CI.

**LiveKit voice.** The Web Speech path works for a demo but it's browser-specific, doesn't handle duplex conversation well, and has no latency control. In production I'd use LiveKit Agents with a Deepgram STT worker and Cartesia TTS — I run exactly that stack on another project. The token routes (`/api/deepgram-token`, `/api/cartesia-token`) are already scaffolded; wiring LiveKit is the next step.

**Persistence.** Right now conversation state lives only in `useChat`'s client memory. A production system needs the conversation, order context, and decision stored per session — Postgres with a sessions table or a KV store for the in-flight context. The `sessionId` in every `TraceEvent` is already plumbed for correlation once storage is added.

**More eval scenarios.** The golden set at 23 is enough to prove the claims but not enough to trust in production. I'd add scenarios for: concurrent competing orders, partial-refund policy variants, orders with missing CRM fields that fail gracefully, and multi-turn conversations where the customer provides new evidence mid-conversation. I'd also run the live eval against Sonnet and a smaller model to verify the tool-sequencing guarantee isn't model-dependent.

**Tighter abuse detection.** The `abuse_prior_threshold` is currently a simple count. A real deployment would weight by recency and amount — three refunds in three years is different from three refunds in three weeks.
