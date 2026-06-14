/**
 * tests/policy.test.ts
 *
 * TDD suite for lib/agent/policy.ts (Task 1.3).
 *
 * Structure:
 *   1. evaluatePolicy — oracle decisions for all 15 seed orders
 *   2. evaluatePolicy — boundary conditions (return-window edge, VIP scope)
 *   3. applyRefundPolicy — guardrail contract
 *   4. policyText — invariants the system prompt must satisfy
 *
 * These tests are written BEFORE the implementation and are expected to fail
 * until policy.ts exists.
 */

import { describe, it, expect } from "vitest";
import { SEED_ORDERS } from "@/lib/crm/data";
import {
  POLICY,
  evaluatePolicy,
  applyRefundPolicy,
  policyText,
} from "@/lib/agent/policy";
import type { Order } from "@/lib/types";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal synthetic order for edge-case tests. */
function makeOrder(overrides: Partial<Order>): Order {
  return {
    customer_id: "TEST",
    name: "Test User",
    tier: "regular",
    order_id: "ORD-TEST",
    item: "Widget",
    category: "home",
    price: 100.0,
    order_date: "2026-05-01",
    delivery_date: "2026-05-10",
    return_request_date: "2026-06-09", // exactly 30 days after delivery
    condition: "unopened",
    damage_source: null,
    reason_for_return: "changed mind",
    prior_refund_count: 0,
    flags: [],
    ...overrides,
  };
}

// Index the seed orders by customer_id for O(1) test lookups.
const byId = Object.fromEntries(SEED_ORDERS.map((o) => [o.customer_id, o]));

// ─── 1. Oracle decisions for all 15 seed orders ──────────────────────────────

