/**
 * scripts/generate-results.ts — Generate lib/eval/results.json.
 *
 * Run via: pnpm eval (which calls vitest run tests/eval.test.ts)
 * Or directly: vitest run scripts/generate-results.ts
 *
 * This script runs the deterministic eval and writes results.json.
 * It is NOT the CI gate — tests/eval.test.ts is the gate.
 * This just produces the committed JSON artifact for the /eval page.
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { runEvalDeterministic } from "@/lib/eval/run";

const report = runEvalDeterministic(undefined, "DETERMINISTIC_COMMITTED_RUN");
const outputPath = join(process.cwd(), "lib", "eval", "results.json");
writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf-8");

console.log(`✓ results.json written to ${outputPath}`);
console.log(`  accuracy        : ${report.metrics.accuracy.toFixed(4)}`);
console.log(`  guardRecall  : ${report.metrics.guardRecall.toFixed(4)}`);
console.log(`  policyViolations: ${report.metrics.policyViolations}`);
console.log(`  passedCubed     : ${report.metrics.passedCubed.toFixed(4)}`);
console.log(`  passed/total    : ${report.metrics.passed}/${report.metrics.total}`);
