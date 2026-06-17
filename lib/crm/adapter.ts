/**
 * lib/crm/adapter.ts
 *
 * The CrmAdapter interface — the stable seam between the refund agent and any
 * real CRM backend. Every method is async to faithfully model network I/O even
 * though the mock implementation resolves synchronously.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SWAP_ME: plugging in a real CRM
 * ─────────────────────────────────────────────────────────────────────────────
 * To connect a production CRM (Shopify, Zendesk, Salesforce, etc.):
 *
 *   1. Create `lib/crm/shopify-adapter.ts` (or whichever CRM).
 *   2. Implement the `CrmAdapter` interface below using the CRM's API client.
 *      - `getOrder`   → e.g. Shopify Orders API GET /orders/{order_id}.json
 *      - `getAllOrders` → typically only needed by the eval harness; a real
 *        production adapter can throw/return [] here if bulk listing is not
 *        supported.
 *   3. Map the CRM's native fields to the `Order` shape defined in
 *      `lib/types.ts`. The CRM's money fields should be converted from
 *      integer cents to USD dollars (divide by 100).
 *   4. In `lib/crm/client.ts`, swap `MockCrmAdapter` for your new class and
 *      re-export the singleton `crm`.
 *   5. Set the required API credentials in `.env.local` (see `.env.local.example`).
 *
 * No other file needs to change — the agent, tools, and policy engine all
 * depend solely on this interface, not on the concrete implementation.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { Order } from "@/lib/types";

export interface CrmAdapter {
  /**
   * Look up a single order by its order_id.
   * Returns `null` if the order does not exist.
   */
  getOrder(orderId: string): Promise<Order | null>;

  /**
   * Return all orders accessible to this adapter.
   *
   * Used by:
   *   - The eval harness to iterate every seed profile.
   *   - The UI scenario picker to populate the order selector dropdown.
   *
   * A production implementation may limit or paginate this list; the mock
   * always returns all 16 seed orders.
   */
  getAllOrders(): Promise<Order[]>;

  /**
   * Resolve an order from a free-text item description when the customer did
   * NOT provide an order id — e.g. "my yoga mat", "the headphones I bought".
   * Returns `null` if no order's item matches.
   *
   * This powers the voice/chat path where a customer simply says what they want
   * to return. The agent extracts the item phrase (intent) and this method maps
   * it to a concrete order (data) — keeping the "LLM decides intent, code
   * resolves the record" separation. A production adapter would scope this to
   * the authenticated customer's own orders (e.g. Shopify customer order list);
   * the mock matches across the seed by item name.
   */
  findOrderByItem(query: string): Promise<Order | null>;
}
