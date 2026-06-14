/**
 * tests/model.test.ts — Task 2.1: model selector
 *
 * Tests are KEYLESS: calling getModel() returns a provider model object
 * with .provider and .modelId — it never makes a network call.
 *
 * Written BEFORE implementation (TDD); expected to fail until model.ts exists.
 */

import { describe, it, expect, afterEach } from "vitest";

// Snapshot env before any test so we can restore it cleanly.
const ORIG_PROVIDER = process.env.LLM_PROVIDER;
const ORIG_MODEL = process.env.LLM_MODEL;

afterEach(() => {
  // Restore (or delete) each env key to its original state so tests don't bleed.
  if (ORIG_PROVIDER === undefined) {
    delete process.env.LLM_PROVIDER;
  } else {
    process.env.LLM_PROVIDER = ORIG_PROVIDER;
  }
  if (ORIG_MODEL === undefined) {
    delete process.env.LLM_MODEL;
  } else {
    process.env.LLM_MODEL = ORIG_MODEL;
  }
});

describe("getModel()", () => {
  it("defaults to anthropic claude-sonnet-4-6 when no env vars are set", async () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
    // Dynamic import ensures the module reads env at call time, not module-load time.
    const { getModel } = await import("@/lib/agent/model");
    const model = getModel();
    // model is a LanguageModelV3-shaped object; both fields are always present.
    expect(model.provider).toContain("anthropic");
    expect(model.modelId).toBe("claude-sonnet-4-6");
  });

  it("defaults to anthropic when LLM_PROVIDER is explicitly set to 'anthropic'", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    delete process.env.LLM_MODEL;
    const { getModel } = await import("@/lib/agent/model");
    const model = getModel();
    expect(model.provider).toContain("anthropic");
    expect(model.modelId).toBe("claude-sonnet-4-6");
  });

  it("switches to openai gpt-4.1-mini when LLM_PROVIDER=openai", async () => {
    process.env.LLM_PROVIDER = "openai";
    delete process.env.LLM_MODEL;
    const { getModel } = await import("@/lib/agent/model");
    const model = getModel();
    expect(model.provider).toContain("openai");
    expect(model.modelId).toBe("gpt-4.1-mini");
  });

  it("respects LLM_MODEL override on the anthropic provider", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.LLM_MODEL = "claude-sonnet-4-6";
    const { getModel } = await import("@/lib/agent/model");
    const model = getModel();
    expect(model.provider).toContain("anthropic");
    expect(model.modelId).toBe("claude-sonnet-4-6");
  });

  it("respects LLM_MODEL override on the openai provider", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_MODEL = "gpt-4.1-mini";
    const { getModel } = await import("@/lib/agent/model");
    const model = getModel();
    expect(model.provider).toContain("openai");
    expect(model.modelId).toBe("gpt-4.1-mini");
  });
});