describe("evaluatePolicy — 15 seed orders", () => {
  /**
   * Expected table (from the task spec):
   *   C001 approve  39.99  fee 0
   *   C002 approve  38.25  fee 6.75   (opened non-elec, 15%)
   *   C003 approve  89.99  fee 0
   *   C004 deny     0      fee 0      (§2.1 out of window — 35 days)
   *   C005 deny     0      fee 0      (§2.1 day-31 boundary)
   *   C006 approve 360.00  fee 90.00  (opened elec, VIP, 20%)
   *   C007 deny     0      fee 0      (§2.2 final_sale + clearance)
   *   C008 approve 180.00  fee 0      (§2.7 VIP waives non-elec)
   *   C009 approve 110.49  fee 19.50  (opened non-elec, 15%)
   *   C010 approve  60.00  fee 0      (§2.5 in-transit + photo)
   *   C011 escalate  0     fee 0      (§2.5 in-transit no photo)
   *   C012 escalate  0     fee 0      (§2.5 no photo; §2.9 high-value + priors)
   *   C013 deny      0     fee 0      (§2.8 perishable)
   *   C014 escalate  0     fee 0      (§2.9 missing delivery_date)
   *   C015 deny      0     fee 0      (§2.6 abuse_risk + priors ≥3)
   */

  it("C001 — APPROVE full $39.99 (unopened, in-window)", () => {
    const result = evaluatePolicy(byId["C001"]);
    expect(result.decision).toBe("approve");
    expect(result.amount).toBe(39.99);
    expect(result.restocking_fee).toBe(0);
    expect(result.violated_clauses).toEqual([]);
  });

  it("C002 — APPROVE $38.25 with $6.75 restocking fee (opened non-elec, day-30 boundary)", () => {
    const result = evaluatePolicy(byId["C002"]);
    expect(result.decision).toBe("approve");
    expect(result.amount).toBe(38.25);
    expect(result.restocking_fee).toBe(6.75);
    expect(result.violated_clauses).toEqual([]);
  });

  it("C003 — APPROVE full $89.99 (unopened electronics, in-window)", () => {
    const result = evaluatePolicy(byId["C003"]);
    expect(result.decision).toBe("approve");
    expect(result.amount).toBe(89.99);
    expect(result.restocking_fee).toBe(0);
    expect(result.violated_clauses).toEqual([]);
  });

  it("C004 — DENY $0 (§2.1 out-of-window, 35 days)", () => {
    const result = evaluatePolicy(byId["C004"]);
    expect(result.decision).toBe("deny");
    expect(result.amount).toBe(0);
    expect(result.restocking_fee).toBe(0);
    expect(result.violated_clauses).toContain("§2.1");
  });

  it("C005 — DENY $0 (§2.1 day-31 boundary)", () => {
    const result = evaluatePolicy(byId["C005"]);
    expect(result.decision).toBe("deny");
    expect(result.amount).toBe(0);
    expect(result.restocking_fee).toBe(0);
    expect(result.violated_clauses).toContain("§2.1");
  });

  it("C006 — APPROVE $360.00 with $90.00 fee (VIP opened electronics — VIP does NOT waive)", () => {
    const result = evaluatePolicy(byId["C006"]);
    expect(result.decision).toBe("approve");
    expect(result.amount).toBe(360.0);
    expect(result.restocking_fee).toBe(90.0);
    expect(result.violated_clauses).toEqual([]);
  });

  it("C007 — DENY $0 (§2.2 final_sale + clearance category)", () => {
    const result = evaluatePolicy(byId["C007"]);
    expect(result.decision).toBe("deny");
    expect(result.amount).toBe(0);
    expect(result.restocking_fee).toBe(0);
    expect(result.violated_clauses).toContain("§2.2");
  });

  it("C008 — APPROVE full $180.00 (§2.7 VIP waives restocking on opened non-elec)", () => {
    const result = evaluatePolicy(byId["C008"]);
    expect(result.decision).toBe("approve");
    expect(result.amount).toBe(180.0);
    expect(result.restocking_fee).toBe(0);
    expect(result.violated_clauses).toEqual([]);
  });

  it("C009 — APPROVE $110.49 with $19.50 fee (opened non-elec, 15% round-to-cents)", () => {
    const result = evaluatePolicy(byId["C009"]);
    expect(result.decision).toBe("approve");
    expect(result.amount).toBe(110.49);
    expect(result.restocking_fee).toBe(19.50);
    expect(result.violated_clauses).toEqual([]);
  });

  it("C010 — APPROVE full $60.00 (§2.5 in-transit damage WITH photo)", () => {
    const result = evaluatePolicy(byId["C010"]);
    expect(result.decision).toBe("approve");
    expect(result.amount).toBe(60.0);
    expect(result.restocking_fee).toBe(0);
    expect(result.violated_clauses).toEqual([]);
  });

  it("C011 — ESCALATE (§2.5 in-transit damage WITHOUT photo)", () => {
    const result = evaluatePolicy(byId["C011"]);
    expect(result.decision).toBe("escalate");
    expect(result.amount).toBe(0);
    expect(result.restocking_fee).toBe(0);
    expect(result.violated_clauses).toContain("§2.5");
  });

  it("C012 — ESCALATE (in-transit no photo; high-value + priors ≥2)", () => {
    const result = evaluatePolicy(byId["C012"]);
    expect(result.decision).toBe("escalate");
    expect(result.amount).toBe(0);
    expect(result.restocking_fee).toBe(0);
    // C012 hits §2.5 first (damaged in_transit, no photo) but also qualifies for §2.9
    expect(result.violated_clauses.length).toBeGreaterThan(0);
  });

  it("C013 — DENY $0 (§2.8 perishable category)", () => {
    const result = evaluatePolicy(byId["C013"]);
    expect(result.decision).toBe("deny");
    expect(result.amount).toBe(0);
    expect(result.restocking_fee).toBe(0);
    expect(result.violated_clauses).toContain("§2.8");
  });

  it("C014 — ESCALATE $0 (§2.9 missing delivery_date)", () => {
    const result = evaluatePolicy(byId["C014"]);
    expect(result.decision).toBe("escalate");
    expect(result.amount).toBe(0);
    expect(result.restocking_fee).toBe(0);
    expect(result.violated_clauses).toContain("§2.9");
  });

  it("C015 — DENY $0 (§2.6 abuse_risk flag + prior_refund_count ≥3)", () => {
    const result = evaluatePolicy(byId["C015"]);
    expect(result.decision).toBe("deny");
    expect(result.amount).toBe(0);
    expect(result.restocking_fee).toBe(0);
    expect(result.violated_clauses).toContain("§2.6");
  });
});

// ─── 2. Boundary conditions ──────────────────────────────────────────────────

