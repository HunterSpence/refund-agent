/**
 * tests/hardening.test.ts — robustness guarantees hardened in pre-submission review.
 *
 * Three properties, all KEYLESS (no LLM calls):
 *   1. Order lock — once crm_lookup fixes the order, policy_check cannot be
 *      retargeted to a different order by supplying a different order_id.
 *   2. Policy threading — createTools(session, policy) actually enforces the
 *      injected policy config inside the tools (not just in the system prompt).
 *   3. Request hardening — POST returns 400 (not a 500 throw) on malformed input.
 */

import { describe, it, expect } from "vitest";
import type { Tool, ToolExecutionOptions } from "ai";
import { createTools, type AgentSession } from "@/lib/agent/tools";
import { POLICY_RETAILER_B } from "@/lib/agent/policy";
import { POST } from "@/app/api/agent/route";

function makeSession(): AgentSession {
  return { order: null };
}

type ToolOutput<T extends Tool<any, any>> = T extends Tool<any, infer OUT> ? OUT : never;

async function exec<T extends Tool<any, any>>(
  t: T,
  input: Parameters<NonNullable<T["execute"]>>[0],
): Promise<ToolOutput<T>> {
  if (!t.execute) throw new Error("tool has no execute function");
  return t.execute!(input, {} as ToolExecutionOptions) as Promise<ToolOutput<T>>;
}

// ─── 1. Order lock ──────────────────────────────────────────────────────────

describe("order lock — decision cannot be retargeted mid-loop", () => {
  it("policy_check evaluates the crm_lookup order even if a different order_id is supplied", async () => {
    const session = makeSession();
    const { crm_lookup, policy_check } = createTools(session);

    // Lock in Derek's clearance / final-sale order (ORD-2210 → DENY §2.2).
    await exec(crm_lookup, { order_id: "ORD-2210" });

    // Attacker attempts to switch to Nadia's clean unopened order
    // (ORD-1001 → would APPROVE) at the policy_check step.
    const result = await exec(policy_check, { order_id: "ORD-1001" });

    if (!("decision" in result)) throw new Error("expected a PolicyEvaluation");
    // The LOCKED order (Derek, final_sale) is evaluated — NOT the supplied ORD-1001.
    expect(result.decision).toBe("deny");
    expect(result.violated_clauses).toContain("§2.2");
    expect(session.order?.order_id).toBe("ORD-2210");
  });
});

// ─── 2. Policy threading ──────────────────────────────────────────────────────

describe("policy threading — tools honor the injected policy config", () => {
  it("createTools(session, POLICY_RETAILER_B) enforces the stricter 14-day window in policy_check", async () => {
    const session = makeSession();
    const { crm_lookup, policy_check } = createTools(session, POLICY_RETAILER_B);

    // ORD-1002 (Tom): delivered day 0, requested day 30. Default 30-day policy → APPROVE.
    await exec(crm_lookup, { order_id: "ORD-1002" });
    const result = await exec(policy_check, { order_id: "ORD-1002" });

    if (!("decision" in result)) throw new Error("expected a PolicyEvaluation");
    // Retailer B's 14-day window denies under §2.1 — proves the injected config is used,
    // not the default POLICY.
    expect(result.decision).toBe("deny");
    expect(result.violated_clauses).toContain("§2.1");
  });
});

// ─── 3. Request hardening ─────────────────────────────────────────────────────

describe("request hardening — malformed POST body returns 400, not 500", () => {
  it("a message with no parts array is rejected with 400", async () => {
    const req = new Request("http://test/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user" }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("a non-object message entry is rejected with 400", async () => {
    const req = new Request("http://test/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: ["not a message"] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
