// MD Scholars — verify-turnstile
// Small helper edge function that verifies a Cloudflare Turnstile token
// server-side. Callable from any other Edge Function OR the client.
// Returns { ok: true } if the token is valid; { ok: false, error } otherwise.
//
// Setup: set TURNSTILE_SECRET_KEY as a Function Secret in Supabase.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const ALLOWED_ORIGINS = ["https://mdscholars.com", "https://www.mdscholars.com"];
function cors(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const SECRET = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";

serve(async (req) => {
  const origin = req.headers.get("origin");
  const CORS = cors(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const { token } = await req.json();
    if (!token) return new Response(JSON.stringify({ ok: false, error: "no token" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    if (!SECRET) {
      // Dev mode — treat any token as valid but flag it
      return new Response(JSON.stringify({ ok: true, dev: true, reason: "TURNSTILE_SECRET_KEY not configured" }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Get client IP for extra verification (Turnstile likes this)
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "";
    const body = new URLSearchParams({ secret: SECRET, response: String(token) });
    if (ip) body.append("remoteip", ip);

    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body,
    });
    const j = await resp.json();
    if (j.success) {
      return new Response(JSON.stringify({ ok: true, action: j.action, hostname: j.hostname }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: false, errors: j["error-codes"] }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
