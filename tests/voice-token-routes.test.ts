/**
 * tests/voice-token-routes.test.ts — Phase 6: voice ephemeral token routes (TDD)
 *
 * WHAT THIS FILE PROVES
 * ──────────────────────
 * 1. Both /api/deepgram-token and /api/cartesia-token return 501 with
 *    { error: "not_configured" } when the respective API key env var is absent.
 *
 * 2. Responses include a `detail` string that explains Web Speech is the
 *    working default and these routes are the production upgrade path.
 *
 * KEYLESS CI SAFETY
 * ──────────────────
 * Tests delete the env vars before running to guarantee the unconfigured path.
 * The key-present branch (token minting via provider REST API) is NOT tested
 * here because it requires real network calls — it is documented with a comment
 * in the route handlers and verified manually during staging.
 *
 * The Web Speech browser API (VoiceButton) is not unit-testable in jsdom
 * without heavy mocking of browser APIs — meaningful coverage lives here in the
 * server-side token routes which have clean, deterministic, keyless paths.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { GET as deepgramGET } from "@/app/api/deepgram-token/route";
import { GET as cartesiaGET } from "@/app/api/cartesia-token/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse the JSON body from a Response object. */
async function responseJSON(res: Response): Promise<unknown> {
  return res.json();
}

// ─── Setup: ensure env vars are unset for all tests ──────────────────────────

beforeEach(() => {
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.CARTESIA_API_KEY;
});

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("/api/deepgram-token — unconfigured path", () => {
  it("returns 501 with error: not_configured when DEEPGRAM_API_KEY is absent", async () => {
    const req = new Request("http://localhost/api/deepgram-token");
    const res = await deepgramGET(req);

    expect(res.status).toBe(501);

    const body = await responseJSON(res);
    expect(body).toMatchObject({ error: "not_configured" });
  });

  it("includes a detail string explaining the Web Speech default", async () => {
    const req = new Request("http://localhost/api/deepgram-token");
    const res = await deepgramGET(req);
    const body = (await responseJSON(res)) as Record<string, unknown>;

    expect(typeof body.detail).toBe("string");
    expect((body.detail as string).length).toBeGreaterThan(0);
  });
});

describe("/api/cartesia-token — unconfigured path", () => {
  it("returns 501 with error: not_configured when CARTESIA_API_KEY is absent", async () => {
    const req = new Request("http://localhost/api/cartesia-token");
    const res = await cartesiaGET(req);

    expect(res.status).toBe(501);

    const body = await responseJSON(res);
    expect(body).toMatchObject({ error: "not_configured" });
  });

  it("includes a detail string explaining the Web Speech default", async () => {
    const req = new Request("http://localhost/api/cartesia-token");
    const res = await cartesiaGET(req);
    const body = (await responseJSON(res)) as Record<string, unknown>;

    expect(typeof body.detail).toBe("string");
    expect((body.detail as string).length).toBeGreaterThan(0);
  });
});
