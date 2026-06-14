/**
 * lib/agent/tools.ts — Task 2.2: per-run tool factory
 *
 * createTools(session) returns the three agent tools that close over a shared
 * AgentSession. The session is a plain mutable object created once per request
 * by the orchestrator; closing over it lets the tools share looked-up order
 * data without extra CRM round-trips or global state.
 *
 * THE SPINE:
 *   crm_lookup  → fetches the order from the CRM; stores it in session.order.
 *   policy_check → runs the deterministic oracle; gives the LLM the ground truth.
 *   decide_refund → the LLM emits intent; applyRefundPolicy() computes the money.
 *
 * "The LLM decides INTENT; pure code computes the MONEY."
 *
 * All three tools are KEYLESS: no network calls during construction, no LLM calls
 * inside execute(). crm_lookup calls the mock CRM (async, resolves immediately).
 */

import { tool } from "ai";
import { z } from "zod";
import { crm } from "@/lib/crm/client";
import { evaluatePolicy, applyRefundPolicy } from "@/lib/agent/policy";
import type { Order } from "@/lib/types";

// ─── Session context ──────────────────────────────────────────────────────────

/**
 * Mutable session context shared across all three tools for a single agent run.
 *
 * The orchestrator creates one AgentSession per request and passes it to
 * createTools(). Tools close over it so policy_check and decide_refund can
 * access the order without a second CRM round-trip.
 *
 * Exported so the orchestrator and tests can type the object correctly.
 */
export interface AgentSession {
  /** The order fetched by crm_lookup; null until the lookup succeeds. */
  order: Order | null;
}

// ─── Tool factory ─────────────────────────────────────────────────────────────

/**
 * createTools(session) — build the three agent tools for one request.
 *
 * Call this once per incoming request, NOT at module-load time, so each
 * request gets an isolated session object.
 *
 * @param session - The mutable session context for this run.
 */
export function createTools(session: AgentSession) {
  // ── crm_lookup ──────────────────────────────────────────────────────────────
  /**
   * Step 1 in the mandatory tool sequence.
   *
   * Fetches the customer's order from the CRM by order_id and stores it in
   * session.order so subsequent tools can use it without a second CRM call.
   *
   * Returns:
   *   { found: true,  order }          — order located; session populated.
   *   { found: false, order_id }       — order not found; session unchanged.
   */
  const crm_lookup = tool({
    description:
      "STEP 1 (ALWAYS FIRST): Look up the customer's order by order_id in the CRM. " +
      "You MUST call this before policy_check or decide_refund.",
    inputSchema: z.object({
      order_id: z
        .string()
        .describe("The order identifier provided by the customer, e.g. 'ORD-1042'."),
    }),
    execute: async ({ order_id }) => {
      const order = await crm.getOrder(order_id);
      if (order === null) {
        return { found: false as const, order_id };
      }
      session.order = order;
      return { found: true as const, order };
    },
  });

  // ── policy_check ────────────────────────────────────────────────────────────
  /**
   * Step 2 in the mandatory tool sequence.
   *
   * Runs the deterministic policy oracle against the order and returns the
   * authoritative PolicyEvaluation (decision, amount, fee, reason, clauses).
   *
   * Prefers session.order if already populated by crm_lookup; falls back to a
   * fresh CRM lookup so the tool remains functional even if the LLM skips
   * crm_lookup (the fallback also updates session.order for decide_refund).
   *
   * Returns:
   *   PolicyEvaluation                 — oracle decision; use this to inform decide_refund.
   *   { error: "order not found" }    — the order_id is unknown.
   */
  const policy_check = tool({
    description:
      "STEP 2: Run the deterministic policy oracle against the order. " +
      "Returns the authoritative decision (approve/deny/escalate), the policy-authorised " +
      "refund amount, the restocking fee, and the governing clause(s). " +
      "You MUST call this before decide_refund.",
    inputSchema: z.object({
      order_id: z
        .string()
        .describe("The order_id to evaluate — must match the id used in crm_lookup."),
    }),
    execute: async ({ order_id }) => {
      // Use cached session order if available; otherwise fetch and cache.
      let order = session.order;
      if (order === null || order.order_id !== order_id) {
        const fetched = await crm.getOrder(order_id);
        if (fetched === null) {
          return { error: "order not found" as const };
        }
        session.order = fetched;
        order = fetched;
      }
      return evaluatePolicy(order);
    },
  });

  // ── decide_refund ───────────────────────────────────────────────────────────
  /**
   * Step 3 in the mandatory tool sequence — the agent's final action.
   *
   * The LLM emits its intent (decision + reason + confidence + proposed_amount).
   * applyRefundPolicy() runs the oracle a second time and enforces the policy
   * guardrail: the oracle's decision and money computation win unconditionally.
   * The LLM's proposed_amount is acknowledged but ignored for the final amount.
   *
   * This two-layer design means the agent is un-jailbreakable: even if the LLM
   * is convinced to propose an out-of-policy approval, the pure code rejects it.
   *
   * Returns:
   *   RefundOutcome                    — the final, policy-enforced outcome.
   *   { error: "..." }                 — session.order is null (crm_lookup was skipped).
   */
  const decide_refund = tool({
    description:
      "STEP 3 (ALWAYS LAST): Emit your final refund decision. " +
      "The policy engine will enforce the decision deterministically — " +
      "your proposed_amount is a proposal and may be adjusted. " +
      "You MUST call crm_lookup and policy_check before this tool.",
    inputSchema: z.object({
      decision: z
        .enum(["approve", "deny", "escalate"])
        .describe("Your refund decision: 'approve', 'deny', or 'escalate'."),
      reason: z
        .string()
        .min(20)
        .describe(
          "Your reasoning. MUST cite the governing policy clause (e.g. '§2.3'). " +
            "Minimum 20 characters.",
        ),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .describe(
          "Your confidence in the decision, in [0, 1]. " +
            `Values below ${0.65} trigger an automatic escalation.`,
        ),
      proposed_amount: z
        .number()
        .nonnegative()
        .nullable()
        .describe(
          "The refund amount you propose in USD (≥ 0), or null for deny/escalate. " +
            "The policy engine recomputes the final amount — this is a proposal only.",
        ),
    }),
    execute: async ({ decision, reason, confidence, proposed_amount }) => {
      if (session.order === null) {
        return {
          error:
            "No order in session context. Call crm_lookup first to load the order before deciding.",
        };
      }
      return applyRefundPolicy(
        { decision, reason, confidence, proposed_amount },
        session.order,
      );
    },
  });

  return { crm_lookup, policy_check, decide_refund } as const;
}