describe("evaluatePolicy — boundary conditions", () => {
  it("exactly 30 days after delivery → IN window → APPROVE", () => {
    // delivery 2026-05-10, request 2026-06-09 = exactly 30 days
    const order = makeOrder({
      delivery_date: "2026-05-10",
      return_request_date: "2026-06-09",
      condition: "unopened",
    });
    const result = evaluatePolicy(order);
    expect(result.decision).toBe("approve");
  });

  it("31 days after delivery → OUT of window → DENY §2.1", () => {
    // delivery 2026-05-10, request 2026-06-10 = 31 days
    const order = makeOrder({
      delivery_date: "2026-05-10",
      return_request_date: "2026-06-10",
      condition: "unopened",
    });
    const result = evaluatePolicy(order);
    expect(result.decision).toBe("deny");
    expect(result.violated_clauses).toContain("§2.1");
  });

  it("VIP opened electronics → 20% restocking fee applies (VIP does NOT waive on electronics)", () => {
    const order = makeOrder({
      tier: "VIP",
      category: "electronics",
      condition: "opened",
      price: 200.0,
      delivery_date: "2026-05-10",
      return_request_date: "2026-05-20", // 10 days in-window
    });
    const result = evaluatePolicy(order);
    expect(result.decision).toBe("approve");
    expect(result.restocking_fee).toBe(40.0); // 20% of 200
    expect(result.amount).toBe(160.0);
  });

  it("VIP opened non-electronics → fee waived → full refund (§2.7)", () => {
    const order = makeOrder({
      tier: "VIP",
      category: "home",
      condition: "opened",
      price: 200.0,
      delivery_date: "2026-05-10",
      return_request_date: "2026-05-20", // 10 days in-window
    });
    const result = evaluatePolicy(order);
    expect(result.decision).toBe("approve");
    expect(result.restocking_fee).toBe(0);
    expect(result.amount).toBe(200.0);
  });

  it("non-VIP opened non-electronics → 15% restocking fee applies", () => {
    const order = makeOrder({
      tier: "regular",
      category: "home",
      condition: "opened",
      price: 200.0,
      delivery_date: "2026-05-10",
      return_request_date: "2026-05-20",
    });
    const result = evaluatePolicy(order);
    expect(result.decision).toBe("approve");
    expect(result.restocking_fee).toBe(30.0); // 15% of 200
    expect(result.amount).toBe(170.0);
  });

  it("final_sale flag alone → DENY §2.2 (even if in-window and unopened)", () => {
    const order = makeOrder({
      flags: ["final_sale"],
      category: "home", // not clearance — tests flag alone
      condition: "unopened",
      delivery_date: "2026-05-10",
      return_request_date: "2026-05-15",
    });
    const result = evaluatePolicy(order);
    expect(result.decision).toBe("deny");
    expect(result.violated_clauses).toContain("§2.2");
  });

  it("clearance category alone → DENY §2.2", () => {
    const order = makeOrder({
      category: "clearance",
      flags: [], // no final_sale flag — tests category alone
      condition: "unopened",
      delivery_date: "2026-05-10",
      return_request_date: "2026-05-15",
    });
    const result = evaluatePolicy(order);
    expect(result.decision).toBe("deny");
    expect(result.violated_clauses).toContain("§2.2");
  });

  it("subscription flag → DENY §2.8", () => {
    const order = makeOrder({
      flags: ["subscription"],
      category: "home",
      condition: "unopened",
      delivery_date: "2026-05-10",
      return_request_date: "2026-05-15",
    });
    const result = evaluatePolicy(order);
    expect(result.decision).toBe("deny");
    expect(result.violated_clauses).toContain("§2.8");
  });

  it("abuse_risk flag → DENY §2.6 (even on VIP in-window order)", () => {
    const order = makeOrder({
      tier: "VIP",
      flags: ["abuse_risk"],
      prior_refund_count: 0, // flag alone is enough
      condition: "unopened",
      delivery_date: "2026-05-10",
      return_request_date: "2026-05-15",
    });
    const result = evaluatePolicy(order);
    expect(result.decision).toBe("deny");
    expect(result.violated_clauses).toContain("§2.6");
  });

  it("prior_refund_count === 3 → DENY §2.6 (at threshold)", () => {
    const order = makeOrder({
      prior_refund_count: 3, // exactly at threshold
      condition: "unopened",
      delivery_date: "2026-05-10",
      return_request_date: "2026-05-15",
    });
    const result = evaluatePolicy(order);
    expect(result.decision).toBe("deny");
    expect(result.violated_clauses).toContain("§2.6");
  });

  it("prior_refund_count === 2 → NOT denied for abuse alone (below threshold 3)", () => {
    // 2 priors on a normal-value order should not hit §2.6
    const order = makeOrder({
      prior_refund_count: 2,
      price: 100.0, // below high_value_threshold
      condition: "unopened",
      delivery_date: "2026-05-10",
      return_request_date: "2026-05-15",
    });
    const result = evaluatePolicy(order);
    // Should not be denied for abuse — 2 < 3
    expect(result.violated_clauses).not.toContain("§2.6");
  });

  it("damaged + damage_source=unknown → ESCALATE §2.9", () => {
    const order = makeOrder({
      condition: "damaged",
      damage_source: "unknown",
      delivery_date: "2026-05-10",
      return_request_date: "2026-05-15",
    });
    const result = evaluatePolicy(order);
    expect(result.decision).toBe("escalate");
    expect(result.violated_clauses).toContain("§2.9");
  });

  it("damaged + damage_source=buyer → DENY §2.3", () => {
    const order = makeOrder({
      condition: "damaged",
      damage_source: "buyer",
      delivery_date: "2026-05-10",
      return_request_date: "2026-05-15",
    });
    const result = evaluatePolicy(order);
    expect(result.decision).toBe("deny");
    expect(result.violated_clauses).toContain("§2.3");
  });

  it("condition=used → DENY §2.3", () => {
    const order = makeOrder({
      condition: "used",
      damage_source: null,
      delivery_date: "2026-05-10",
      return_request_date: "2026-05-15",
    });
    const result = evaluatePolicy(order);
    expect(result.decision).toBe("deny");
    expect(result.violated_clauses).toContain("§2.3");
  });

  it("high-value order (>500) with priors >= 2 → ESCALATE §2.9", () => {
    const order = makeOrder({
      price: 600.0,
      prior_refund_count: 2,
      condition: "unopened",
      delivery_date: "2026-05-10",
      return_request_date: "2026-05-15",
    });
    const result = evaluatePolicy(order);
    expect(result.decision).toBe("escalate");
    expect(result.violated_clauses).toContain("§2.9");
  });

  it("high-value order (>500) with only 1 prior → NOT escalated for that reason alone", () => {
    const order = makeOrder({
      price: 600.0,
      prior_refund_count: 1,
      condition: "unopened",
      delivery_date: "2026-05-10",
      return_request_date: "2026-05-15",
    });
    const result = evaluatePolicy(order);
    // Should approve (in-window, unopened, no other triggers)
    expect(result.decision).toBe("approve");
  });
});

