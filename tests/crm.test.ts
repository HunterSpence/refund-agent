/**
 * tests/crm.test.ts
 *
 * Seed-integrity + adapter-behaviour tests for the mock CRM layer.
 *
 * Scope: structure and data correctness ONLY — no policy decisions here.
 * Policy correctness is verified by the policy-engine tests (Task 1.3+).
 *
 * Run: pnpm test:run -- tests/crm.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import type { Order, CustomerTier, ProductCategory, ItemCondition, DamageSource, OrderFlag } from "@/lib/types";
import { crm } from "@/lib/crm/client";
import { SEED_ORDERS } from "@/lib/crm/data";

// ─── helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the number of whole UTC days between two ISO YYYY-MM-DD strings.
 * Does NOT use the system clock — purely arithmetic on parsed dates.
 */
function daysBetween(from: string, to: string): number {
  const MS_PER_DAY = 86_400_000;
  const a = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10)),
  );
  return Math.round((b - a) / MS_PER_DAY);
}

// Valid enum sets (mirrors lib/types.ts — kept local to avoid tight coupling)
const VALID_TIERS = new Set<CustomerTier>(["new", "regular", "VIP"]);
const VALID_CATEGORIES = new Set<ProductCategory>(["electronics", "apparel", "home", "clearance", "perishable"]);
const VALID_CONDITIONS = new Set<ItemCondition>(["unopened", "opened", "used", "damaged"]);
const VALID_DAMAGE_SOURCES = new Set<DamageSource | null>(["in_transit", "buyer", "unknown", null]);
const VALID_FLAGS = new Set<OrderFlag>(["final_sale", "abuse_risk", "gift", "subscription"]);

// ─── seed-integrity tests ──────────────────────────────────────────────────────

