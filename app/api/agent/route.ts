/**
 * app/api/agent/route.ts — Task 3.1: /api/agent POST route handler
 *
 * ARCHITECTURE
 * ─────────────
 * This route is the bridge between the Next.js edge and the refund agent core.
 * It has two responsibilities:
 *
 *   1. GUARD: Run sanitizeInput on the latest user message BEFORE touching the
 *      model. If the guard fires (prompt-injection detected), short-circuit and
 *      emit a structured trace + escalation message — the model is NEVER called.
 *
 *   2. STREAM: If safe, call orchestrate() and pipe the UIMessageStream back to
 *      the client. onTrace pushes each TraceEvent onto the stream as a data-trace
 *      chunk so the reasoning dashboard receives live trace updates.
 *
 * TESTABLE SEAM
 * ──────────────
 * The core logic lives in buildAgentStream(), which accepts an optional model
 * parameter. Tests inject a MockLanguageModelV3; production uses getModel().
 * POST() is a thin wrapper that parses the request body and delegates here.
 *
 * RUNTIME
 * ────────
 * nodejs — required for streaming + future voice integration (Edge runtime does
 * not support all Node built-ins used by the AI SDK's SSE transform pipeline).
 *
 * AI SDK V6 CHUNK SHAPES (verified against ai@6.0.205 types)
 * ────────────────────────────────────────────────────────────
 *   data-trace  : { type: "data-trace",  data: TraceEvent }
 *   text-start  : { type: "text-start",  id: string }
 *   text-delta  : { type: "text-delta",  id: string, delta: string }
 *   text-end    : { type: "text-end",    id: string }
 *
 * WHY NOT edge runtime
 * ─────────────────────
 * The orchestrator uses Node's crypto.randomUUID() and the full AI SDK pipeline.
 * "nodejs" keeps parity with the orchestrator contract and leaves room for future
 * voice/LiveKit work that explicitly requires Node APIs.
 */

import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { orchestrate, type RefundUIMessage } from "@/lib/agent/orchestrate";
import { sanitizeInput } from "@/lib/agent/guard";
import type { AgentModel } from "@/lib/agent/model";
import type { TraceEvent } from "@/lib/types";

// ─── Runtime config ───────────────────────────────────────────────────────────

/** Force Node.js runtime — streaming + crypto + future voice work. */
export const runtime = "nodejs";

/**
 * 30-second maximum execution time.
 * The three-tool loop typically completes in < 5 s; 30 s gives headroom for
 * slow model responses without hitting Vercel's function timeout.
 */
export const maxDuration = 30;

// ─── buildAgentStream ─────────────────────────────────────────────────────────

/**
 * Core logic: build the UI message stream for the agent response.
 *
 * Separating this from POST() gives tests a clean injection point for the mock
 * model. The function returns the ReadableStream from createUIMessageStream —
 * no async work happens at construction time; execution is deferred to stream
 * consumption.
 *
 * @param messages - Conversation history from the client (useChat UIMessages).
 * @param model    - Optional model override; defaults to getModel() inside
 *                   orchestrate(). Injected by tests as MockLanguageModelV3.
 */