// ─── 3. applyRefundPolicy — the guardrail ────────────────────────────────────

describe("applyRefundPolicy — guardrail contract", () => {
  const c001 = byId["C001"]; // approve 39.99
  const c007 = byId["C007"]; // deny (final_sale)

  it("faithful proposal → oracle decision, overridden=false", () => {
    const outcome = applyRefundPolicy(
      { decision: "approve", reason: "valid return", confidence: 0.9, proposed_amount: 39.99 },
      c001,
    );
    expect(outcome.decision).toBe("approve");
    expect(outcome.amount).toBe(39.99);
    expect(outcome.restocking_fee).toBe(0);
    expect(outcome.overridden).toBe(false);
    expect(outcome.policy_version).toBe(POLICY.version);
  });

  it("HELD LINE: model says approve (confidence 0.99) on final_sale → DENY, overridden=true", () => {
    const outcome = applyRefundPolicy(
      { decision: "approve", confidence: 0.99, reason: "customer wants it", proposed_amount: 34 },
      c007,
    );
    expect(outcome.decision).toBe("deny");
    expect(outcome.amount).toBe(0);
    expect(outcome.overridden).toBe(true);
    expect(outcome.violated_clauses).toContain("§2.2");
  });

  it("proposed_amount is ignored — code computes the money from oracle", () => {
    const outcome = applyRefundPolicy(
      { decision: "approve", confidence: 0.95, reason: "valid", proposed_amount: 9999 },
      c001,
    );
    // The model hallucinated $9999 but the oracle says $39.99
    expect(outcome.amount).toBe(39.99);
    expect(outcome.amount).not.toBe(9999);
  });

  it("low confidence (0.4) → ESCALATE, overridden=true", () => {
    const outcome = applyRefundPolicy(
      { decision: "approve", confidence: 0.4, reason: "i think so", proposed_amount: 39.99 },
      c001,
    );
    expect(outcome.decision).toBe("escalate");
    expect(outcome.amount).toBe(0);
    expect(outcome.overridden).toBe(true);
  });

  it("low confidence at exactly the floor (0.65) → NOT escalated for that reason", () => {
    // confidence_floor = 0.65; at-floor should pass through to oracle
    const outcome = applyRefundPolicy(
      { decision: "approve", confidence: 0.65, reason: "ok", proposed_amount: 39.99 },
      c001,
    );
    // confidence is not below floor; oracle (approve) wins
    expect(outcome.decision).toBe("approve");
    expect(outcome.amount).toBe(39.99);
  });

  it("low confidence (0.64) — just below floor → ESCALATE", () => {
    const outcome = applyRefundPolicy(
      { decision: "approve", confidence: 0.64, reason: "ok", proposed_amount: 39.99 },
      c001,
    );
    expect(outcome.decision).toBe("escalate");
  });

  it("model says escalate on approve case → decision=approve, overridden=true", () => {
    // Model was overly cautious; policy says approve
    const outcome = applyRefundPolicy(
      { decision: "escalate", confidence: 0.8, reason: "unsure", proposed_amount: null },
      c001,
    );
    expect(outcome.decision).toBe("approve");
    expect(outcome.overridden).toBe(true);
  });

  it("amount is always within [0, price] for every seed order with an approve proposal", () => {
    for (const order of SEED_ORDERS) {
      const outcome = applyRefundPolicy(
        { decision: "approve", confidence: 0.9, reason: "test", proposed_amount: order.price },
        order,
      );
      expect(outcome.amount).toBeGreaterThanOrEqual(0);
      expect(outcome.amount).toBeLessThanOrEqual(order.price);
    }
  });

  it("policy_version on all outcomes reflects POLICY.version", () => {
    const outcome = applyRefundPolicy(
      { decision: "approve", confidence: 0.9, reason: "test", proposed_amount: 39.99 },
      c001,
    );
    expect(outcome.policy_version).toBe("1.3");
  });

  it("violated_clauses carries low_confidence signal when confidence is below floor", () => {
    // When escalated for low confidence and the oracle had no violations (clean approve),
    // violated_clauses should include a low_confidence marker.
    const outcome = applyRefundPolicy(
      { decision: "approve", confidence: 0.4, reason: "not sure", proposed_amount: 39.99 },
      c001, // c001 is a clean approve — no violated clauses from oracle
    );
    expect(outcome.decision).toBe("escalate");
    expect(outcome.violated_clauses.length).toBeGreaterThan(0);
  });

  it("confidence is carried through from the proposal", () => {
    const outcome = applyRefundPolicy(
      { decision: "approve", confidence: 0.91, reason: "valid", proposed_amount: 39.99 },
      c001,
    );
    expect(outcome.confidence).toBe(0.91);
  });
});

