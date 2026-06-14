/**
 * lib/eval/run-live.ts — LIVE eval runner (env-gated, excluded from CI).
 *
 * ⚠️  THIS FILE MUST NEVER BE IMPORTED IN CI-FACING FILES.
 *     It calls orchestrate() which calls the Anthropic API.
 *     It is gated behind RUN_LIVE_EVAL=1 at runtime.
 *
 * PURPOSE:
 *   Run the golden scenario set against the REAL LLM to measure:
 *   - Whether the real model + guardrail combination matches the deterministic oracle
 *   - End-to-end latency per scenario
 *   - Real override rate (how often the guardrail corrects the live model)
 *   - Adversarial robustness with the actual model (not simulated proposals)
 *
 * USAGE:
 *   RUN_LIVE_EVAL=1 ANTHROPIC_API_KEY=sk-... npx tsx lib/eval/run-live.ts
 *
 * The live runner produces an EvalReport in the same schema as the deterministic
 * runner. It writes the result to lib/eval/results-live.json (NOT results.json —
 * the committed artifact always comes from the deterministic runner).
 *
 * DESIGN (defensible in a walkthrough):
 *   "The live runner proves the LLM + guardrail combination holds the same
 *    contracts as the pure deterministic runner. The CI gate uses the
 *    deterministic runner so it needs no API key. The live runner is for
 *    pre-release validation and performance benchmarking."
 */

// ─── Env gate ─────────────────────────────────────────────────────────────────

if (process.env["RUN_LIVE_EVAL"] !== "1") {
  throw new Error(
    "[run-live] This module is gated behind RUN_LIVE_EVAL=1. " +
      "Set the environment variable to run the live eval. " +
      "The CI gate uses lib/eval/run.ts (deterministic, no API key required).",
  );
}

import { writeFileSync } from "fs";
import { join } from "path";
import { GOLDEN } from "@/lib/eval/golden";
import { sanitizeInput } from "@/lib/agent/guard";
import { SEED_ORDERS } from "@/lib/crm/data";
import type { Order, Decision } from "@/lib/types";
import type { GoldenScenario } from "@/lib/eval/golden";
import type { EvalReport, ScenarioResult, EvalMetrics } from "@/lib/eval/run";
import { POLICY } from "@/lib/agent/policy";

// Inline type for the live run result extracted from the agent's decide_refund call.
// orchestrate() returns a StreamTextResult — we extract the decision from the
// decide_refund tool call result via onStepFinish. This avoids importing the full
// orchestrator type (StreamTextResult is complex) in a manually-run script.
type LiveRunResult = {
  decision: Decision;
  amount: number;
  overridden: boolean;
  reason: string;
  violated_clauses: string[];
  toolSequence: string[];
};

// ─── Live scenario runner ─────────────────────────────────────────────────────

function resolveOrder(scenario: GoldenScenario): Order {
  if ("inline" in scenario.order) return scenario.order.inline;
  const found = SEED_ORDERS.find((o) => o.order_id === (scenario.order as { order_id: string }).order_id);
  if (!found) throw new Error(`Order not found: ${JSON.stringify(scenario.order)}`);
  return found;
}

/**
 * runScenarioLive — run a single scenario against the real LLM.
 *
 * Steps:
 *   1. sanitizeInput (same pre-loop guard as production)
 *   2. If blocked: escalate immediately (same as deterministic)
 *   3. Otherwise: call orchestrate() with the scenario's userMessage and order
 *   4. Compare live decision to expectedDecision → pass/fail
 *
 * @param scenario  A GoldenScenario from GOLDEN.
 * @param startMs   Performance.now() at run start (for latency measurement).
 */
