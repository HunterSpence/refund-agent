/**
 * lib/agent/orchestrate.ts — Tasks 2.3 + 2.4: hard-sequenced tool loop
 *
 * DESIGN PHILOSOPHY
 * ─────────────────
 * This is the SPINE of the refund agent. It wires together every piece:
 *   model → streamText → [crm_lookup → policy_check → decide_refund] → trace
 *
 * Three guarantees this file enforces:
 *   1. TOOL ORDER: prepareStep forces crm_lookup on step 0, policy_check on step 1,
 *      decide_refund on all later steps. The LLM cannot deviate.
 *   2. HELD LINE: the decide_refund tool calls applyRefundPolicy() internally —
 *      a pure guardrail that ignores the model's proposal and runs the oracle.
 *      Even if the model emits "approve" on a final-sale order, the oracle denies.
 *   3. TRACEABILITY: every tool call, tool result, policy override, and final
 *      decision is emitted as a TraceEvent via the onTrace callback. The UI
 *      reasoning dashboard subscribes to these live.
 *
 * MULTI-TURN (Task 2.4)
 * ─────────────────────
 * uiMessagesToModelMessages() synchronously converts the full UIMessage conversation
 * history to ModelMessages before passing to streamText. Each invocation re-runs
 * the full three-step sequence regardless of how many prior turns exist — the oracle
 * always gets a fresh look at the order, so holding the line is guaranteed across turns.
 *
 * NOTE: convertToModelMessages() from the AI SDK is ASYNC (returns Promise<ModelMessage[]>)
 * which is incompatible with the synchronous orchestrate() API contract. We provide a
 * lightweight synchronous implementation that covers the text-only user/assistant parts
 * used by RefundUIMessage. Tool-call UIMessage parts are intentionally not forwarded
 * to the model here — the orchestrator always re-runs the full 3-step sequence fresh.
 *
 * WHY NO sanitizeInput HERE
 * ──────────────────────────
 * Input sanitization (prompt-injection guard) runs in the API route handler before
 * orchestrate() is called. orchestrate() assumes pre-sanitized input by contract.
 *
 * KEYLESS
 * ───────
 * No network calls at construction time. streamText drives the model; tests
 * substitute a MockLanguageModelV3 that returns scripted ReadableStreams.
 */

import {
  streamText,
  hasToolCall,
  stepCountIs,
  type UIMessage,
  type ModelMessage,
} from "ai";

import { getModel, type AgentModel } from "@/lib/agent/model";
import { systemPrompt } from "@/lib/agent/prompts";
import { createTools, type AgentSession } from "@/lib/agent/tools";
import { POLICY, type RefundPolicy } from "@/lib/agent/policy";
import type { TraceEvent, TraceEventType, Decision, RefundOutcome } from "@/lib/types";

// ─── Observability gate ────────────────────────────────────────────────────────
//
// Langfuse-ready OpenTelemetry telemetry, gated on environment credentials.
//
// When LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY are both absent (CI, local dev
// without a Langfuse project) the AI SDK treats isEnabled:false as a total no-op:
// no spans are emitted, no OTel exporter is required, and agent behaviour is
// identical. Activating production tracing requires two steps only:
//   1. Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in the environment.
//   2. Register a LangfuseExporter as the global OTel exporter in
//      `instrumentation.ts` (see README § Observability for the exact snippet).
// Zero changes to agent logic are needed — this hook fires automatically.

/**
 * Telemetry is enabled only when Langfuse credentials are present in the
 * environment. Absent creds → complete no-op (the AI SDK emits no spans and
 * requires no OTel exporter). Flipping LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY
 * (and registering the LangfuseExporter in instrumentation.ts — see README)
 * lights up full tracing with ZERO change to agent logic.
 */
