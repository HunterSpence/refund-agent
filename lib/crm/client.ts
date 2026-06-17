/**
 * lib/crm/client.ts
 *
 * `MockCrmAdapter` — the in-memory CRM implementation backed by the 16-profile
 * seed in `data.ts`. Implements `CrmAdapter` with async signatures to mirror a
 * real networked CRM, but resolves synchronously (no I/O, no faults).
 *
 * Exported singleton `crm` is what the agent tools and tests import.
 *
 * Out of scope for this task (explicitly): fault injection, retries, 503
 * simulation. Those belong to integration/chaos tests, not the seed layer.
 */

import type { CrmAdapter } from "@/lib/crm/adapter";
import type { Order } from "@/lib/types";
import { SEED_ORDERS } from "@/lib/crm/data";

// Build an index once at module-load time for O(1) lookups.
const ORDER_INDEX: ReadonlyMap<string, Order> = new Map(
  SEED_ORDERS.map((o) => [o.order_id, o]),
);

/**
 * Normalize free text for item matching: lowercase, strip punctuation to spaces,
 * collapse whitespace. e.g. 'Pro Laptop 16"' → "pro laptop 16".
 */
function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export class MockCrmAdapter implements CrmAdapter {
  /**
   * Look up a single order by its order_id.
   * Resolves to `null` if the id is not in the seed.
   *
   * The shallow spread (`{ ...order }`) returns a new object on each call so
   * callers cannot accidentally mutate the canonical seed entry. The `flags`
   * array is also sliced so mutating the returned array doesn't corrupt the
   * index.
   */
  async getOrder(orderId: string): Promise<Order | null> {
    const order = ORDER_INDEX.get(orderId) ?? null;
    if (order === null) return null;
    return { ...order, flags: [...order.flags] };
  }

  /**
   * Return all 16 seed orders as a shallow-copied array.
   * Spreading each order ensures mutations to returned objects do not affect
   * the internal index; spreading the array ensures push/pop on the returned
   * array does not affect `SEED_ORDERS`.
   */
  async getAllOrders(): Promise<Order[]> {
    return SEED_ORDERS.map((o) => ({ ...o, flags: [...o.flags] }));
  }

  /**
   * Resolve an order from a free-text item description (no order_id).
   *
   * Two-tier match, most-specific first:
   *   1. Full item-name substring — the order's item name appears verbatim in
   *      the query ("yoga mat" ⊂ "i'd like to return my yoga mat"). When several
   *      match, the LONGEST item name wins (most specific).
   *   2. Token overlap — count an item's significant tokens (length ≥ 3) that
   *      appear in the query ("headphones" → "Bluetooth Headphones"; "laptop" →
   *      'Pro Laptop 16"'). Highest count wins; ties resolve to seed order.
   *
   * Returns a defensive copy (same contract as getOrder) or null if nothing
   * matches. Deterministic: no clock, no randomness — same query → same order.
   */
  async findOrderByItem(query: string): Promise<Order | null> {
    const q = normalizeText(query);
    if (!q) return null;

    // ── Tier 1: full item-name substring (strongest signal) ──────────────────
    let best: Order | null = null;
    let bestLen = 0;
    for (const o of SEED_ORDERS) {
      const item = normalizeText(o.item);
      if (item && q.includes(item) && item.length > bestLen) {
        best = o;
        bestLen = item.length;
      }
    }
    if (best) return { ...best, flags: [...best.flags] };

    // ── Tier 2: significant-token overlap ────────────────────────────────────
    const queryTokens = new Set(q.split(" ").filter(Boolean));
    let bestScore = 0;
    for (const o of SEED_ORDERS) {
      const itemTokens = normalizeText(o.item)
        .split(" ")
        .filter((t) => t.length >= 3);
      if (itemTokens.length === 0) continue;
      const score = itemTokens.filter((t) => queryTokens.has(t)).length;
      if (score > bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best ? { ...best, flags: [...best.flags] } : null;
  }
}

/**
 * Default singleton — import this everywhere.
 *
 * SWAP_ME: to use a real CRM adapter, change this line to:
 *   export const crm: CrmAdapter = new ShopifyAdapter({ ... });
 */
export const crm: CrmAdapter = new MockCrmAdapter();
