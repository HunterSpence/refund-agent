/**
 * tests/policy-retailer-b.test.ts
 *
 * Differential test proving that POLICY_RETAILER_B is a drop-in alternate
 * config that produces materially different outcomes from POLICY without any
 * changes to the engine.
 *
 * This is the "configurable policy primitive" demo: same evaluatePolicy()
 * function, same Order, different outcomes depending on which config you pass.
 *
 * Three differential axes exercised:
 *   1. Return window — 20 days: in-window for POLICY (30d), out for B (14d).
 *   2. VIP restocking waiver — POLICY waives for non-electronics; Retailer B
 *      does not (vip_waives_restocking_non_electronics: false).
 *   3. Restocking rate — opened electronics: 20% (POLICY) vs 25% (B).
 *
 * Plus a 4th assertion that policyText is config-driven (B's text contains
 * "14" for the window and differs from the default policy text).
 */

import { describe, it, expect } from "vitest";
import {
  POLICY,
  POLICY_RETAILER_B,
  evaluatePolicy,
  policyText,
} from "@/lib/agent/policy";
import type { Order } from "@/lib/types";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal valid Order with controlled dates and sensible defaults. */
function makeOrder(overrides: Partial<Order>): Order {
  return {
    customer_id: "TEST-B",
    name: "Test User",
    tier: "regular",
    order_id: "ORD-TEST-B",
    item: "Widget",
    category: "home",
    price: 100.0,
    order_date: "2026-05-01",
    delivery_date: "2026-05-01",
    return_request_date: "2026-05-21", // 20 days after delivery_date
    condition: "unopened",
    damage_source: null,
    reason_for_return: "changed mind",
    prior_refund_count: 0,
    flags: [],
    ...overrides,
  };
}

// ─── Differential tests ──────────────────────────────────────────────────────

describe("POLICY_RETAILER_B — differential behaviour vs POLICY", () => {
  /**
   * Axis 1 — Return window (30d vs 14d).
   *
   * Order delivered 2026-05-01, return requested 2026-05-21 = 20 days.
   * POLICY (30d window): 20 ≤ 30 → in-window → approve.
   * POLICY_RETAILER_B (14d window): 20 > 14 → out-of-window → deny §2.1.
   */
  it("axis 1 — same 20-day-old return: POLICY approves, Retailer B denies (§2.1)", () => {
    const order = makeOrder({
      delivery_date: "2026-05-01",
      return_request_date: "2026-05-21", // 20 days after delivery
      condition: "unopened",
      tier: "regular",
    });

    const defaultResult = evaluatePolicy(order, POLICY);
    expect(defaultResult.decision).toBe("approve");
    expect(defaultResult.amount).toBe(100.0);
    expect(defaultResult.violated_clauses).toEqual([]);

    const bResult = evaluatePolicy(order, POLICY_RETAILER_B);
    expect(bResult.decision).toBe("deny");
    expect(bResult.amount).toBe(0);
    expect(bResult.violated_clauses).toContain("§2.1");
  });

  /**
   * Axis 2 — VIP restocking waiver on opened non-electronics.
   *
   * 5-day window: in-window for both policies (both ≥14d).
   * POLICY: vip_waives_restocking_non_electronics = true → fee 0, full refund.
   * POLICY_RETAILER_B: false → 25% restocking fee applied.
   *
   * Item price: $200.00
   *   POLICY:   amount = 200.00 (fee waived for VIP §2.7)
   *   Retailer B: rate 0.25 → amount = round2(200 * 0.75) = 150.00, fee = 50.00
   */
  it("axis 2 — VIP opened non-electronics: POLICY waives fee, Retailer B charges 25%", () => {
    const order = makeOrder({
      tier: "VIP",
      category: "home",
      condition: "opened",
      price: 200.0,
      delivery_date: "2026-05-01",
      return_request_date: "2026-05-06", // 5 days — in-window for both
    });

    const defaultResult = evaluatePolicy(order, POLICY);
    expect(defaultResult.decision).toBe("approve");
    expect(defaultResult.restocking_fee).toBe(0); // fee waived §2.7
    expect(defaultResult.amount).toBe(200.0); // full refund

    const bResult = evaluatePolicy(order, POLICY_RETAILER_B);
    expect(bResult.decision).toBe("approve");
    expect(bResult.restocking_fee).toBeGreaterThan(0); // fee IS charged
    expect(bResult.amount).toBe(150.0); // 200 * 0.75
    expect(bResult.restocking_fee).toBe(50.0); // 200 * 0.25
  });

  /**
   * Axis 3 — Restocking rate divergence on opened electronics.
   *
   * 5-day window: in-window for both.
   * POLICY:   opened_electronics = 0.20 → amount = price * 0.80
   * Retailer B: opened_electronics = 0.25 → amount = price * 0.75
   *
   * Item price: $200.00
   *   POLICY:   amount = 160.00, fee = 40.00
   *   Retailer B: amount = 150.00, fee = 50.00
   */
  it("axis 3 — opened electronics: POLICY 20% fee ($40), Retailer B 25% fee ($50)", () => {
    const order = makeOrder({
      tier: "regular",
      category: "electronics",
      condition: "opened",
      price: 200.0,
      delivery_date: "2026-05-01",
      return_request_date: "2026-05-06", // 5 days — in-window for both
    });

    const defaultResult = evaluatePolicy(order, POLICY);
    expect(defaultResult.decision).toBe("approve");
    expect(defaultResult.restocking_fee).toBe(40.0); // 20% of 200
    expect(defaultResult.amount).toBe(160.0); // 200 * 0.80

    const bResult = evaluatePolicy(order, POLICY_RETAILER_B);
    expect(bResult.decision).toBe("approve");
    expect(bResult.restocking_fee).toBe(50.0); // 25% of 200
    expect(bResult.amount).toBe(150.0); // 200 * 0.75

    // The amounts are distinct — same engine, different rates.
    expect(defaultResult.amount).not.toBe(bResult.amount);
    expect(defaultResult.restocking_fee).not.toBe(bResult.restocking_fee);
  });

  /**
   * Axis 4 — policyText is config-driven.
   *
   * The rendered prompt for Retailer B must contain "14" (its return window)
   * and must differ from the default policy text, proving that policyText()
   * reads the config rather than being hardcoded.
   */
  it("axis 4 — policyText(POLICY_RETAILER_B) contains '14' and differs from policyText(POLICY)", () => {
    const defaultText = policyText(POLICY);
    const bText = policyText(POLICY_RETAILER_B);

    expect(bText).toContain("14"); // Retailer B return window days
    expect(bText).not.toBe(defaultText); // texts are distinct
    expect(bText.length).toBeGreaterThan(100); // non-trivial output
  });
});
