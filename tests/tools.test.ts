/**
 * tests/tools.test.ts — Task 2.2: agent tools
 *
 * Tests are KEYLESS — no LLM calls. createTools() returns plain objects;
 * tool.execute() calls only the mock CRM and the pure policy engine.
 *
 * Written BEFORE implementation (TDD); expected to fail until tools.ts exists.
 *
 * Seed orders used (from lib/crm/data.ts):
 *   ORD-1042 — C003 Alice, electronics unopened → APPROVE full $89.99
 *   ORD-2210 — C007 Derek, clearance final_sale → DENY §2.2
 *   ORD-1001 — C001 Nadia, electronics unopened → APPROVE full $39.99
 *
 * Type note: AI SDK v6 types `execute` as optional and its return as
 * `AsyncIterable<OUT> | PromiseLike<OUT> | OUT` (the function supports streaming
 * as well as one-shot). Our tools always return a plain PromiseLike. The `exec`
 * helper below casts away the optional + the AsyncIterable branch so tests stay
 * readable while TypeScript remains strictly checked everywhere else.
 */

import { describe, it, expect } from "vitest";
import { createTools } from "@/lib/agent/tools";
import { crm } from "@/lib/crm/client";
import type { AgentSession } from "@/lib/agent/tools";
import type { Tool, ToolExecutionOptions } from "ai";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Fresh session for each test so state doesn't bleed between cases. */
function makeSession(): AgentSession {
  return { order: null };
}

/**
 * Narrow a Tool's execute to a typed async function.
 *
 * AI SDK v6 types Tool.execute as optional (tools without auto-execution exist)
 * and its return as `AsyncIterable<OUT> | PromiseLike<OUT> | OUT` to support
 * streaming. Our tools always provide execute and always return a PromiseLike.
 *
 * Two type assertions are required to satisfy strict-mode TypeScript:
 *   1. `execute!` — assert execute is defined (our factory always provides it).
 *   2. Cast result to `Promise<OUT>` — assert we're in the PromiseLike branch
 *      (not AsyncIterable). This is safe because our execute impls never stream.
 *
 * `OUT` is extracted via conditional type so call-sites get the full concrete
 * return type (e.g. `{ found: true, order: Order } | { found: false, ... }`)
 * rather than the abstract union.
 */
type ToolOutput<T extends Tool<any, any>> = T extends Tool<any, infer OUT>
  ? OUT
  : never;

async function exec<T extends Tool<any, any>>(
  t: T,
  input: Parameters<NonNullable<T["execute"]>>[0],
): Promise<ToolOutput<T>> {
  if (!t.execute) throw new Error("tool has no execute function");
  // Cast to Promise<ToolOutput<T>>: our tools always return a PromiseLike (never stream).
  return (t.execute!(input, {} as ToolExecutionOptions)) as Promise<ToolOutput<T>>;
}

// ─── crm_lookup ──────────────────────────────────────────────────────────────

describe("crm_lookup tool", () => {
  it("returns found:true and the order for a known order_id", async () => {
    const session = makeSession();
    const { crm_lookup } = createTools(session);

    const result = await exec(crm_lookup, { order_id: "ORD-1042" });

    expect(result.found).toBe(true);
    if (!result.found) throw new Error("unreachable — narrowing");
    expect(result.order.name).toBe("Alice");
    expect(result.order.order_id).toBe("ORD-1042");
  });

  it("sets session.order after a successful lookup", async () => {
    const session = makeSession();
    const { crm_lookup } = createTools(session);

    await exec(crm_lookup, { order_id: "ORD-1042" });

    expect(session.order).not.toBeNull();
    expect(session.order?.name).toBe("Alice");
  });

  it("returns found:false for an unknown order_id", async () => {
    const session = makeSession();
    const { crm_lookup } = createTools(session);

    const result = await exec(crm_lookup, { order_id: "ORD-NOTEXIST" });

    expect(result.found).toBe(false);
  });

  it("leaves session.order null when order is not found", async () => {
    const session = makeSession();
    const { crm_lookup } = createTools(session);

    await exec(crm_lookup, { order_id: "ORD-NOTEXIST" });

    expect(session.order).toBeNull();
  });

  it("resolves by item_description when no order_id is given (voice path)", async () => {
    // Customer speaks a request with no order number — the agent resolves the
    // order from the item description and primes the session, exactly as the
    // order_id path does, so policy_check / decide_refund run unchanged.
    const session = makeSession();
    const { crm_lookup } = createTools(session);

    const result = await exec(crm_lookup, { item_description: "I'd like to return my yoga mat" });

    expect(result.found).toBe(true);
    if (!result.found) throw new Error("unreachable — narrowing");
    expect(result.order.order_id).toBe("ORD-1002");
    expect(result.order.item).toBe("Yoga Mat");
    expect(session.order?.order_id).toBe("ORD-1002");
  });

  it("returns found:false when an item_description matches nothing", async () => {
    const session = makeSession();
    const { crm_lookup } = createTools(session);

    const result = await exec(crm_lookup, { item_description: "a flux capacitor" });

    expect(result.found).toBe(false);
    expect(session.order).toBeNull();
  });

  it("prefers a valid order_id over item_description", async () => {
    // Both supplied: the explicit order id wins (ORD-1042 Alice), not the item.
    const session = makeSession();
    const { crm_lookup } = createTools(session);

    const result = await exec(crm_lookup, {
      order_id: "ORD-1042",
      item_description: "yoga mat",
    });

    expect(result.found).toBe(true);
    if (!result.found) throw new Error("unreachable — narrowing");
    expect(result.order.order_id).toBe("ORD-1042");
    expect(result.order.name).toBe("Alice");
  });
});

