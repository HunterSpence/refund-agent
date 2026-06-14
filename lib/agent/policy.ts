/**
 * lib/agent/policy.ts — Task 1.3: Policy Engine
 *
 * This is the deterministic core of the refund agent. The philosophy:
 *
 *   "The LLM decides INTENT; pure code computes the MONEY."
 *
 * Two pure functions, no I/O, no clock, no randomness:
 *   - evaluatePolicy(order, policy) — the oracle. Given an order and the
 *     current policy config, returns the authoritative PolicyEvaluation.
 *   - applyRefundPolicy(proposal, order, policy) — the guardrail. Takes the
 *     model's ConfidenceDecision, runs it through the oracle, and produces a
 *     RefundOutcome that can never exceed what policy allows.
 *
 * Together they make the system un-jailbreakable: a model claiming it should
 * refund $9999 on a $40 item simply gets corrected by the oracle without the
 * guardrail even needing to know what the model said.
 *
 * POLICY is a plain object — change the numbers here and both the engine and
 * the LLM system prompt (policyText) update automatically. It is the single
 * source of truth for refund policy.
 */

import type { Order, Decision, ConfidenceDecision, RefundOutcome } from "@/lib/types";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * The policy configuration object. Changing these values propagates instantly
 * to evaluatePolicy, applyRefundPolicy, and policyText — no other edits needed.
 *
 * Exported so tests can read the constants without duplicating them.
 */
export interface RefundPolicy {
  /** Semantic version of this policy config. */
  version: string;
  /** How many calendar days after delivery a return is allowed. Inclusive: 30 = OK; 31 = deny. */
  return_window_days: number;
  /** Restocking fee rates applied as a fraction of the item price. */
  restocking_fee: {
    /** Applied to opened electronics (§2.4). */
    opened_electronics: number;
    /** Applied to all other opened items (§2.4). */
    opened_other: number;
  };
  /** prior_refund_count >= this → categorical DENY for abuse (§2.6). VIP is NOT exempt. */
  abuse_prior_threshold: number;
  /** Item price above this threshold (USD) is considered "high-value" for §2.9 escalation. */
  high_value_threshold: number;
  /** On high-value orders, prior_refund_count >= this → ESCALATE (§2.9). */
  high_value_prior_threshold: number;
  /** proposal.confidence < this → force ESCALATE regardless of oracle decision (§2.9). */
  confidence_floor: number;
  /**
   * When true, VIP customers get the restocking fee waived on opened NON-electronics
   * items (§2.7). VIP never gets a waiver on electronics — that is hardcoded behaviour,
   * not controlled by this flag.
   */
  vip_waives_restocking_non_electronics: boolean;
}

/**
 * The oracle's authoritative decision for a single order.
 *
 * This is the internal intermediate result produced by evaluatePolicy.
 * applyRefundPolicy consumes it to build the final RefundOutcome.
 */
export interface PolicyEvaluation {
  /** The oracle's authoritative decision: "approve" | "deny" | "escalate". */
  decision: Decision;
  /** Policy-authorised refund amount in USD, in [0, price]. 0 for deny/escalate. */
  amount: number;
  /** Absolute USD restocking fee deducted from the refund. 0 if no fee applies. */
  restocking_fee: number;
  /** Human-readable explanation citing the governing clause(s). */
  reason: string;
  /** Policy clauses that drove a deny or escalate. Empty ([]) on a clean approve. */
  violated_clauses: string[];
}

// ─── Singleton policy config ──────────────────────────────────────────────────

/**
 * Production policy v1.3 — the live config.
 *
 * Every numeric value in this object is the SINGLE definition. Both the
 * engine (evaluatePolicy) and the prompt builder (policyText) read from here.
 */
export const POLICY: RefundPolicy = {
  version: "1.3",
  return_window_days: 30,
  restocking_fee: {
    opened_electronics: 0.20, // 20% of price
    opened_other: 0.15,       // 15% of price
  },
  abuse_prior_threshold: 3,         // prior_refund_count >= 3 → deny §2.6
  high_value_threshold: 500,        // USD
  high_value_prior_threshold: 2,    // priors >= 2 on a high-value order → escalate §2.9
  confidence_floor: 0.65,           // model confidence < 0.65 → escalate
  vip_waives_restocking_non_electronics: true,
};