describe("SEED_ORDERS — structural integrity", () => {
  it("contains exactly 16 orders", () => {
    expect(SEED_ORDERS).toHaveLength(16);
  });

  it("has unique customer_id values across all orders", () => {
    const ids = SEED_ORDERS.map((o) => o.customer_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(16);
  });

  it("has unique order_id values across all orders", () => {
    const ids = SEED_ORDERS.map((o) => o.order_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(16);
  });

  it("every order has a valid tier enum value", () => {
    for (const order of SEED_ORDERS) {
      expect(VALID_TIERS.has(order.tier), `${order.order_id} tier="${order.tier}"`).toBe(true);
    }
  });

  it("every order has a valid category enum value", () => {
    for (const order of SEED_ORDERS) {
      expect(VALID_CATEGORIES.has(order.category), `${order.order_id} category="${order.category}"`).toBe(true);
    }
  });

  it("every order has a valid condition enum value", () => {
    for (const order of SEED_ORDERS) {
      expect(VALID_CONDITIONS.has(order.condition), `${order.order_id} condition="${order.condition}"`).toBe(true);
    }
  });

  it("every order has a valid damage_source value", () => {
    for (const order of SEED_ORDERS) {
      expect(
        VALID_DAMAGE_SOURCES.has(order.damage_source),
        `${order.order_id} damage_source="${order.damage_source}"`,
      ).toBe(true);
    }
  });

  it("unopened and opened orders have damage_source === null", () => {
    // The `damage_source` field is null when the item is unopened or opened —
    // neither damaged nor simply worn/used by the buyer. Items with condition
    // "used" may carry a "buyer" source (e.g. C007, C015), and items with
    // condition "damaged" must carry a non-null source. This matches the seed
    // and the `DamageSource` type comment in lib/types.ts.
    for (const order of SEED_ORDERS) {
      if (order.condition === "unopened" || order.condition === "opened") {
        expect(
          order.damage_source,
          `${order.order_id} (condition=${order.condition}) should have null damage_source`,
        ).toBeNull();
      }
    }
  });

  it("every order has a positive price", () => {
    for (const order of SEED_ORDERS) {
      expect(order.price, `${order.order_id} price=${order.price}`).toBeGreaterThan(0);
    }
  });

  it("every flag in every order is a valid OrderFlag", () => {
    for (const order of SEED_ORDERS) {
      for (const flag of order.flags) {
        expect(VALID_FLAGS.has(flag), `${order.order_id} flag="${flag}"`).toBe(true);
      }
    }
  });
});

// ─── spot-check specific profiles ─────────────────────────────────────────────

describe("SEED_ORDERS — profile spot-checks", () => {
  let byId: Map<string, Order>;

  beforeAll(() => {
    byId = new Map(SEED_ORDERS.map((o) => [o.order_id, o]));
  });

  it("C003 Alice — ORD-1042 bluetooth headphones, $89.99, unopened, electronics, regular", () => {
    const o = byId.get("ORD-1042");
    expect(o).toBeDefined();
    expect(o!.customer_id).toBe("C003");
    expect(o!.name).toBe("Alice");
    expect(o!.tier).toBe("regular");
    expect(o!.item).toBe("Bluetooth Headphones");
    expect(o!.category).toBe("electronics");
    expect(o!.price).toBe(89.99);
    expect(o!.condition).toBe("unopened");
    expect(o!.damage_source).toBeNull();
    expect(o!.flags).toEqual([]);
  });

  it("C009 Maria — ORD-3301 air fryer, $129.99, opened, home", () => {
    const o = byId.get("ORD-3301");
    expect(o).toBeDefined();
    expect(o!.customer_id).toBe("C009");
    expect(o!.name).toBe("Maria");
    expect(o!.tier).toBe("regular");
    expect(o!.item).toBe("Air Fryer");
    expect(o!.category).toBe("home");
    expect(o!.price).toBe(129.99);
    expect(o!.condition).toBe("opened");
    expect(o!.damage_source).toBeNull();
  });

  it("C012 Sam — ORD-4455 DSLR camera, $899.00, VIP, damaged in-transit, 2 priors", () => {
    const o = byId.get("ORD-4455");
    expect(o).toBeDefined();
    expect(o!.customer_id).toBe("C012");
    expect(o!.name).toBe("Sam");
    expect(o!.tier).toBe("VIP");
    expect(o!.item).toBe("DSLR Camera");
    expect(o!.category).toBe("electronics");
    expect(o!.price).toBe(899.00);
    expect(o!.condition).toBe("damaged");
    expect(o!.damage_source).toBe("in_transit");
    expect(o!.photo_evidence).toBe(false);
    expect(o!.prior_refund_count).toBe(2);
  });

  it("C015 Jordan — ORD-5891 running shoes, abuse_risk flag, 4 priors, used, buyer damage", () => {
    const o = byId.get("ORD-5891");
    expect(o).toBeDefined();
    expect(o!.customer_id).toBe("C015");
    expect(o!.name).toBe("Jordan");
    expect(o!.tier).toBe("regular");
    expect(o!.item).toBe("Running Shoes");
    expect(o!.category).toBe("apparel");
    expect(o!.price).toBe(145.00);
    expect(o!.condition).toBe("used");
    expect(o!.damage_source).toBe("buyer");
    expect(o!.flags).toContain("abuse_risk");
    expect(o!.prior_refund_count).toBe(4);
  });

  it("C007 Derek — ORD-2210 clearance floor lamp, final_sale flag", () => {
    const o = byId.get("ORD-2210");
    expect(o).toBeDefined();
    expect(o!.customer_id).toBe("C007");
    expect(o!.name).toBe("Derek");
    expect(o!.tier).toBe("new");
    expect(o!.category).toBe("clearance");
    expect(o!.flags).toContain("final_sale");
    expect(o!.condition).toBe("used");
    expect(o!.damage_source).toBe("buyer");
  });
});

// ─── boundary-coverage assertions ─────────────────────────────────────────────

describe("SEED_ORDERS — boundary coverage", () => {
  let byId: Map<string, Order>;

  beforeAll(() => {
    byId = new Map(SEED_ORDERS.map((o) => [o.order_id, o]));
  });

  it("C002 (Tom, Yoga Mat) has exactly 30 days between delivery and return request", () => {
    const o = byId.get("ORD-1002");
    expect(o).toBeDefined();
    expect(o!.delivery_date).not.toBeNull();
    const days = daysBetween(o!.delivery_date!, o!.return_request_date);
    expect(days).toBe(30);
  });

  it("C005 (Lena, Coffee Maker) has exactly 31 days between delivery and return request", () => {
    const o = byId.get("ORD-1005");
    expect(o).toBeDefined();
    expect(o!.delivery_date).not.toBeNull();
    const days = daysBetween(o!.delivery_date!, o!.return_request_date);
    expect(days).toBe(31);
  });

  it("C014 (Dana, Smart Speaker) has delivery_date === null", () => {
    const o = byId.get("ORD-1014");
    expect(o).toBeDefined();
    expect(o!.delivery_date).toBeNull();
  });

  it("C010 (Owen, Ceramic Vase) has in-transit damage WITH photo_evidence === true", () => {
    const o = byId.get("ORD-1010");
    expect(o).toBeDefined();
    expect(o!.condition).toBe("damaged");
    expect(o!.damage_source).toBe("in_transit");
    expect(o!.photo_evidence).toBe(true);
  });

  it("C011 (Bianca, Glass Blender) has in-transit damage WITH photo_evidence === false", () => {
    const o = byId.get("ORD-1011");
    expect(o).toBeDefined();
    expect(o!.condition).toBe("damaged");
    expect(o!.damage_source).toBe("in_transit");
    expect(o!.photo_evidence).toBe(false);
  });
});

// ─── adapter behaviour tests ───────────────────────────────────────────────────

describe("MockCrmAdapter — adapter behaviour", () => {
  it("getOrder('ORD-3301') resolves to Maria's order", async () => {
    const order = await crm.getOrder("ORD-3301");
    expect(order).not.toBeNull();
    expect(order!.customer_id).toBe("C009");
    expect(order!.name).toBe("Maria");
    expect(order!.item).toBe("Air Fryer");
  });

  it("getOrder('NOPE') resolves to null", async () => {
    const order = await crm.getOrder("NOPE");
    expect(order).toBeNull();
  });

  it("getAllOrders() resolves to all 16 orders", async () => {
    const orders = await crm.getAllOrders();
    expect(orders).toHaveLength(16);
  });

  it("getAllOrders() returns a stable snapshot (same length on repeated calls)", async () => {
    const a = await crm.getAllOrders();
    const b = await crm.getAllOrders();
    expect(a).toHaveLength(b.length);
  });

  it("getAllOrders() returns distinct object references from the seed (defensive copy)", async () => {
    // Mutating the returned array must not corrupt the adapter's internal state.
    const orders = await crm.getAllOrders();
    const originalLength = orders.length;
    (orders as Order[]).push({} as Order); // mutate
    const orders2 = await crm.getAllOrders();
    expect(orders2).toHaveLength(originalLength);
  });
});

// ─── findOrderByItem — resolve by item description (voice / no order_id) ────────

describe("MockCrmAdapter — findOrderByItem", () => {
  it("resolves a natural spoken request to the matching order", async () => {
    // The voice path: customer says what they want to return, no order number.
    const order = await crm.findOrderByItem("I'd like to return my yoga mat");
    expect(order).not.toBeNull();
    expect(order!.order_id).toBe("ORD-1002");
    expect(order!.item).toBe("Yoga Mat");
    expect(order!.customer_id).toBe("C002");
  });

  it("is case-insensitive and tolerates surrounding words", async () => {
    const order = await crm.findOrderByItem("can I please RETURN the Yoga Mat I bought");
    expect(order?.order_id).toBe("ORD-1002");
  });

  it("matches on a single significant token (partial item name)", async () => {
    // "headphones" → "Bluetooth Headphones" (ORD-1042, Alice).
    const headphones = await crm.findOrderByItem("the headphones");
    expect(headphones?.order_id).toBe("ORD-1042");
    // "laptop" → 'Pro Laptop 16"' (ORD-6700, Mateo).
    const laptop = await crm.findOrderByItem("I want to send back my laptop");
    expect(laptop?.order_id).toBe("ORD-6700");
  });

  it("returns null when nothing matches", async () => {
    const order = await crm.findOrderByItem("a flux capacitor");
    expect(order).toBeNull();
  });

  it("returns null for empty / whitespace queries", async () => {
    expect(await crm.findOrderByItem("")).toBeNull();
    expect(await crm.findOrderByItem("   ")).toBeNull();
  });

  it("returns a defensive copy (mutating the result does not corrupt the seed)", async () => {
    const order = await crm.findOrderByItem("yoga mat");
    expect(order).not.toBeNull();
    order!.flags.push("abuse_risk");
    const again = await crm.findOrderByItem("yoga mat");
    expect(again!.flags).toEqual([]);
  });
});
