/**
 * lib/crm/client.ts
 *
 * `MockCrmAdapter` — the in-memory CRM implementation backed by the 15-profile
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
   * Return all 15 seed orders as a shallow-copied array.
   * Spreading each order ensures mutations to returned objects do not affect
   * the internal index; spreading the array ensures push/pop on the returned
   * array does not affect `SEED_ORDERS`.
   */
  async getAllOrders(): Promise<Order[]> {
    return SEED_ORDERS.map((o) => ({ ...o, flags: [...o.flags] }));
  }
}

/**
 * Default singleton — import this everywhere.
 *
 * SWAP_ME: to use a real CRM adapter, change this line to:
 *   export const crm: CrmAdapter = new ShopifyAdapter({ ... });
 */
export const crm: CrmAdapter = new MockCrmAdapter();
