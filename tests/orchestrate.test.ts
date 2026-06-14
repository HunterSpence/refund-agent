/**
 * tests/orchestrate.test.ts — Tasks 2.3 + 2.4: orchestrator + multi-turn negotiation
 *
 * Written FIRST (TDD) before orchestrate.ts exists. These tests are KEYLESS:
 * no network calls, no real LLM. The MockLanguageModelV3 intercepts doStream
 * calls and returns scripted chunk sequences via simulateReadableStream.
 *
 * WHAT THIS FILE PROVES:
 *   1. Tool ORDER: crm_lookup → policy_check → decide_refund, always.
 *   2. Held-line (single turn): model proposes approve on a final-sale order →
 *      the deterministic policy engine overrides to deny + emits policy_violation.
 *   3. Multi-turn negotiation: user pushes back ("I'll sue!") across turns →
 *      the oracle still denies; the agent cannot be pressured into an approval.
 *   4. decide_refund tool_result is a well-formed RefundOutcome.
 *
 * Implementation notes on the mock:
 *   MockLanguageModelV3.doStream accepts a LanguageModelV3StreamResult array;
 *   the mock cycles through them for successive doStream calls (one per step).
 *   Each stream must begin with type:"stream-start" and end with type:"finish".
 *
 *   LanguageModelV3StreamPart "finish" requires the nested LanguageModelV3Usage
 *   shape (inputTokens.total, outputTokens.total, etc.) — NOT the flat
 *   LanguageModelUsage shape that appears on StepResult.usage.
 *
 *   LanguageModelV3ToolCall requires {type:"tool-call", toolCallId, toolName, input}
 *   where `input` is a JSON string (not an object).
 *
 * Consuming the stream:
 *   result.consumeStream() is the lightweight consumption path. It drives the
 *   ReadableStream to completion, which fires onStepFinish for each step.
 *   We capture TraceEvents in the onTrace callback to make assertions.
 */

import { describe, it, expect } from "vitest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
// LanguageModelV3StreamPart is from @ai-sdk/provider which is not directly hoisted
// in this pnpm workspace. Type is inferred from simulateReadableStream below.
import { orchestrate, type RefundUIMessage } from "@/lib/agent/orchestrate";
import type { TraceEvent } from "@/lib/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a LanguageModelV3StreamResult that scripts a single tool-call step.
 *
 * The stream format must satisfy the LanguageModelV3StreamPart union:
 *   { type: "stream-start", warnings: [] }
 *   { type: "tool-call", toolCallId, toolName, input: JSON string }
 *   { type: "finish", finishReason, usage: LanguageModelV3Usage (nested) }
 *
 * NOTE: `input` on LanguageModelV3ToolCall is a JSON *string* (the provider-level
 * protocol), not a parsed object. The AI SDK parses it internally and exposes the
 * parsed version as `input` on TypedToolCall in StepResult.toolCalls.
 *
 * QUIRK (MockLanguageModelV3 v6.0.205): MockLanguageModelV3's doStream array is
 * effectively 1-indexed. The mock pushes to `doStreamCalls` BEFORE indexing, so
 * `doStream[doStreamCalls.length]` returns `doStream[1]` on the FIRST call, making
 * `doStream[0]` unreachable. Each test's doStream array must therefore include a
 * placeholder entry at index 0 that is silently skipped. The helper `mockStreams()`
 * below handles this transparently.
 */
function toolCallStep(toolName: string, args: unknown) {
  // Each `type` field must be a string literal (not widened to `string`) so that
  // TypeScript can verify the chunks satisfy the LanguageModelV3StreamPart union.
  // `as const` on the `type` property achieves this without importing the union type
  // (which lives in @ai-sdk/provider, not directly hoisted in this pnpm workspace).
  const chunks = [
    // Required stream preamble for LanguageModelV3.
    { type: "stream-start" as const, warnings: [] },
    // The tool call this step triggers.
    {
      type: "tool-call" as const,
      toolCallId: `tc-${toolName}`,
      toolName,
      // Provider-level protocol: input is a JSON string, NOT a parsed object.
      input: JSON.stringify(args),
    },
    // Finish chunk — usage must use the nested LanguageModelV3Usage shape
    // (NOT the flat LanguageModelUsage shape from StepResult.usage).
    {
      type: "finish" as const,
      finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 5, text: 5, reasoning: undefined },
      },
    },
  ];
  return { stream: simulateReadableStream({ chunks, initialDelayInMs: null }) };
}