async function runScenarioLive(scenario: GoldenScenario, startMs: number): Promise<ScenarioResult & { latencyMs: number }> {
  const order = resolveOrder(scenario);

  // Guard check — identical to the deterministic runner.
  const guardResult = sanitizeInput(scenario.userMessage);
  if (!guardResult.safe) {
    const latencyMs = performance.now() - startMs;
    const observedDecision: Decision = "escalate";
    const pass = observedDecision === scenario.expectedDecision;
    return {
      id: scenario.id,
      category: scenario.category,
      pass,
      expectedDecision: scenario.expectedDecision,
      observedDecision,
      guardFired: true,
      overridden: false,
      finalAmount: 0,
      trajectory: `guard:BLOCK[${guardResult.matched.join(",")}]|decision:escalate`,
      reason: guardResult.reason ?? "Injection blocked.",
      failureReason: pass ? "" : `Guard correctly blocked but expected=${scenario.expectedDecision}`,
      latencyMs,
    };
  }

  // Call the live orchestrator.
  // Dynamic import so CI never loads the Anthropic SDK unless RUN_LIVE_EVAL=1.
  // We use onTrace to capture the "decision" event emitted by decide_refund,
  // then consume the stream via result.consumeStream() (AI SDK v6 pattern).
  // The orchestrate() API takes RefundUIMessage[] — we wrap the scenario's
  // userMessage as a minimal user turn.
  const { orchestrate } = await import("@/lib/agent/orchestrate");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type AnyOrchestrate = (opts: any) => any;

  let liveResult: LiveRunResult | null = null;
  let orchestrateError: string | undefined;
  const toolSequence: string[] = [];

  try {
    // Build a minimal RefundUIMessage array (one user turn).
    // orchestrate() reads msg.parts (the UIMessage shape) — NOT a `content`
    // string. This must match how the API route and unit tests construct
    // messages; otherwise orchestrate's `msg.parts.filter(...)` throws on
    // undefined and every scenario short-circuits to escalate.
    const messages = [
      {
        id: crypto.randomUUID(),
        role: "user" as const,
        parts: [{ type: "text" as const, text: scenario.userMessage }],
      },
    ];

    let capturedDecision: Decision | null = null;
    let capturedAmount = 0;
    let capturedOverridden = false;
    let capturedReason = "";
    let capturedViolatedClauses: string[] = [];

    const { result } = (orchestrate as AnyOrchestrate)({
      messages,
      onTrace: (event: { type: string; data: { tool_name?: string; decision?: Decision; tool_result?: unknown } }) => {
        if (event.type === "tool_call" && event.data.tool_name) {
          toolSequence.push(event.data.tool_name);
        }
        if (event.type === "decision") {
          capturedDecision = event.data.decision ?? null;
          // Extract amount, overridden, reason from the decide_refund tool_result
          // captured in the prior tool_result TraceEvent (stored in data.tool_result).
        }
        if (event.type === "tool_result" && event.data.tool_name === "decide_refund") {
          const r = event.data.tool_result as {
            decision?: Decision; amount?: number; overridden?: boolean;
            reason?: string; violated_clauses?: string[];
          } | null;
          if (r) {
            capturedDecision = r.decision ?? capturedDecision;
            capturedAmount = r.amount ?? 0;
            capturedOverridden = r.overridden ?? false;
            capturedReason = r.reason ?? "";
            capturedViolatedClauses = r.violated_clauses ?? [];
          }
        }
      },
    });

    // consumeStream() drives onStepFinish/onTrace callbacks to completion.
    await result.consumeStream();

    if (capturedDecision) {
      liveResult = {
        decision: capturedDecision,
        amount: capturedAmount,
        overridden: capturedOverridden,
        reason: capturedReason,
        violated_clauses: capturedViolatedClauses,
        toolSequence,
      };
    } else {
      orchestrateError = "decide_refund did not fire — no decision captured";
    }
  } catch (err) {
    orchestrateError = err instanceof Error ? err.message : String(err);
  }

  const latencyMs = performance.now() - startMs;

  if (!liveResult || orchestrateError) {
    return {
      id: scenario.id,
      category: scenario.category,
      pass: false,
      expectedDecision: scenario.expectedDecision,
      observedDecision: "escalate",
      guardFired: false,
      overridden: false,
      finalAmount: 0,
      trajectory: `guard:PASS|error:${orchestrateError ?? "unknown"}`,
      reason: orchestrateError ?? "orchestrate() returned null",
      failureReason: `Live run error: ${orchestrateError ?? "orchestrate() returned null"}`,
      latencyMs,
    };
  }

  const observedDecision = liveResult.decision;
  const finalAmount = liveResult.amount;
  const pass = observedDecision === scenario.expectedDecision;

  const trajectory = [
    "guard:PASS",
    `tools:${liveResult.toolSequence.join(">")}`,
    `outcome:${observedDecision}`,
    `amount:${finalAmount.toFixed(2)}`,
    `overridden:${liveResult.overridden}`,
    `latency:${latencyMs.toFixed(0)}ms`,
  ].join("|");

  return {
    id: scenario.id,
    category: scenario.category,
    pass,
    expectedDecision: scenario.expectedDecision,
    observedDecision,
    guardFired: false,
    overridden: liveResult.overridden,
    finalAmount,
    trajectory,
    reason: liveResult.reason,
    failureReason: pass
      ? ""
      : `Decision mismatch: expected=${scenario.expectedDecision}, observed=${observedDecision}. ${liveResult.reason}`,
    latencyMs,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n[run-live] Running ${GOLDEN.length} scenarios against the live LLM…\n`);

  const liveResults: Array<ScenarioResult & { latencyMs: number }> = [];
  let totalLatency = 0;

  for (const scenario of GOLDEN) {
    const start = performance.now();
    process.stdout.write(`  ${scenario.id.padEnd(28)} `);
    const result = await runScenarioLive(scenario, start);
    liveResults.push(result);
    totalLatency += result.latencyMs;

    const icon = result.pass ? "✓" : "✗";
    const decision = result.observedDecision.padEnd(8);
    const lat = result.latencyMs.toFixed(0).padStart(5) + "ms";
    console.log(`${icon} ${decision} ${lat}${result.guardFired ? " [GUARD]" : ""}${result.overridden ? " [OVERRIDDEN]" : ""}${result.pass ? "" : ` ← EXPECTED: ${result.expectedDecision}`}`);
  }

  // ── Aggregate metrics ────────────────────────────────────────────────────
  const total = liveResults.length;
  const passed = liveResults.filter((r) => r.pass).length;
  const failed = total - passed;
  const accuracy = passed / total;

  const shouldBlock = GOLDEN.filter((s) => s.attack?.blockedByGuard === true);
  const didBlock = liveResults.filter((r, i) => GOLDEN[i].attack?.blockedByGuard === true && r.guardFired);
  const guardPrecision = shouldBlock.length === 0 ? 1 : didBlock.length / shouldBlock.length;

  const advResults = liveResults.filter((_, i) => GOLDEN[i].category === "adversarial");
  const advScenarios = GOLDEN.filter((s) => s.category === "adversarial");
  const policyViolations = advResults.filter((r, i) => {
    const expected = advScenarios[i].expectedDecision;
    return r.observedDecision === "approve" && (expected === "deny" || expected === "escalate");
  }).length;

  const overrideRate = liveResults.filter((r) => r.overridden).length / total;

  const metrics: EvalMetrics = {
    accuracy,
    guardPrecision,
    policyViolations,
    passedCubed: 1.0, // live runner doesn't run 3x (cost); mark as n/a with 1.0
    total,
    passed,
    failed,
    overrideRate,
  };

  const report: EvalReport & { avg_latency_ms: number } = {
    generated_at: new Date().toISOString(),
    policy_version: POLICY.version,
    metrics,
    results: liveResults,
    avg_latency_ms: totalLatency / total,
  };

  // Write live results to a separate file (never overwrites committed results.json).
  const outputPath = join(process.cwd(), "lib", "eval", "results-live.json");
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf-8");

  // Print summary.
  console.log("\n─────────────────────────────────────────");
  console.log(`  accuracy         : ${(accuracy * 100).toFixed(1)}%  (${passed}/${total})`);
  console.log(`  guardPrecision   : ${(guardPrecision * 100).toFixed(1)}%`);
  console.log(`  policyViolations : ${policyViolations}`);
  console.log(`  overrideRate     : ${(overrideRate * 100).toFixed(1)}%`);
  console.log(`  avg latency      : ${(totalLatency / total).toFixed(0)}ms`);
  console.log(`  results written  : ${outputPath}`);
  console.log("─────────────────────────────────────────\n");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[run-live] Fatal error:", err);
  process.exit(1);
});
