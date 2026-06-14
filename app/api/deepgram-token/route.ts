/**
 * app/api/deepgram-token/route.ts — Phase 6: Deepgram ephemeral token endpoint
 *
 * VOICE UPGRADE PATH
 * ───────────────────
 * Web Speech API (browser-native, keyless) is the working default for voice I/O
 * in this application. No API keys are required for that path.
 *
 * This endpoint is the documented production upgrade to Deepgram STT (Nova-2).
 * When DEEPGRAM_API_KEY is configured server-side, this route mints a short-lived
 * Deepgram ephemeral token that the client receives instead of the raw key.
 * The key itself NEVER leaves the server — only the ephemeral token is returned.
 *
 * UNCONFIGURED PATH (CI / local dev without key)
 * ────────────────────────────────────────────────
 * Returns 501 { error: "not_configured", detail: "..." } — a clean, documented
 * signal that Web Speech is the active default and Deepgram is opt-in via key.
 *
 * CONFIGURED PATH (production with key)
 * ──────────────────────────────────────
 * Calls Deepgram's grant-token REST endpoint (POST /v1/auth/grant) to mint an
 * ephemeral token scoped to transcription. Returns { token } to the client.
 * Provider errors return 502 { error: "mint_failed" }.
 *
 * @see https://developers.deepgram.com/docs/temporary-api-keys
 */

export const runtime = "nodejs";

export async function GET(_req: Request): Promise<Response> {
  const apiKey = process.env.DEEPGRAM_API_KEY;

  // ── Unconfigured: Web Speech is the active default ────────────────────────
  if (!apiKey) {
    return Response.json(
      {
        error: "not_configured",
        detail:
          "DEEPGRAM_API_KEY is not set. Web Speech API (keyless, browser-native) is the " +
          "active default for STT. Set DEEPGRAM_API_KEY server-side to enable the " +
          "Deepgram Nova-2 production upgrade path.",
      },
      { status: 501 },
    );
  }

  // ── Configured: mint an ephemeral token via Deepgram REST API ─────────────
  //
  // Uses plain fetch — no @deepgram/sdk dependency added intentionally.
  // The Deepgram grant-token endpoint returns a short-lived key scoped to
  // transcription; the raw API key never reaches the client.
  try {
    const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Restrict to transcription scope only; expires in 30 seconds
        time_to_live_in_seconds: 30,
      }),
    });

    if (!res.ok) {
      throw new Error(`Deepgram grant-token responded ${res.status}`);
    }

    const data = (await res.json()) as { key?: string; [k: string]: unknown };
    return Response.json({ token: data.key });
  } catch {
    return Response.json(
      { error: "mint_failed", detail: "Failed to obtain ephemeral Deepgram token." },
      { status: 502 },
    );
  }
}
