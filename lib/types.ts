/**
 * Shared domain types for the refund agent.
 *
 * These are the contract every layer agrees on: the mock CRM, the policy engine,
 * the agent tools, the orchestrator, the API route, and the UI all import from here.
 *
 * Design note (defensible in review): money is represented as a `number` of dollars
 * (e.g. 89.99). The policy engine rounds every computed amount to cents with a single
 * `round2()` helper to avoid floating-point drift. A production system would model money
 * as integer cents (or a Decimal); dollars-as-number is a deliberate, documented
 * simplification for a single-currency take-home with display-only amounts.
 */

// ─── Customer / order primitives (mirror the mock CRM schema, design spec §8) ───

export type CustomerTier = "new" | "regular" | "VIP";

export type ProductCategory =
  | "electronics"
  | "apparel"
  | "home"
  | "clearance"
  | "perishable";

export type ItemCondition = "unopened" | "opened" | "used" | "damaged";

/** How the item was damaged. `null` when the item is not damaged. */
export type DamageSource = "in_transit" | "buyer" | "unknown" | null;

export type OrderFlag = "final_sale" | "abuse_risk" | "gift" | "subscription";

/**
 * A single order as returned by the CRM. One customer profile == one order here:
 * the take-home models per-order refund decisions, so we keep the unit of work flat.
 * Dates are ISO calendar dates (`YYYY-MM-DD`); the policy engine reasons in whole days.
 */
export interface Order {
  customer_id: string;
  name: string;
  tier: CustomerTier;
  order_id: string;
  item: string;
  category: ProductCategory;
  /** Item price in USD, e.g. 89.99. Refund amounts are capped to [0, price]. */
  price: number;
  /** ISO date the order was placed. */
  order_date: string;
  /** ISO date the item was delivered, or `null` if not delivered / unknown (→ escalate). */
  delivery_date: string | null;
  /** ISO date the customer requested the return. Drives the 30-day window. */
  return_request_date: string;
  condition: ItemCondition;
  damage_source: DamageSource;
  reason_for_return: string;
  /** Count of prior refunds for this customer. Drives the abuse rule. */
  prior_refund_count: number;
  flags: OrderFlag[];
}

// ─── Decision types ───

/** The only three outcomes the agent can reach. */
export type Decision = "approve" | "deny" | "escalate";

/**
 * The model's structured proposal. This is exactly the Zod-validated payload the LLM
 * emits via the `decide_refund` tool — the LLM *decides intent*, it does not compute
 * the money. A pure `applyRefundPolicy()` turns this into a final {@link RefundOutcome}.
 */
export interface ConfidenceDecision {
  decision: Decision;
  /** Why the agent reached this decision; must cite policy, not vibes. */
  reason: string;
  /** Model self-reported confidence in [0, 1]. < 0.65 forces an escalation. */
  confidence: number;
  /** The amount the model proposes to refund, or `null` for deny/escalate. */
  proposed_amount: number | null;
}

/**
 * The final, deterministic result of `applyRefundPolicy(proposal, order)`.
 *
 * This is the source of truth for what actually happens to the money. The pure policy
 * engine may *override* the model's proposal (e.g. force escalate on low confidence or
 * an out-of-policy approval), in which case `overridden` is true and `violated_clauses`
 * explains why.
 */
export interface RefundOutcome {
  /** Final decision after deterministic policy enforcement. */
  decision: Decision;
  /** Final refund amount in USD, always within [0, price]. 0 for deny/escalate. */
  amount: number;
  /** Absolute restocking fee applied in USD (0 if none). */
  restocking_fee: number;
  /** Human-readable explanation that cites the governing policy clause(s). */
  reason: string;
  /** Confidence carried through from the model proposal, in [0, 1]. */
  confidence: number;
  /** Policy clauses (e.g. "§2.2") that forced a deny/escalate; empty on a clean approve. */
  violated_clauses: string[];
  /** Version of the policy this outcome was computed against, e.g. "1.3". */
  policy_version: string;
  /** True when the deterministic engine changed the model's proposed decision/amount. */
  overridden: boolean;
}

// ─── Trace events (shared by chat + voice; design spec §7) ───

export type TraceEventType =
  | "thought"
  | "tool_call"
  | "tool_result"
  | "policy_violation"
  | "decision"
  | "error"
  | "heartbeat";

/** Token accounting surfaced live in the reasoning dashboard. */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

/**
 * One step in the agent's reasoning trajectory. Both the chat and voice frontends
 * render the *same* stream of these, so there is a single reasoning view regardless
 * of input modality.
 */
export interface TraceEvent {
  id: string;
  session_id: string;
  /** Monotonic step index within a single agent run, starting at 0. */
  step: number;
  type: TraceEventType;
  /** ISO 8601 timestamp. */
  timestamp: string;
  data: {
    text?: string;
    tool_name?: string;
    tool_args?: Record<string, unknown>;
    tool_result?: unknown;
    decision?: Decision;
    violated_clauses?: string[];
    error_message?: string;
    usage?: TokenUsage;
  };
}
