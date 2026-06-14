/**
 * tests/telemetry.test.ts — Phase 7b: env-gated Langfuse telemetry helper
 *
 * Written FIRST (TDD) before the helper is implemented in orchestrate.ts.
 * Tests prove that isTelemetryEnabled() is a pure env gate:
 *   - false when both LANGFUSE_* vars are absent
 *   - false when only one of the two is present
 *   - true when both are present
 *
 * No network calls, no OTel exporter needed. The AI SDK treats isEnabled:false
 * as a complete no-op, so these tests run cleanly in any CI environment.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isTelemetryEnabled } from "@/lib/agent/orchestrate";

// ─── Env cleanup helpers ──────────────────────────────────────────────────────

const PUB = "LANGFUSE_PUBLIC_KEY";
const SEC = "LANGFUSE_SECRET_KEY";

function clearLangfuseEnv() {
  delete process.env[PUB];
  delete process.env[SEC];
}

describe("isTelemetryEnabled()", () => {
  // Ensure each test starts with a clean slate.
  beforeEach(() => {
    clearLangfuseEnv();
  });

  // Prevent env vars set inside tests from leaking into later test files.
  afterEach(() => {
    clearLangfuseEnv();
  });

  it("returns false when both LANGFUSE_* vars are unset", () => {
    expect(isTelemetryEnabled()).toBe(false);
  });

  it("returns false when only LANGFUSE_PUBLIC_KEY is set", () => {
    process.env[PUB] = "pk-test-only-public";
    expect(isTelemetryEnabled()).toBe(false);
  });

  it("returns false when only LANGFUSE_SECRET_KEY is set", () => {
    process.env[SEC] = "sk-test-only-secret";
    expect(isTelemetryEnabled()).toBe(false);
  });

  it("returns true when both LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set", () => {
    process.env[PUB] = "pk-test-public";
    process.env[SEC] = "sk-test-secret";
    expect(isTelemetryEnabled()).toBe(true);
  });
});