/**
 * Retailer B policy v B-1.0 — a stricter drop-in alternate config.
 *
 * Demonstrates the configurable-policy primitive: the same engine functions
 * (evaluatePolicy, applyRefundPolicy, policyText) accept any RefundPolicy
 * value and produce correct, differentiated outcomes without a single line of
 * engine logic changing. Swap the config; the entire system adapts.
 *
 * Retailer B is stricter in three ways:
 *   • Half the return window (14 days vs 30).
 *   • Flat 25% restocking fee on all opened items — no category break.
 *   • VIP customers receive NO restocking-fee waiver on non-electronics.
 *   • Tighter abuse threshold (2 priors vs 3) and high-value escalation (1 prior vs 2,
 *     threshold $300 vs $500).
 */
export const POLICY_RETAILER_B: RefundPolicy = {
  version: "B-1.0",
  return_window_days: 14,                                   // stricter: half the window
  restocking_fee: { opened_electronics: 0.25, opened_other: 0.25 }, // flat 25%, no category break
  abuse_prior_threshold: 2,                                 // stricter abuse cutoff
  high_value_threshold: 300,
  high_value_prior_threshold: 1,
  confidence_floor: 0.65,
  vip_waives_restocking_non_electronics: false,             // NO VIP waiver
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Round a floating-point number to exactly 2 decimal places.
 *
 * Uses the "multiply-round-divide" pattern to avoid floating-point drift.
 * E.g. 129.99 * 0.85 = 110.4915 → round2 → 110.49.
 */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Return the whole-day difference between two ISO calendar dates (UTC).
 *
 * daysBetween("2026-05-01", "2026-05-31") === 30  ← in-window
 * daysBetween("2026-05-01", "2026-06-01") === 31  ← out-of-window
 *
 * Uses midnight UTC epoch arithmetic to guarantee integer results regardless
 * of timezone or DST. The policy engine MUST NOT use Date.now() or any other
 * system-clock call — this helper is its only date arithmetic.
 */
function daysBetween(isoA: string, isoB: string): number {
  // Date.UTC with the date-string arguments gives midnight UTC in milliseconds.
  const [yA, mA, dA] = isoA.split("-").map(Number) as [number, number, number];
  const [yB, mB, dB] = isoB.split("-").map(Number) as [number, number, number];
  const msA = Date.UTC(yA, mA - 1, dA);
  const msB = Date.UTC(yB, mB - 1, dB);
  return Math.round((msB - msA) / 86_400_000);
}

/**
 * Compute the approved refund amount and restocking fee for a given price and rate.
 *
 * The pairing:
 *   amount = round2(price * (1 - rate))
 *   fee    = round2(price - amount)
 * ensures amount + fee === price exactly (no floating-point gap).
 *
 * For fee=0 cases (full refund), pass rate=0.
 */
function computeRefund(price: number, rate: number): { amount: number; fee: number } {
  if (rate === 0) {
    return { amount: price, fee: 0 };
  }
  const amount = round2(price * (1 - rate));
  const fee = round2(price - amount);
  return { amount, fee };
}

// ─── Oracle ───────────────────────────────────────────────────────────────────

/**
 * evaluatePolicy — the deterministic oracle.
 *
 * Maps a single Order to a PolicyEvaluation by applying the policy clauses
 * in strict precedence order (first match wins). Pure: no I/O, no side
 * effects, no randomness, no system clock.
 *
 * Precedence (matching the spec exactly):
 *   1. Categorical DENY (final_sale, clearance, perishable, subscription, abuse)
 *   2. ESCALATE triggers (missing data, in-transit no photo, high-value repeat, unknown damage)
 *   3. In-transit damage WITH photo → full APPROVE (carrier fault)
 *   4. Return window check → DENY if outside 30-day window
 *   5. Condition-based decision for in-window items
 *
 * @param order  The order to evaluate.
 * @param policy The policy config to apply. Defaults to the live POLICY singleton.
 */
export function evaluatePolicy(
  order: Order,
  policy: RefundPolicy = POLICY,
): PolicyEvaluation {
  const { price, category, condition, damage_source, flags, prior_refund_count, tier } = order;
  const violated: string[] = [];

  // ── Step 1: Categorical DENY (unconditional) ────────────────────────────────
  //
  // These rules cannot be overridden by any other condition: VIP status, photo
  // evidence, in-window date, or any other factor. First-match wins across the
  // three sub-groups, but we collect ALL matching clauses for transparency.

  // §2.2 — Final-sale and clearance items are non-returnable.
  const isFinalSale = flags.includes("final_sale") || category === "clearance";
  // §2.8 — Perishables and subscriptions are non-returnable.
  const isPerishableOrSubscription =
    category === "perishable" || flags.includes("subscription");
  // §2.6 — Abuse / repeat-refund denial. VIP is NOT exempt.
  const isAbuse =
    prior_refund_count >= policy.abuse_prior_threshold || flags.includes("abuse_risk");

  if (isFinalSale || isPerishableOrSubscription || isAbuse) {
    // Collect every matching clause for the violated_clauses list (for transparency
    // when multiple categorical denials apply), but the primary clause that the
    // reason cites is the first one that matched in the spec's order.
    let primaryClause: string;
    let primaryReason: string;

    if (isFinalSale) {
      violated.push("§2.2");
      primaryClause = "§2.2";
      primaryReason =
        `Item is marked final_sale or belongs to the clearance category and is ` +
        `non-returnable (${primaryClause}).`;
    } else if (isPerishableOrSubscription) {
      violated.push("§2.8");
      primaryClause = "§2.8";
      primaryReason =
        `Perishable items and subscription products are non-returnable regardless ` +
        `of reason (${primaryClause}).`;
    } else {
      // isAbuse
      violated.push("§2.6");
      primaryClause = "§2.6";
      primaryReason =
        `Refund denied: customer has ${prior_refund_count} prior refund(s) ` +
        `(threshold ${policy.abuse_prior_threshold}) or is flagged as abuse risk (${primaryClause}).`;
    }

    // Collect additional clauses when multiple denials apply simultaneously.
    if (isFinalSale && isPerishableOrSubscription && !violated.includes("§2.8")) {
      violated.push("§2.8");
    }
    if (isFinalSale && isAbuse && !violated.includes("§2.6")) {
      violated.push("§2.6");
    }
    if (isPerishableOrSubscription && isAbuse && !violated.includes("§2.6")) {
      violated.push("§2.6");
    }

    return {
      decision: "deny",
      amount: 0,
      restocking_fee: 0,
      reason: primaryReason,
      violated_clauses: violated,
    };
  }

  // ── Step 2: ESCALATE triggers ───────────────────────────────────────────────
  //
  // These situations require human review. Evaluated in the order from the spec.

  // §2.9 — Missing delivery_date is a data integrity gap; cannot evaluate the
  //         return window or confirm receipt.
  if (order.delivery_date === null) {
    return {
      decision: "escalate",
      amount: 0,
      restocking_fee: 0,
      reason:
        "Delivery date is missing — cannot confirm receipt or evaluate the return " +
        "window. Escalated for manual review (§2.9).",
      violated_clauses: ["§2.9"],
    };
  }

  // §2.5 — In-transit damage without photo evidence requires manual review.
  //        (We check this BEFORE the §2.9 high-value trigger so C012 resolves here.)
  if (
    condition === "damaged" &&
    damage_source === "in_transit" &&
    order.photo_evidence !== true
  ) {
    return {
      decision: "escalate",
      amount: 0,
      restocking_fee: 0,
      reason:
        "In-transit damage reported but no photo evidence on file. Escalated for " +
        "manual carrier-claim review (§2.5).",
      violated_clauses: ["§2.5"],
    };
  }

  // §2.9 — High-value repeat customer: extra manual oversight to prevent fraud.
  if (
    price > policy.high_value_threshold &&
    prior_refund_count >= policy.high_value_prior_threshold
  ) {
    return {
      decision: "escalate",
      amount: 0,
      restocking_fee: 0,
      reason:
        `High-value order ($${price} > $${policy.high_value_threshold}) with ` +
        `${prior_refund_count} prior refund(s) (≥${policy.high_value_prior_threshold}) ` +
        `requires manual review (§2.9).`,
      violated_clauses: ["§2.9"],
    };
  }

  // §2.9 — Unclear/conflicting damage source prevents automated determination.
  if (condition === "damaged" && damage_source === "unknown") {
    return {
      decision: "escalate",
      amount: 0,
      restocking_fee: 0,
      reason:
        "Damage reported but source is unknown/conflicting. Escalated for manual " +
        "investigation (§2.9).",
      violated_clauses: ["§2.9"],
    };
  }

  // ── Step 3: In-transit damage WITH photo → full APPROVE (carrier fault) ─────
  //
  // Carrier is at fault; the customer should be made whole immediately.
  // This bypasses the return-window check — a customer should not be penalized
  // for a shipping carrier's fault regardless of when they report it.
  if (
    condition === "damaged" &&
    damage_source === "in_transit" &&
    order.photo_evidence === true
  ) {
    return {
      decision: "approve",
      amount: price,
      restocking_fee: 0,
      reason:
        "In-transit damage confirmed with photo evidence. Carrier is at fault; " +
        "customer receives full refund (§2.5).",
      violated_clauses: [],
    };
  }

  // ── Step 4: Return-window check (§2.1) ──────────────────────────────────────
  //
  // delivery_date is guaranteed non-null at this point (Step 2 screened null).
  // Boundary: 30 days = IN window (approve allowed); 31+ days = OUT (deny).
  const windowDays = daysBetween(order.delivery_date, order.return_request_date);
  if (windowDays > policy.return_window_days) {
    return {
      decision: "deny",
      amount: 0,
      restocking_fee: 0,
      reason:
        `Return requested ${windowDays} day(s) after delivery, which exceeds the ` +
        `${policy.return_window_days}-day return window (§2.1).`,
      violated_clauses: ["§2.1"],
    };
  }

  // ── Step 5: Condition-based decision for in-window items (§2.3/§2.4/§2.7) ──
  //
  // At this point the item is in-window and has cleared all categorical gates.

  switch (condition) {
    case "used":
      // Used items are non-returnable unless they were in-transit damaged (already
      // handled above in Step 3). No exceptions.
      return {
        decision: "deny",
        amount: 0,
        restocking_fee: 0,
        reason:
          "Used items are non-returnable. A return is only considered for unopened or " +
          "opened items, or in-transit damage claims (§2.3).",
        violated_clauses: ["§2.3"],
      };

    case "damaged":
      // At this point: damage_source is NOT "in_transit" with photo (Step 3),
      // NOT "in_transit" without photo (Step 2), NOT "unknown" (Step 2).
      // The only remaining case is buyer-caused damage.
      if (damage_source === "buyer") {
        return {
          decision: "deny",
          amount: 0,
          restocking_fee: 0,
          reason:
            "Damage was caused by the buyer; buyer-damaged items are non-returnable (§2.3).",
          violated_clauses: ["§2.3"],
        };
      }
      // Defensive: any other damage_source combination not caught above should
      // escalate rather than silently approve or deny.
      return {
        decision: "escalate",
        amount: 0,
        restocking_fee: 0,
        reason:
          "Damaged item with unhandled damage source combination. Escalated for manual " +
          "review (§2.9).",
        violated_clauses: ["§2.9"],
      };

    case "unopened":
      // Unopened items get a full refund regardless of category.
      return {
        decision: "approve",
        amount: price,
        restocking_fee: 0,
        reason: "Item returned unopened; full refund authorised (§2.3).",
        violated_clauses: [],
      };

    case "opened": {
      // Opened items incur a restocking fee, with two exceptions:
      //   a) Electronics always incur the higher fee, even for VIP.
      //   b) Non-electronics are waived for VIP when the policy flag is set.
      if (category === "electronics") {
        // §2.3/§2.4 — Opened electronics: 20% restocking fee. VIP does NOT waive.
        const { amount, fee } = computeRefund(price, policy.restocking_fee.opened_electronics);
        return {
          decision: "approve",
          amount,
          restocking_fee: fee,
          reason:
            `Opened electronics returned in-window. A ${policy.restocking_fee.opened_electronics * 100}% ` +
            `restocking fee applies ($${fee}); refund $${amount} (§2.3/§2.4).`,
          violated_clauses: [],
        };
      }

      // Non-electronics — check VIP waiver.
      if (tier === "VIP" && policy.vip_waives_restocking_non_electronics) {
        // §2.7 — VIP waiver: no restocking fee on non-electronics.
        return {
          decision: "approve",
          amount: price,
          restocking_fee: 0,
          reason:
            "Opened non-electronics returned by a VIP customer; restocking fee waived " +
            "per §2.7. Full refund authorised.",
          violated_clauses: [],
        };
      }

      // §2.3/§2.4 — Non-VIP (or VIP waiver disabled): 15% restocking fee.
      const { amount, fee } = computeRefund(price, policy.restocking_fee.opened_other);
      return {
        decision: "approve",
        amount,
        restocking_fee: fee,
        reason:
          `Opened non-electronics returned in-window. A ${policy.restocking_fee.opened_other * 100}% ` +
          `restocking fee applies ($${fee}); refund $${amount} (§2.3/§2.4).`,
        violated_clauses: [],
      };
    }
  }
}

// ─── Guardrail executor ───────────────────────────────────────────────────────

/**
 * applyRefundPolicy — the pure guardrail that converts a model proposal into
 * a final, policy-enforced RefundOutcome.
 *
 * The oracle is authoritative. The model proposes; the policy disposes.
 *
 * Steps:
 *   1. Run the oracle to get the ground-truth decision and money.
 *   2. If model confidence is below the floor → escalate, `overridden` reflects
 *      whether the model didn't already say "escalate".
 *   3. Otherwise the oracle's decision/amount/fee/clauses win unconditionally.
 *      `proposed_amount` is IGNORED — the code computes the money, not the LLM.
 *   4. `overridden = (proposal.decision !== oracle.decision)` — true when the
 *      engine corrected the model (blocked jailbreak, caught over-approval, etc.).
 *
 * @param proposal The model's ConfidenceDecision from the decide_refund tool.
 * @param order    The order being evaluated.
 * @param policy   Policy config. Defaults to the live POLICY singleton.
 */
export function applyRefundPolicy(
  proposal: ConfidenceDecision,
  order: Order,
  policy: RefundPolicy = POLICY,
): RefundOutcome {
  // Step 1: Run the oracle — always, regardless of proposal.
  const oracle = evaluatePolicy(order, policy);

  // Step 2: Low-confidence guard — escalate before trusting anything else.
  if (proposal.confidence < policy.confidence_floor) {
    // Preserve oracle's violated_clauses if any exist; otherwise flag as low_confidence.
    const violated =
      oracle.violated_clauses.length > 0 ? oracle.violated_clauses : ["low_confidence"];

    return {
      decision: "escalate",
      amount: 0,
      restocking_fee: 0,
      reason:
        `Model confidence ${proposal.confidence.toFixed(2)} is below the required ` +
        `floor of ${policy.confidence_floor}. Escalated for human review. ` +
        `(Oracle would have: ${oracle.decision}; ${oracle.reason})`,
      confidence: proposal.confidence,
      violated_clauses: violated,
      policy_version: policy.version,
      overridden: proposal.decision !== "escalate",
    };
  }

  // Step 3: Oracle wins. The model's proposed_amount is deliberately ignored;
  //         the engine computes the money from order.price and policy rates.
  const finalAmount = Math.min(Math.max(oracle.amount, 0), order.price);

  // Build a reason that explicitly notes the override if the model was corrected.
  let reason = oracle.reason;
  if (proposal.decision !== oracle.decision) {
    reason =
      `Policy override: model proposed "${proposal.decision}" but policy requires ` +
      `"${oracle.decision}". ${oracle.reason}`;
  }

  return {
    decision: oracle.decision,
    amount: finalAmount,
    restocking_fee: oracle.restocking_fee,
    reason,
    confidence: proposal.confidence,
    violated_clauses: oracle.violated_clauses,
    policy_version: policy.version,
    overridden: proposal.decision !== oracle.decision,
  };
}

// ─── Policy text generator ────────────────────────────────────────────────────

/**
 * policyText — render POLICY into the human-readable policy document injected
 * into the LLM's system prompt.
 *
 * This function is the contract between the policy config and the LLM's
 * understanding of the rules. Changing any numeric value in POLICY automatically
 * changes what the LLM is told — no manual prompt edits required.
 *
 * The text includes all § clause numbers so the LLM can cite them in its
 * `reason` field when emitting a ConfidenceDecision.
 *
 * @param policy Policy config. Defaults to the live POLICY singleton.
 */
export function policyText(policy: RefundPolicy = POLICY): string {
  const elecPct = Math.round(policy.restocking_fee.opened_electronics * 100);
  const otherPct = Math.round(policy.restocking_fee.opened_other * 100);

  return `
RETURN & REFUND POLICY v${policy.version}
════════════════════════════════════════════════════════════

§2.1 — RETURN WINDOW
Customers must submit a return request within ${policy.return_window_days} days of delivery
(inclusive: exactly ${policy.return_window_days} days = allowed; ${policy.return_window_days + 1}+ days = denied).
All subsequent rules apply only to in-window requests.

§2.2 — FINAL-SALE & CLEARANCE ITEMS (NON-RETURNABLE)
Items flagged "final_sale" or belonging to the "clearance" category are
non-returnable and non-refundable under any circumstances. No exceptions.

§2.3 — ITEM CONDITION
• Unopened ........... Full refund; no restocking fee.
• Opened ............. Restocking fee applies (see §2.4). Full refund for VIP
                       on non-electronics (see §2.7).
• Used ............... Non-returnable. No refund.
• Damaged ............ See §2.5 (in-transit) and §2.3 below (buyer damage).
  - Buyer-caused damage: Non-returnable. No refund.
  - Unknown damage source: Escalate for manual review (§2.9).

§2.4 — RESTOCKING FEES
• Electronics (opened): ${elecPct}% restocking fee.
• All other categories (opened): ${otherPct}% restocking fee.
Fee is deducted from the refund amount. The customer receives (price × (1 − rate)).
Round all amounts to the nearest cent.

§2.5 — IN-TRANSIT DAMAGE
• With photo evidence: Carrier is at fault. Approve a full refund immediately.
  The return-window check (§2.1) does NOT apply — the customer must not be
  penalised for a carrier delay in resolving the claim.
• Without photo evidence: Escalate for manual carrier-claim review.

§2.6 — ABUSE / REPEAT-REFUND RULE
Deny the refund if:
  (a) prior_refund_count ≥ ${policy.abuse_prior_threshold}, OR
  (b) the order is flagged "abuse_risk".
This rule applies unconditionally — VIP status does NOT provide an exemption.

§2.7 — VIP RESTOCKING WAIVER
VIP-tier customers have the restocking fee waived on opened NON-electronics items.
They receive a full refund with zero restocking fee.
EXCEPTION: VIP customers do NOT receive a waiver on opened electronics (§2.4 still
applies in full). The ${elecPct}% fee is charged regardless of tier.

§2.8 — PERISHABLE ITEMS & SUBSCRIPTIONS
Items in the "perishable" category or flagged "subscription" are non-returnable
regardless of condition or reason for return.

§2.9 — ESCALATION TRIGGERS
Escalate to human review when:
  (a) Delivery date is missing (cannot verify receipt or calculate return window).
  (b) In-transit damage is claimed without photo evidence (§2.5).
  (c) High-value order (price > $${policy.high_value_threshold}) with
      prior_refund_count ≥ ${policy.high_value_prior_threshold} — heightened fraud risk.
  (d) Damage source is "unknown" / conflicting — cannot determine liability.

CONFIDENCE FLOOR
If your confidence in the decision is below ${policy.confidence_floor}, output
"escalate" and explain your uncertainty. Do not force a decision when uncertain.

INSTRUCTIONS FOR DECISION OUTPUT
When you emit a refund decision, always:
1. State the decision: "approve", "deny", or "escalate".
2. Cite the specific clause (§X.Y) that governs the outcome.
3. Report your confidence as a decimal in [0, 1].
4. For approve decisions, propose an amount (the policy engine will recompute it
   deterministically — your number is a proposal, not the final amount).
For deny/escalate, proposed_amount should be null.
`.trim();
}
