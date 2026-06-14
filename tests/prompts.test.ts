/**
 * tests/prompts.test.ts — Task 2.1: system prompt
 *
 * Validates the structural invariants that the system prompt MUST satisfy.
 * The prompt is pure string construction — no I/O, no network.
 *
 * Written BEFORE implementation (TDD); expected to fail until prompts.ts exists.
 */

import { describe, it, expect } from "vitest";
import { systemPrompt } from "@/lib/agent/prompts";
import { POLICY } from "@/lib/agent/policy";

describe("systemPrompt()", () => {
  const prompt = systemPrompt();

  // ── Tool names are present and in the correct order ─────────────────────────
  it("mentions crm_lookup", () => {
    expect(prompt).toContain("crm_lookup");
  });

  it("mentions policy_check", () => {
    expect(prompt).toContain("policy_check");
  });

  it("mentions decide_refund", () => {
    expect(prompt).toContain("decide_refund");
  });

  it("crm_lookup appears before decide_refund (enforces tool call order)", () => {
    const idxCrm = prompt.indexOf("crm_lookup");
    const idxDecide = prompt.indexOf("decide_refund");
    expect(idxCrm).toBeGreaterThanOrEqual(0);
    expect(idxDecide).toBeGreaterThanOrEqual(0);
    expect(idxCrm).toBeLessThan(idxDecide);
  });

  it("policy_check appears before decide_refund (enforces tool call order)", () => {
    const idxPolicy = prompt.indexOf("policy_check");
    const idxDecide = prompt.indexOf("decide_refund");
    expect(idxPolicy).toBeGreaterThanOrEqual(0);
    expect(idxDecide).toBeGreaterThanOrEqual(0);
    expect(idxPolicy).toBeLessThan(idxDecide);
  });

  // ── Policy window value is embedded ─────────────────────────────────────────
  it("mentions the 30-day return window", () => {
    // The value comes directly from POLICY.return_window_days via policyText().
    expect(prompt).toContain(`${POLICY.return_window_days}`);
    expect(prompt).toMatch(/30.day/i);
  });

  // ── Escalation and confidence floor are mentioned ────────────────────────────
  it("mentions 'escalate'", () => {
    expect(prompt).toContain("escalate");
  });

  it("mentions the confidence floor value 0.65", () => {
    expect(prompt).toContain(`${POLICY.confidence_floor}`);
  });

  // ── Hold-the-line / pressure resistance ────────────────────────────────────
  it("instructs the agent not to change the decision under pressure or threats", () => {
    // The prompt must explicitly tell the agent that customer pressure,
    // threats, or authority claims do NOT change the decision.
    const lower = prompt.toLowerCase();
    // At minimum one of these must appear.
    const holdTerms = [
      "pressure",
      "threat",
      "legal action",
      "authority",
      "does not change",
      "decision does not change",
      "hold the line",
      "stay empathetic",
    ];
    const found = holdTerms.some((t) => lower.includes(t.toLowerCase()));
    expect(found).toBe(true);
  });

  // ── Few-shot examples ────────────────────────────────────────────────────────
  it("includes at least one policy clause citation in a few-shot example (§2)", () => {
    // The spec requires at least two short examples; they must cite § clauses.
    expect(prompt).toMatch(/§2\.\d/);
  });

  it("includes an approve example citing §2.3", () => {
    expect(prompt).toContain("§2.3");
  });

  it("includes a deny example citing §2.2 (final-sale)", () => {
    expect(prompt).toContain("§2.2");
  });

  // ── Role description ────────────────────────────────────────────────────────
  it("describes the agent role (refund or e-commerce context)", () => {
    const lower = prompt.toLowerCase();
    expect(
      lower.includes("refund") || lower.includes("e-commerce") || lower.includes("ecommerce")
    ).toBe(true);
  });

  // ── Prompt derives from policyText ───────────────────────────────────────────
  it("embeds the full policy text (contains version number)", () => {
    // policyText() opens with "RETURN & REFUND POLICY v<version>"
    expect(prompt).toContain(POLICY.version);
  });

  it("systemPrompt with a custom policy uses that policy's values", () => {
    const customPolicy = { ...POLICY, return_window_days: 14, version: "9.9" };
    const customPrompt = systemPrompt(customPolicy);
    expect(customPrompt).toContain("14");
    expect(customPrompt).toContain("9.9");
  });
});