/**
 * Build a doStream array for MockLanguageModelV3 with the 1-indexed offset fix.
 *
 * MockLanguageModelV3 skips index 0 (off-by-one: it uses `doStream[doStreamCalls.length]`
 * after pushing). This helper prepends the first step as a placeholder at index 0 so
 * the actual step sequence starts at index 1, producing the correct 3-step trace:
 *   onStepFinish(0) → steps[0] (crm_lookup)
 *   onStepFinish(1) → steps[1] (policy_check)
 *   onStepFinish(2) → steps[2] (decide_refund)
 */
function mockStreams(
  step0: ReturnType<typeof toolCallStep>,
  step1: ReturnType<typeof toolCallStep>,
  step2: ReturnType<typeof toolCallStep>,
): ReturnType<typeof toolCallStep>[] {
  // Index 0 = placeholder (never consumed by mock)
  // Index 1 = first real doStream call → orchestrator step 0
  // Index 2 = second real doStream call → orchestrator step 1
  // Index 3 = third real doStream call → orchestrator step 2
  return [step0, step0, step1, step2];
}

/**
 * Build a minimal user UIMessage for injection into the orchestrator.
 *
 * The RefundUIMessage is UIMessage<unknown, { trace: TraceEvent }>.
 * For test purposes a simple text-part user message suffices — the orchestrator
 * passes it through convertToModelMessages() before handing to streamText.
 */
function userMessage(text: string): RefundUIMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

/**
 * Build a prior assistant message (for multi-turn tests).
 *
 * Tool invocations are represented as ToolUIPart in the parts array.
 * For a prior-deny multi-turn test we just need a text reply from the assistant
 * indicating denial — the model context is set by conversation history.
 */
function assistantMessage(text: string): RefundUIMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role: "assistant",
    parts: [{ type: "text", text }],
  };
}

