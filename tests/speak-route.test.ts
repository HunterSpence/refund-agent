/**
 * tests/speak-route.test.ts — /api/speak Cartesia TTS proxy.
 *
 * KEYLESS paths only (no real Cartesia network call):
 *   - no key            → 501 not_configured (client uses Web Speech fallback)
 *   - key + bad JSON     → 400 (before any network call)
 *   - key + empty text   → 400 (before any network call)
 */

import { describe, it, expect, afterEach } from "vitest";
import { POST } from "@/app/api/speak/route";

function post(body: unknown): Request {
  return new Request("http://test/api/speak", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  delete process.env.CARTESIA_API_KEY;
});

describe("/api/speak — Cartesia TTS proxy", () => {
  it("returns 501 not_configured when CARTESIA_API_KEY is absent", async () => {
    delete process.env.CARTESIA_API_KEY;
    const res = await POST(post({ text: "hello" }));
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_configured");
  });

  it("returns 400 on malformed JSON (key present, before any network call)", async () => {
    process.env.CARTESIA_API_KEY = "sk_test_dummy";
    const res = await POST(post("not-json{{"));
    expect(res.status).toBe(400);
  });

  it("returns 400 on empty text (key present, before any network call)", async () => {
    process.env.CARTESIA_API_KEY = "sk_test_dummy";
    const res = await POST(post({ text: "   " }));
    expect(res.status).toBe(400);
  });
});