// ─── policy_check ─────────────────────────────────────────────────────────────

describe("policy_check tool", () => {
  it("returns decision:deny for a final-sale clearance order (ORD-2210 Derek)", async () => {
    const session = makeSession();
    const { crm_lookup, policy_check } = createTools(session);

    // Prime the session via crm_lookup (mirrors the agent's required tool sequence).
    await exec(crm_lookup, { order_id: "ORD-2210" });
    const result = await exec(policy_check, { order_id: "ORD-2210" });

    // Result should be a PolicyEvaluation, not an error.
    expect("decision" in result).toBe(true);
    if (!("decision" in result)) throw new Error("narrowing");
    expect(result.decision).toBe("deny");
    // Should cite §2.2 (final-sale / clearance).
    expect(result.violated_clauses).toContain("§2.2");
  });

  it("falls back to CRM lookup when session.order is null", async () => {
    // session.order starts null; policy_check must fetch it itself as a fallback.
    const session = makeSession();
    const { policy_check } = createTools(session);

    const result = await exec(policy_check, { order_id: "ORD-1001" });

    expect("decision" in result).toBe(true);
    if (!("decision" in result)) throw new Error("narrowing");
    expect(result.decision).toBe("approve");
  });

  it("returns an error object for an unknown order_id", async () => {
    const session = makeSession();
    const { policy_check } = createTools(session);

    const result = await exec(policy_check, { order_id: "ORD-NOTEXIST" });

    expect("error" in result).toBe(true);
    if (!("error" in result)) throw new Error("narrowing");
    expect(result.error).toMatch(/not found/i);
  });
});

// ─── decide_refund ────────────────────────────────────────────────────────────

describe("decide_refund tool", () => {
  it("returns error when session.order is null (no crm_lookup first)", async () => {
    const session = makeSession();
    const { decide_refund } = createTools(session);

    const result = await exec(decide_refund, {
      decision: "approve",
      reason: "Customer said so and the item looks fine",
      confidence: 0.9,
      proposed_amount: 39.99,
    });

    expect("error" in result).toBe(true);
    if (!("error" in result)) throw new Error("narrowing");
    expect(result.error).toMatch(/crm_lookup/i);
  });

  it("returns a RefundOutcome approve for a clean in-window unopened order (ORD-1001 Nadia)", async () => {
    const session = makeSession();
    const { crm_lookup, decide_refund } = createTools(session);

    // Prime session (agent tool-call sequence: crm_lookup → decide_refund).
    await exec(crm_lookup, { order_id: "ORD-1001" });

    const result = await exec(decide_refund, {
      decision: "approve",
      reason: "Item is unopened and returned within the 30-day window per §2.3",
      confidence: 0.9,
      proposed_amount: 39.99,
    });

    // result should be a RefundOutcome (has .decision, .amount, .overridden)
    expect("decision" in result && "amount" in result).toBe(true);
    if (!("decision" in result)) throw new Error("narrowing");
    expect(result.decision).toBe("approve");
    expect(result.amount).toBe(39.99);
    expect(result.overridden).toBe(false);
  });

  it("overrides an out-of-policy approve to deny (held-line: ORD-2210 Derek, final-sale)", async () => {
    // Derek's order is clearance + final_sale → policy MUST deny.
    // The model proposes "approve" — the policy engine should override it.
    const order = await crm.getOrder("ORD-2210");
    expect(order).not.toBeNull();

    const session: AgentSession = { order: order! };
    const { decide_refund } = createTools(session);

    const result = await exec(decide_refund, {
      decision: "approve",
      reason: "Customer is very upset and threatened to leave a bad review",
      confidence: 0.99,
      proposed_amount: 34,
    });

    expect("decision" in result).toBe(true);
    if (!("decision" in result)) throw new Error("narrowing");
    // Policy engine must have overridden the model's "approve".
    expect(result.decision).toBe("deny");
    expect(result.overridden).toBe(true);
  });
});