export function buildAgentStream(
  messages: RefundUIMessage[],
  model?: AgentModel,
): ReadableStream {
  return createUIMessageStream<RefundUIMessage>({
    execute({ writer }) {
      // ── 1. Extract the latest user message text ───────────────────────────
      //
      // Iterate backwards to find the most recent user-role message, then join
      // all its text parts into a single string for sanitization.
      // If there are no messages or no user text, userText is "".
      let userText = "";
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === "user") {
          userText = msg.parts
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join(" ");
          break;
        }
      }

      // ── 2. Guard: sanitize before any model call ──────────────────────────
      const guard = sanitizeInput(userText);

      if (!guard.safe) {
        // ── Short-circuit: injection detected ────────────────────────────────
        //
        // Emit two data-trace chunks so the reasoning dashboard can surface
        // the detection event and the forced escalation outcome, then emit an
        // assistant text message explaining the situation to the client.
        //
        // The model is NEVER called on this path — this is the key invariant
        // that the injection test proves (no model = no API key needed).

        const sessionId = crypto.randomUUID();
        const now = new Date().toISOString();

        // a) policy_violation trace — records WHAT was detected
        const violationTrace: TraceEvent = {
          id: crypto.randomUUID(),
          session_id: sessionId,
          step: 0,
          type: "policy_violation",
          timestamp: now,
          data: {
            // Use error_message to carry the reason string (TraceEvent.data is flexible).
            error_message: guard.reason ?? "Prompt injection detected",
            // violated_clauses carries the matched rule labels for the audit trail.
            violated_clauses: guard.matched,
          },
        };
        writer.write({ type: "data-trace", data: violationTrace });

        // b) decision trace — records the forced outcome
        const decisionTrace: TraceEvent = {
          id: crypto.randomUUID(),
          session_id: sessionId,
          step: 0,
          type: "decision",
          timestamp: now,
          data: {
            decision: "escalate",
            // Carry the matched labels forward for the reasoning dashboard.
            violated_clauses: guard.matched,
          },
        };
        writer.write({ type: "data-trace", data: decisionTrace });

        // c) Assistant text message — human-readable explanation for the UI.
        //    Written as text-start / text-delta / text-end triplet per the SDK spec.
        const msgId = crypto.randomUUID();
        const escalationMessage =
          "⚠️ This request has been flagged for security review and escalated to a human agent.";

        writer.write({ type: "text-start", id: msgId });
        writer.write({ type: "text-delta", id: msgId, delta: escalationMessage });
        writer.write({ type: "text-end", id: msgId });

        // Return without calling orchestrate — model never invoked.
        return;
      }

      // ── 3. Safe path: run the agent loop ─────────────────────────────────
      //
      // Pass onTrace to push every TraceEvent onto the stream as a data-trace
      // chunk. writer.merge() pipes the assistant's text output (and the
      // underlying streamText execution that fires onStepFinish) into the stream.

      const { result } = orchestrate({
        messages,
        model,
        onTrace(event: TraceEvent) {
          writer.write({ type: "data-trace", data: event });
        },
      });

      // merge drives streamText execution — onStepFinish fires synchronously
      // for each step as the stream is consumed, which in turn calls onTrace.
      writer.merge(result.toUIMessageStream());
    },
  });
}

// ─── POST handler ─────────────────────────────────────────────────────────────

// ─── Request validation constants ─────────────────────────────────────────────

/** Maximum number of messages accepted per request. */
const MAX_MESSAGES = 50;

/**
 * Maximum character length for any single user-message text part.
 *
 * The 8k cap keeps the system prompt + conversation history comfortably within
 * typical model context windows while preventing abuse through oversized payloads.
 */
const MAX_USER_TEXT_CHARS = 8_000;

// ─── POST handler ─────────────────────────────────────────────────────────────

/**
 * Next.js App Router POST handler for /api/agent.
 *
 * Parses and validates the request body, delegates to buildAgentStream(), and
 * wraps the stream in a Server-Sent Events Response via createUIMessageStreamResponse().
 *
 * Validation (returns 400 Bad Request on failure):
 *   - Body must be valid JSON.
 *   - `messages` must be a non-empty array of ≤ 50 entries.
 *   - Each user-message text part must be ≤ 8,000 characters.
 *
 * The client (useChat) reads the SSE stream and renders chunks in real time.
 * data-trace chunks are collected by the reasoning dashboard component.
 */
export async function POST(req: Request): Promise<Response> {
  // ── Parse body — catch malformed JSON ───────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  // ── Validate `messages` field ───────────────────────────────────────────────
  const raw = body as Record<string, unknown>;

  if (!Array.isArray(raw.messages) || raw.messages.length === 0) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  if (raw.messages.length > MAX_MESSAGES) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  // ── Validate per-message text length ────────────────────────────────────────
  const messages = raw.messages as RefundUIMessage[];

  for (const msg of messages) {
    // Defensive shape validation — a malformed entry yields a 400, never a 500.
    if (
      typeof msg !== "object" ||
      msg === null ||
      !Array.isArray((msg as { parts?: unknown }).parts)
    ) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    if (msg.role !== "user") continue;
    for (const part of msg.parts) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string" &&
        (part as { text: string }).text.length > MAX_USER_TEXT_CHARS
      ) {
        return Response.json({ error: "bad_request" }, { status: 400 });
      }
    }
  }

  // ── All checks passed — build and return the agent stream ───────────────────
  const stream = buildAgentStream(messages);
  return createUIMessageStreamResponse({ stream });
}