export function isTelemetryEnabled(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * RefundUIMessage — the message type this agent exchanges with the client.
 *
 * UIMessage generics:
 *   <METADATA, DATA_PARTS, TOOLS>
 *
 *   METADATA  = unknown  (no per-message metadata needed)
 *   DATA_PARTS = { trace: TraceEvent }  → enables typed data-trace UIMessageParts
 *                                          that carry TraceEvent payloads over the
 *                                          UI message stream to the client.
 *
 * The route handler calls result.toUIMessageStream() and the AI SDK serialises
 * these data parts; the reasoning dashboard deserialises and renders them live.
 */
export type RefundUIMessage = UIMessage<unknown, { trace: TraceEvent }>;

/**
 * Options accepted by orchestrate().
 *
 * Every field has a sensible default so tests can pass minimal configs.
 */
export interface OrchestrateOptions {
  /** Conversation history from useChat (includes all prior turns). */
  messages: RefundUIMessage[];
  /** Language model to use. Defaults to getModel() (env-var driven). */
  model?: AgentModel;
  /**
   * Called synchronously for every TraceEvent as steps finish.
   *
   * The route handler uses this to:
   *   a) push data-trace parts onto the UI stream (for the reasoning dashboard)
   *   b) write events to the audit log
   *
   * Tests use this to capture traces for assertion without consuming the stream twice.
   */
  onTrace?: (event: TraceEvent) => void;
  /**
   * Stable session identifier for correlating traces across steps and turns.
   * Defaults to a freshly generated UUID.
   */
  sessionId?: string;
  /**
   * Policy config to enforce. Defaults to the live POLICY singleton.
   *
   * Injected in tests to exercise edge-case policies without mutating the global.
   */
  policy?: RefundPolicy;
}

// ─── orchestrate() ────────────────────────────────────────────────────────────

/**
 * Run one agent loop (all three tool steps) for the given conversation.
 *
 * Returns:
 *   result  — the streamText result. The route handler calls
 *             result.toUIMessageStream() to get the SSE stream for the client.
 *             Tests call result.consumeStream() to drive execution and fire
 *             onStepFinish callbacks.
 *   session — the shared AgentSession. Populated with the looked-up order after
 *             crm_lookup fires. The route handler can inspect it post-stream to
 *             attach order context to the response metadata.
 */
// The return type is inferred from streamText's generic instantiation.
// We avoid ReturnType<typeof streamText> which resolves to StreamTextResult<ToolSet,...>
// (the widened base) and would misalign with the concrete tool signatures returned here.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function orchestrate(opts: OrchestrateOptions) {
  // ── 1. Per-request context ──────────────────────────────────────────────────

  // The session is a plain mutable object. crm_lookup writes session.order;
  // policy_check and decide_refund read it. All three tools close over the same
  // reference — shared state without globals.
  const session: AgentSession = { order: null };
  const tools = createTools(session);

  // Stable session id for trace correlation. Generate once per call.
  const sessionId = opts.sessionId ?? crypto.randomUUID();

  // Monotonic step counter — incremented once per onStepFinish. Steps are
  // zero-indexed so the first tool call is step 0.
  let stepCounter = 0;

  // ── 2. Trace emitter ───────────────────────────────────────────────────────

  /**
   * Build and dispatch a TraceEvent.
   *
   * All fields required by the TraceEvent contract are populated here in one
   * place — callers pass only the type and the data payload.
   *
   * Note on timestamps: we use real wall-clock timestamps here. The agent is
   * NOT a pure function (it performs I/O); real timestamps are correct and are
   * what the UI reasoning dashboard renders.
   */
  function emit(type: TraceEventType, data: TraceEvent["data"]): void {
    const event: TraceEvent = {
      id: crypto.randomUUID(),
      session_id: sessionId,
      step: stepCounter,
      type,
      timestamp: new Date().toISOString(),
      data,
    };
    opts.onTrace?.(event);
  }

  // ── 3. Tool sequence enforcement (prepareStep) ─────────────────────────────

  /**
   * prepareStep — called before each LLM invocation to constrain what tools
   * it may call and force the tool-call decision.
   *
   * The three-step sequence is HARD-CODED:
   *   stepNumber 0 → crm_lookup  (fetch the order)
   *   stepNumber 1 → policy_check (run the oracle)
   *   stepNumber 2+ → decide_refund (emit the final decision)
   *
   * `toolChoice: { type: "tool", toolName: X }` forces the model to call
   * exactly that tool rather than choosing freely. Combined with `activeTools`
   * limiting the allowed set, the sequence cannot be broken even by an
   * adversarially crafted prompt.
   *
   * This is what the eval harness proves at 100%: every agent run follows the
   * mandatory sequence, with no crm_lookup skips or decide_refund-first attacks.
   */
  // PrepareStepResult<TOOLS>.activeTools expects Array<keyof TOOLS>.
  // We derive the key type from the concrete tools object to satisfy this constraint.
  type ToolKey = keyof typeof tools;

  function prepareStep({ stepNumber }: { stepNumber: number }) {
    if (stepNumber === 0) {
      return {
        activeTools: ["crm_lookup"] as ToolKey[],
        toolChoice: { type: "tool" as const, toolName: "crm_lookup" as const },
      };
    }
    if (stepNumber === 1) {
      return {
        activeTools: ["policy_check"] as ToolKey[],
        toolChoice: { type: "tool" as const, toolName: "policy_check" as const },
      };
    }
    // All later steps (2+): the only available tool is decide_refund.
    return {
      activeTools: ["decide_refund"] as ToolKey[],
      toolChoice: { type: "tool" as const, toolName: "decide_refund" as const },
    };
  }

  // ── 4. streamText call ─────────────────────────────────────────────────────

  // ── 4a. Synchronous UIMessage → ModelMessage conversion ────────────────────
  //
  // convertToModelMessages() from the AI SDK is async (returns Promise<ModelMessage[]>)
  // which cannot be used in the synchronous orchestrate() API. We convert the
  // text-only user/assistant parts directly, which is sufficient for all RefundUIMessage
  // cases. The orchestrator always re-runs the full 3-step tool sequence from scratch
  // each turn — prior tool invocations in the history are NOT forwarded to the model
  // (only the prose conversation context is), consistent with the spec's design.
  const modelMessages: ModelMessage[] = opts.messages.flatMap((msg): ModelMessage[] => {
    // Extract text parts from the UIMessage parts array.
    const textParts = msg.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => ({ type: "text" as const, text: p.text }));

    // Skip messages with no extractable text content (e.g. pure tool-invocation messages).
    if (textParts.length === 0) return [];

    if (msg.role === "user") {
      return [{ role: "user", content: textParts }];
    }
    if (msg.role === "assistant") {
      return [{ role: "assistant", content: textParts }];
    }
    // system / tool roles: drop them — the system prompt is set via `system:` param.
    return [];
  });

  // ── 4b. streamText call ────────────────────────────────────────────────────

  const result = streamText({
    model: opts.model ?? getModel(),
    system: systemPrompt(opts.policy ?? POLICY),
    // Pre-converted model messages (synchronous — avoids the async SDK helper).
    messages: modelMessages,
    tools,

    // Stop conditions: halt as soon as decide_refund fires (step 2 done) or
    // after 8 steps as a circuit-breaker against runaway loops.
    stopWhen: [hasToolCall("decide_refund"), stepCountIs(8)],

    // prepareStep enforces the mandatory tool sequence at the LLM call level.
    prepareStep,

    // Langfuse-ready OTel telemetry — complete no-op when creds are absent.
    // isEnabled reads the env gate at call time so tests can toggle it freely.
    // Activation: set LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY and register a
    // LangfuseExporter in instrumentation.ts (see README § Observability).
    experimental_telemetry: {
      isEnabled: isTelemetryEnabled(),
      functionId: "refund-agent-orchestrate",
      metadata: { sessionId },
    },

    // onStepFinish — fires after each complete step (tool call + result pair).
    // This is where we translate AI SDK step data into TraceEvents.
    onStepFinish(step) {
      // ── Emit tool_call traces ──────────────────────────────────────────────
      //
      // step.toolCalls: Array<TypedToolCall<TOOLS>>
      // TypedToolCall has: toolCallId, toolName, input (parsed object)
      //
      // We emit one tool_call trace per tool call in this step.
      for (const toolCall of step.toolCalls) {
        emit("tool_call", {
          tool_name: toolCall.toolName,
          // toolCall.input is the already-parsed args object. Cast to the
          // expected Record type for the TraceEvent data field.
          tool_args: toolCall.input as Record<string, unknown>,
        });
      }

      // ── Emit tool_result traces ────────────────────────────────────────────
      //
      // step.toolResults: Array<TypedToolResult<TOOLS>>
      // TypedToolResult has: toolCallId, toolName, input, output
      //
      // We emit one tool_result trace per result.
      // For decide_refund we perform additional checks (decision + override).
      for (const toolResult of step.toolResults) {
        // Emit the base tool_result trace.
        emit("tool_result", {
          tool_name: toolResult.toolName,
          tool_result: toolResult.output,
        });

        // ── Special handling for decide_refund ─────────────────────────────
        //
        // The output of decide_refund is either:
        //   a) RefundOutcome — the final policy-enforced result (has .decision)
        //   b) { error: string } — crm_lookup was skipped (should never happen
        //      in production because prepareStep enforces crm_lookup first, but
        //      we guard defensively)
        //
        // A RefundOutcome always has a `decision` field.
        // An error response has an `error` field and no `decision`.
        if (toolResult.toolName === "decide_refund") {
          const output = toolResult.output as Record<string, unknown>;

          // Type guard: is this a RefundOutcome (has decision) vs an error?
          if ("decision" in output && typeof output.decision === "string") {
            // Cast to RefundOutcome for typed field access.
            const outcome = output as unknown as RefundOutcome;

            // Emit the decision trace — the authoritative outcome.
            emit("decision", {
              decision: outcome.decision as Decision,
              violated_clauses: outcome.violated_clauses,
            });

            // If the policy engine overrode the model's proposal, emit a
            // policy_violation trace. This is the signal that the guardrail
            // fired and "held the line" against an out-of-policy approval.
            if (outcome.overridden === true) {
              emit("policy_violation", {
                decision: outcome.decision as Decision,
                violated_clauses: outcome.violated_clauses,
              });
            }
          }
          // If output has an `error` field, the tool was miscalled (crm_lookup
          // skipped). We don't emit a decision trace — the stream will continue
          // until stepCountIs(8) halts it.
        }
      }

      // Advance the step counter AFTER processing this step's data.
      // The counter reflects which step the NEXT emission will belong to.
      stepCounter++;
    },
  });

  return { result, session };
}