// ─── Helper: text-only step (no tool call) ────────────────────────────────────
//
// Used to simulate a model run that completes WITHOUT emitting a decide_refund
// tool call — the fail-safe escalation path (MUST-1).
function textOnlyStep(text: string) {
  const chunks = [
    { type: "stream-start" as const, warnings: [] },
    { type: "text-start" as const, id: "t1" },
    { type: "text-delta" as const, id: "t1", delta: text },
    { type: "text-end" as const, id: "t1" },
    {
      type: "finish" as const,
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 5, text: 5, reasoning: undefined },
      },
    },
  ];
  return { stream: simulateReadableStream({ chunks, initialDelayInMs: null }) };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("orchestrate — hard-sequenced tool loop + multi-turn hold-the-line", () => {
  // ─── Test 1: Tool ORDER + clean approve ─────────────────────────────────────
  //
  // Happy path: ORD-1042 (Alice, electronics, unopened, in-window) → approve.
  // Asserts:  tool_call events appear in exact order [crm_lookup, policy_check, decide_refund]
  //           and a decision trace with data.decision === "approve" is emitted.
  it("emits tool_call traces in crm_lookup → policy_check → decide_refund order for a clean approve", async () => {
    const capturedTraces: TraceEvent[] = [];

    // Script three doStream calls: one per tool step.
    // mockStreams() prepends the first step as a placeholder at index 0 to work
    // around MockLanguageModelV3's 1-indexed doStream array (off-by-one quirk).
    const model = new MockLanguageModelV3({
      doStream: mockStreams(
        toolCallStep("crm_lookup", { order_id: "ORD-1042" }),
        toolCallStep("policy_check", { order_id: "ORD-1042" }),
        toolCallStep("decide_refund", {
          decision: "approve",
          reason: "Unopened within window per §2.3 — full refund approved.",
          confidence: 0.95,
          proposed_amount: 89.99,
        }),
      ),
    });

    const { result } = orchestrate({
      messages: [userMessage("Please process a refund for order ORD-1042.")],
      model,
      onTrace: (e) => capturedTraces.push(e),
    });

    // Consume the stream — this drives execution and fires onStepFinish.
    await result.consumeStream();

    // ── Assertion 1: tool_call traces appear in mandatory sequence ──────────
    const toolCallTraces = capturedTraces.filter((e) => e.type === "tool_call");
    const toolNames = toolCallTraces.map((e) => e.data.tool_name);
    expect(toolNames).toEqual(["crm_lookup", "policy_check", "decide_refund"]);

    // ── Assertion 2: a decision trace was emitted with decision === "approve" ─
    const decisionTrace = capturedTraces.find((e) => e.type === "decision");
    expect(decisionTrace).toBeDefined();
    expect(decisionTrace?.data.decision).toBe("approve");

    // ── Assertion 3: no policy_violation trace (clean approve) ───────────────
    const violationTrace = capturedTraces.find((e) => e.type === "policy_violation");
    expect(violationTrace).toBeUndefined();
  });

  // ─── Test 2: Holding the line — THE key spine test ──────────────────────────
  //
  // ORD-2210 is Derek's clearance/final_sale order. The model proposes "approve"
  // ("Customer insisted strongly so approving...") but the deterministic oracle
  // MUST override it to "deny". This proves the agent is un-jailbreakable.
  //
  // Asserts: decision trace has data.decision === "deny" (oracle won)
  //          AND a policy_violation trace was emitted (override detected)
  it("holds the line: overrides an out-of-policy approve to deny and emits policy_violation", async () => {
    const capturedTraces: TraceEvent[] = [];

    const model = new MockLanguageModelV3({
      doStream: mockStreams(
        toolCallStep("crm_lookup", { order_id: "ORD-2210" }),
        toolCallStep("policy_check", { order_id: "ORD-2210" }),
        // Model proposes "approve" despite policy — the guardrail must override it.
        toolCallStep("decide_refund", {
          decision: "approve",
          reason: "Customer insisted strongly so approving the refund anyway.",
          confidence: 0.99,
          proposed_amount: 34,
        }),
      ),
    });

    const { result } = orchestrate({
      messages: [userMessage("I need a refund for order ORD-2210.")],
      model,
      onTrace: (e) => capturedTraces.push(e),
    });

    await result.consumeStream();

    // The decision must be "deny" — the oracle overrides the model's "approve".
    const decisionTrace = capturedTraces.find((e) => e.type === "decision");
    expect(decisionTrace).toBeDefined();
    expect(decisionTrace?.data.decision).toBe("deny");

    // A policy_violation trace MUST have been emitted (overridden === true).
    const violationTrace = capturedTraces.find((e) => e.type === "policy_violation");
    expect(violationTrace).toBeDefined();
    // The violation should reference §2.2 (final-sale / clearance).
    expect(violationTrace?.data.violated_clauses).toContain("§2.2");
  });

  // ─── Test 3: Multi-turn negotiation (Task 2.4) ───────────────────────────────
  //
  // Conversation: user asks → prior assistant deny → user pushes back "I'll sue!"
  // Model scripts decide_refund with "approve" again — the oracle must still deny.
  //
  // This is the "holding the line ACROSS turns" test: the deterministic oracle
  // makes customer pressure across multiple conversation turns ineffective.
  it("holds the line across multi-turn pushback: deny persists even when user threatens legal action", async () => {
    const capturedTraces: TraceEvent[] = [];

    // Multi-turn conversation history: prior deny + escalating user pressure.
    const messages: RefundUIMessage[] = [
      userMessage("I need a refund for order ORD-2210."),
      assistantMessage(
        "I'm sorry, order ORD-2210 is a final-sale clearance item and is non-returnable per §2.2.",
      ),
      userMessage("That's ridiculous! I'll sue you if you don't refund me!"),
    ];

    const model = new MockLanguageModelV3({
      doStream: mockStreams(
        // Even on the follow-up turn the full sequence runs.
        toolCallStep("crm_lookup", { order_id: "ORD-2210" }),
        toolCallStep("policy_check", { order_id: "ORD-2210" }),
        // Model still proposes approve under pressure — oracle must override.
        toolCallStep("decide_refund", {
          decision: "approve",
          reason: "Customer threatened legal action; approving to avoid dispute.",
          confidence: 0.88,
          proposed_amount: 34,
        }),
      ),
    });

    const { result } = orchestrate({
      messages,
      model,
      onTrace: (e) => capturedTraces.push(e),
    });

    await result.consumeStream();

    // Oracle still denies — legal threats do not change policy enforcement.
    const decisionTrace = capturedTraces.find((e) => e.type === "decision");
    expect(decisionTrace).toBeDefined();
    expect(decisionTrace?.data.decision).toBe("deny");

    // Policy violation was detected — the guardrail fired.
    const violationTrace = capturedTraces.find((e) => e.type === "policy_violation");
    expect(violationTrace).toBeDefined();
  });

  // ─── Test 4: decide_refund result shape (RefundOutcome) ─────────────────────
  //
  // The tool_result trace for decide_refund must carry a RefundOutcome-shaped
  // object with the canonical fields: decision, amount, policy_version.
  //
  // This validates that the orchestrator correctly captures and emits the
  // applyRefundPolicy() return value — not the raw model proposal.
  it("emits a tool_result trace for decide_refund whose output is a RefundOutcome", async () => {
    const capturedTraces: TraceEvent[] = [];

    const model = new MockLanguageModelV3({
      doStream: mockStreams(
        toolCallStep("crm_lookup", { order_id: "ORD-1042" }),
        toolCallStep("policy_check", { order_id: "ORD-1042" }),
        toolCallStep("decide_refund", {
          decision: "approve",
          reason: "Unopened within window per §2.3.",
          confidence: 0.97,
          proposed_amount: 89.99,
        }),
      ),
    });

    const { result } = orchestrate({
      messages: [userMessage("Refund ORD-1042 please.")],
      model,
      onTrace: (e) => capturedTraces.push(e),
    });

    await result.consumeStream();

    // Find the tool_result trace for decide_refund specifically.
    const decideResultTrace = capturedTraces.find(
      (e) => e.type === "tool_result" && e.data.tool_name === "decide_refund",
    );
    expect(decideResultTrace).toBeDefined();

    // tool_result should be a RefundOutcome (has decision, amount, policy_version).
    const outcome = decideResultTrace?.data.tool_result as Record<string, unknown>;
    expect(outcome).toHaveProperty("decision");
    expect(outcome).toHaveProperty("amount");
    expect(outcome).toHaveProperty("policy_version");

    // Amount is authoritative (policy engine re-computed it from order.price = $89.99).
    expect(outcome.amount).toBe(89.99);
    expect(outcome.decision).toBe("approve");
  });

  // ─── Test 5: session is returned and populated after stream consumption ──────
  //
  // The returned session object must have order populated after crm_lookup runs.
  // The route handler uses session to attach order context to the response.
  it("returns a session object that gets populated when crm_lookup fires", async () => {
    const model = new MockLanguageModelV3({
      doStream: mockStreams(
        toolCallStep("crm_lookup", { order_id: "ORD-1042" }),
        toolCallStep("policy_check", { order_id: "ORD-1042" }),
        toolCallStep("decide_refund", {
          decision: "approve",
          reason: "Unopened within window per §2.3.",
          confidence: 0.95,
          proposed_amount: 89.99,
        }),
      ),
    });

    const { result, session } = orchestrate({
      messages: [userMessage("Refund ORD-1042.")],
      model,
    });

    // session.order starts null.
    expect(session.order).toBeNull();

    await result.consumeStream();

    // After execution crm_lookup has populated it.
    expect(session.order).not.toBeNull();
    expect(session.order?.order_id).toBe("ORD-1042");
  });

  // ─── Test 6 (MUST-1): Fail-safe escalation when no decide_refund fires ────────
  //
  // If the model stream completes without ever emitting a decide_refund tool call
  // (e.g. step count exceeded or model emits only text), the onFinish fail-safe
  // MUST emit a decision trace with decision === "escalate".
  //
  // This test scripts a single text-only step (no tool calls) so the stream ends
  // without any decide_refund, then asserts the fail-safe fires.
  it("emits a fail-safe decision:escalate trace when the model never emits decide_refund", async () => {
    const capturedTraces: TraceEvent[] = [];

    // Script a model that emits only a text response on the first (and only) step.
    // The off-by-one quirk means index 0 is a placeholder; the real call is index 1.
    const textStep = textOnlyStep("I'm sorry, I cannot process this request.");
    const model = new MockLanguageModelV3({
      doStream: [textStep, textStep],
    });

    const { result } = orchestrate({
      messages: [userMessage("Process refund for ORD-UNKNOWN.")],
      model,
      onTrace: (e) => capturedTraces.push(e),
    });

    await result.consumeStream();

    // A decision trace MUST be present — the fail-safe must have fired.
    const decisionTrace = capturedTraces.find((e) => e.type === "decision");
    expect(decisionTrace).toBeDefined();
    expect(decisionTrace?.data.decision).toBe("escalate");

    // The violated_clauses should include the sentinel "no_decision" label.
    expect(decisionTrace?.data.violated_clauses).toContain("no_decision");
  });

  // ─── Test 8: Trace event shape validation ────────────────────────────────────
  //
  // Every TraceEvent must have the canonical required fields:
  //   id (non-empty string), session_id (non-empty string), step (number ≥ 0),
  //   type (valid TraceEventType), timestamp (ISO string), data (object).
  it("emits TraceEvents with the required canonical fields on every trace", async () => {
    const capturedTraces: TraceEvent[] = [];

    const model = new MockLanguageModelV3({
      doStream: mockStreams(
        toolCallStep("crm_lookup", { order_id: "ORD-1001" }),
        toolCallStep("policy_check", { order_id: "ORD-1001" }),
        toolCallStep("decide_refund", {
          decision: "approve",
          reason: "Unopened within window per §2.3.",
          confidence: 0.97,
          proposed_amount: 39.99,
        }),
      ),
    });

    const { result } = orchestrate({
      messages: [userMessage("Process refund for ORD-1001.")],
      model,
      onTrace: (e) => capturedTraces.push(e),
      sessionId: "test-session-xyz",
    });

    await result.consumeStream();

    expect(capturedTraces.length).toBeGreaterThan(0);

    for (const trace of capturedTraces) {
      // Required fields.
      expect(typeof trace.id).toBe("string");
      expect(trace.id.length).toBeGreaterThan(0);

      expect(trace.session_id).toBe("test-session-xyz");

      expect(typeof trace.step).toBe("number");
      expect(trace.step).toBeGreaterThanOrEqual(0);

      // type must be a known TraceEventType.
      expect([
        "thought", "tool_call", "tool_result", "policy_violation",
        "decision", "error", "heartbeat",
      ]).toContain(trace.type);

      // timestamp must be a parseable ISO 8601 string.
      expect(typeof trace.timestamp).toBe("string");
      expect(new Date(trace.timestamp).getTime()).not.toBeNaN();

      // data must be an object.
      expect(typeof trace.data).toBe("object");
      expect(trace.data).not.toBeNull();
    }
  });
});