// ─── 4. policyText ───────────────────────────────────────────────────────────

describe("policyText", () => {
  const text = policyText();

  it("returns a non-empty string", () => {
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(100);
  });

  it("mentions the 30-day return window", () => {
    expect(text).toMatch(/30.?day/i);
  });

  it("mentions the 15% opened restocking fee", () => {
    expect(text).toMatch(/15%/);
  });

  it("mentions the 20% electronics restocking fee", () => {
    expect(text).toMatch(/20%/);
  });

  it("mentions final_sale / clearance as non-returnable (§2.2)", () => {
    expect(text).toMatch(/§2\.2/);
  });

  it("mentions the in-transit damage + photo rule (§2.5)", () => {
    expect(text).toMatch(/§2\.5/);
  });

  it("mentions the abuse / prior refund rule (§2.6)", () => {
    expect(text).toMatch(/§2\.6/);
  });

  it("mentions VIP restocking waiver (§2.7)", () => {
    expect(text).toMatch(/§2\.7/);
  });

  it("mentions perishable / subscription rule (§2.8)", () => {
    expect(text).toMatch(/§2\.8/);
  });

  it("dynamically reflects POLICY numeric values", () => {
    // These match the live POLICY constants so changing POLICY changes the prompt.
    expect(text).toContain(String(POLICY.return_window_days));
    expect(text).toContain(String(POLICY.abuse_prior_threshold));
  });
});
