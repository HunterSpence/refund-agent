/**
 * lib/crm/data.ts
 *
 * The 16 canonical seed orders (C001–C016) used by the mock CRM, the policy-engine
 * evals, and the UI scenario picker. The first 15 cover every policy branch; C016 is
 * a high-value order that demonstrates the >$500 human-in-the-loop approval gate.
 *
 * Each entry carries a one-line reviewer comment (after the closing brace) that
 * states the INTENDED decision and the governing policy clause(s). These comments
 * are the contract between the seed and the policy-engine tests written in Task 1.3+.
 *
 * Authoring conventions:
 *   - Dates are ISO YYYY-MM-DD; the policy engine reasons in whole UTC days.
 *   - `order_date` is set 3–7 days before `delivery_date` (realistic shipping window).
 *   - `photo_evidence` is omitted (undefined) when not applicable (non-damaged items).
 *   - `damage_source` is null for every non-damaged item.
 *   - Money is USD dollars-as-number; see `lib/types.ts` design note.
 */

import type { Order } from "@/lib/types";

export const SEED_ORDERS: Order[] = [
  // ─── C001 ───────────────────────────────────────────────────────────────────
  {
    customer_id: "C001",
    name: "Nadia",
    tier: "regular",
    order_id: "ORD-1001",
    item: "Wireless Mouse",
    category: "electronics",
    price: 39.99,
    order_date: "2026-05-13",       // 7 days before delivery
    delivery_date: "2026-05-20",
    return_request_date: "2026-05-25",
    condition: "unopened",
    damage_source: null,
    reason_for_return: "found cheaper",
    prior_refund_count: 0,
    flags: [],
  },
  // INTENDED: APPROVE full $39.99 — §2.1 in-window (5 days) + §2.3 unopened → no restocking fee

  // ─── C002 ───────────────────────────────────────────────────────────────────
  {
    customer_id: "C002",
    name: "Tom",
    tier: "new",
    order_id: "ORD-1002",
    item: "Yoga Mat",
    category: "home",
    price: 45.00,
    order_date: "2026-04-24",       // 7 days before delivery
    delivery_date: "2026-05-01",
    return_request_date: "2026-05-31",
    condition: "opened",
    damage_source: null,
    reason_for_return: "didn't like it",
    prior_refund_count: 0,
    flags: [],
  },
  // INTENDED: APPROVE −15% = $38.25 — §2.3 opened non-electronics; DAY-30 boundary = IN window

  // ─── C003 ───────────────────────────────────────────────────────────────────
  {
    customer_id: "C003",
    name: "Alice",
    tier: "regular",
    order_id: "ORD-1042",
    item: "Bluetooth Headphones",
    category: "electronics",
    price: 89.99,
    order_date: "2026-04-29",       // 6 days before delivery
    delivery_date: "2026-05-05",
    return_request_date: "2026-05-18",
    condition: "unopened",
    damage_source: null,
    reason_for_return: "changed mind",
    prior_refund_count: 0,
    flags: [],
  },
  // INTENDED: APPROVE full $89.99 — §2.3 unopened → full refund even for electronics

  // ─── C004 ───────────────────────────────────────────────────────────────────
  {
    customer_id: "C004",
    name: "Ravi",
    tier: "regular",
    order_id: "ORD-1004",
    item: "Standing Desk",
    category: "home",
    price: 320.00,
    order_date: "2026-04-04",       // 6 days before delivery
    delivery_date: "2026-04-10",
    return_request_date: "2026-05-15",
    condition: "unopened",
    damage_source: null,
    reason_for_return: "no longer needed",
    prior_refund_count: 0,
    flags: [],
  },
  // INTENDED: DENY — §2.1 out of 30-day window (35 days between delivery and return request)

  // ─── C005 ───────────────────────────────────────────────────────────────────
  {
    customer_id: "C005",
    name: "Lena",
    tier: "regular",
    order_id: "ORD-1005",
    item: "Coffee Maker",
    category: "home",
    price: 75.00,
    order_date: "2026-04-24",       // 7 days before delivery
    delivery_date: "2026-05-01",
    return_request_date: "2026-06-01",
    condition: "opened",
    damage_source: null,
    reason_for_return: "changed mind",
    prior_refund_count: 0,
    flags: [],
  },
  // INTENDED: DENY — §2.1 DAY-31 boundary = OUT of 30-day window (31 days)

  // ─── C006 ───────────────────────────────────────────────────────────────────
  {
    customer_id: "C006",
    name: "Priya",
    tier: "VIP",
    order_id: "ORD-1006",
    item: "4K Monitor",
    category: "electronics",
    price: 450.00,
    order_date: "2026-05-22",       // 6 days before delivery
    delivery_date: "2026-05-28",
    return_request_date: "2026-06-05",
    condition: "opened",
    damage_source: null,
    reason_for_return: "didn't like it",
    prior_refund_count: 1,
    flags: [],
  },
  // INTENDED: APPROVE −20% = $360.00 — §2.3 opened electronics; §2.7 VIP does NOT waive restocking on electronics

  // ─── C007 ───────────────────────────────────────────────────────────────────
  {
    customer_id: "C007",
    name: "Derek",
    tier: "new",
    order_id: "ORD-2210",
    item: "Clearance Floor Lamp",
    category: "clearance",
    price: 34.00,
    order_date: "2026-05-08",       // 6 days before delivery
    delivery_date: "2026-05-14",
    return_request_date: "2026-06-10",
    condition: "used",
    damage_source: "buyer",
    reason_for_return: "changed mind",
    prior_refund_count: 0,
    flags: ["final_sale"],
  },
  // INTENDED: DENY — §2.2 final-sale/clearance items are non-returnable regardless of condition

  // ─── C008 ───────────────────────────────────────────────────────────────────
  {
    customer_id: "C008",
    name: "Grace",
    tier: "VIP",
    order_id: "ORD-1008",
    item: "Cashmere Sweater",
    category: "apparel",
    price: 180.00,
    order_date: "2026-05-15",       // 5 days before delivery
    delivery_date: "2026-05-20",
    return_request_date: "2026-05-30",
    condition: "opened",
    damage_source: null,
    reason_for_return: "wrong size",
    prior_refund_count: 0,
    flags: [],
  },
  // INTENDED: APPROVE full $180.00 — §2.7 VIP waives restocking fee on opened NON-electronics → full refund

  // ─── C009 ───────────────────────────────────────────────────────────────────
  {
    customer_id: "C009",
    name: "Maria",
    tier: "regular",
    order_id: "ORD-3301",
    item: "Air Fryer",
    category: "home",
    price: 129.99,
    order_date: "2026-05-19",       // 5 days before delivery
    delivery_date: "2026-05-24",
    return_request_date: "2026-06-08",
    condition: "opened",
    damage_source: null,
    reason_for_return: "changed mind",
    prior_refund_count: 0,
    flags: [],
  },
  // INTENDED: APPROVE −15% = $110.49 — §2.3 opened non-electronics; round-to-cents: 129.99 * 0.85 = 110.4915 → $110.49

  // ─── C010 ───────────────────────────────────────────────────────────────────
  {
    customer_id: "C010",
    name: "Owen",
    tier: "regular",
    order_id: "ORD-1010",
    item: "Ceramic Vase",
    category: "home",
    price: 60.00,
    order_date: "2026-05-27",       // 5 days before delivery
    delivery_date: "2026-06-01",
    return_request_date: "2026-06-09",
    condition: "damaged",
    damage_source: "in_transit",
    photo_evidence: true,
    reason_for_return: "arrived broken",
    prior_refund_count: 0,
    flags: [],
  },
  // INTENDED: APPROVE full $60.00 — §2.5 in-transit damage WITH photo evidence → full refund

  // ─── C011 ───────────────────────────────────────────────────────────────────
  {
    customer_id: "C011",
    name: "Bianca",
    tier: "regular",
    order_id: "ORD-1011",
    item: "Glass Blender",
    category: "home",
    price: 95.00,
    order_date: "2026-05-29",       // 5 days before delivery
    delivery_date: "2026-06-03",
    return_request_date: "2026-06-10",
    condition: "damaged",
    damage_source: "in_transit",
    photo_evidence: false,
    reason_for_return: "broken",
    prior_refund_count: 0,
    flags: [],
  },
  // INTENDED: ESCALATE — §2.5 in-transit damage WITHOUT photo evidence → escalate for manual review

  // ─── C012 ───────────────────────────────────────────────────────────────────
  {
    customer_id: "C012",
    name: "Sam",
    tier: "VIP",
    order_id: "ORD-4455",
    item: "DSLR Camera",
    category: "electronics",
    price: 899.00,
    order_date: "2026-05-27",       // 6 days before delivery
    delivery_date: "2026-06-02",
    return_request_date: "2026-06-03",
    condition: "damaged",
    damage_source: "in_transit",
    photo_evidence: false,
    reason_for_return: "damaged",
    prior_refund_count: 2,
    flags: [],
  },
  // INTENDED: ESCALATE — §2.9 in-transit without photo; high-value order >$500 with priors ≥2 → escalate

  // ─── C013 ───────────────────────────────────────────────────────────────────
  {
    customer_id: "C013",
    name: "Felix",
    tier: "new",
    order_id: "ORD-1013",
    item: "Protein Powder",
    category: "perishable",
    price: 40.00,
    order_date: "2026-05-27",       // 5 days before delivery
    delivery_date: "2026-06-01",
    return_request_date: "2026-06-05",
    condition: "opened",
    damage_source: null,
    reason_for_return: "didn't like taste",
    prior_refund_count: 0,
    flags: [],
  },
  // INTENDED: DENY — §2.8 perishable items are non-returnable regardless of reason

  // ─── C014 ───────────────────────────────────────────────────────────────────
  {
    customer_id: "C014",
    name: "Dana",
    tier: "regular",
    order_id: "ORD-1014",
    item: "Smart Speaker",
    category: "electronics",
    price: 129.00,
    order_date: "2026-06-06",       // plausible order date; delivery never confirmed
    delivery_date: null,
    return_request_date: "2026-06-10",
    condition: "unopened",
    damage_source: null,
    reason_for_return: "want to cancel",
    prior_refund_count: 0,
    flags: [],
  },
  // INTENDED: ESCALATE — §2.9 missing delivery_date is a data-integrity gap → escalate for manual review

  // ─── C015 ───────────────────────────────────────────────────────────────────
  {
    customer_id: "C015",
    name: "Jordan",
    tier: "regular",
    order_id: "ORD-5891",
    item: "Running Shoes",
    category: "apparel",
    price: 145.00,
    order_date: "2026-03-31",       // 6 days before delivery
    delivery_date: "2026-04-06",
    return_request_date: "2026-06-12",
    condition: "used",
    damage_source: "buyer",
    reason_for_return: "want money back",
    prior_refund_count: 4,
    flags: ["abuse_risk"],
  },
  // INTENDED: DENY — §2.6 abuse_risk flag OR priors ≥3 → deny; also §2.1 window exceeded (67 days)

  // ─── C016 ───────────────────────────────────────────────────────────────────
  {
    customer_id: "C016",
    name: "Mateo",
    tier: "regular",
    order_id: "ORD-6700",
    item: 'Pro Laptop 16"',
    category: "electronics",
    price: 1499.00,
    order_date: "2026-06-01",
    delivery_date: "2026-06-05",
    return_request_date: "2026-06-12", // 7 days — in-window
    condition: "unopened",
    damage_source: null,
    reason_for_return: "changed mind",
    prior_refund_count: 0,
    flags: [],
  },
  // INTENDED: APPROVE full $1499 — unopened, in-window (§2.3); priors 0 so no §2.9
  // high-value escalation. Refund > $500 → triggers the human-in-the-loop ApprovalCard
  // (high-value payout requires manual sign-off). Demo seed for that flow.
];
