/**
 * app/api/cartesia-token/route.ts — Phase 6: Cartesia ephemeral token endpoint
 *
 * VOICE UPGRADE PATH
 * ───────────────────
 * Web Speech API (browser-native, keyless) is the working default for voice I/O
 * in this application. No API keys are required for that path.
 *
 * This endpoint is the documented production upgrade to Cartesia TTS (Sonic).
 * When CARTESIA_API_KEY is configured server-side, this route mints a short-lived
 * Cartesia ephemeral token that the client receives instead of the raw key.
 * The key itself NEVER leaves the server — only the ephemeral token is returned.
 *
 * UNCONFIGURED PATH (CI / local dev without key)
 * ────────────────────────────────────────────────
 * Returns 501 { error: "not_configured", detail: "..." } — a clean, documented
 * signal that Web Speech is the active default and Cartesia is opt-in via key.
 *
 * CONFIGURED PATH (production with key)
 * ──────────────────────────────────────
 * Calls Cartesia's API tokens endpoint (POST /api-keys) to mint a scoped
 * ephemeral token for TTS. Returns { token } to the client.
 * Provider errors return 502 { error: "mint_failed" }.
 *
 * @see https://docs.cartesia.ai/api-reference/api-keys/create
 */

export const runtime = "nodejs";

export async function GET(_req: Request): Promise<Response> {
  const apiKey = process.env.CARTESIA_API_KEY;

  // ── Unconfigured: Web Speech is the active default ────────────────────────
  if (!apiKey) {
    return Response.json(
      {
        error: "not_configured",
        detail:
          "CARTESIA_API_KEY is not set. Web Speech API (keyless, browser-native) is the " +
          "active default for TTS. Set CARTESIA_API_KEY server-side to enable the " +
          "Cartesia Sonic production upgrade path.",
      },
      { status: 501 },
    );
  }

  // ── Configured: mint an ephemeral token via Cartesia REST API ─────────────
  //
  // Uses plain fetch — no @cartesia/sdk dependency added intentionally.
  // The Cartesia API key endpoint returns a scoped short-lived token; the raw
  // API key never reaches the client.
  try {
    const res = await fetch("https://api.cartesia.ai/api-keys", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        "Cartesia-Version": "2024-06-10",
      },
      body: JSON.stringify({
        name: "ephemeral-voice-session",
        // Short expiry so the token cannot be abused if intercepted
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    });

    if (!res.ok) {
      throw new Error(`Cartesia token endpoint responded ${res.status}`);
    }

    const data = (await res.json()) as { id?: string; [k: string]: unknown };
    return Response.json({ token: data.id });
  } catch {
    return Response.json(
      { error: "mint_failed", detail: "Failed to obtain ephemeral Cartesia token." },
      { status: 502 },
    );
  }
}
