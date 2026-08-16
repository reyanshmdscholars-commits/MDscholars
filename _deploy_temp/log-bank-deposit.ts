// Supabase Edge Function: log-bank-deposit
// Admin-only wrapper around bank-deposit-webhook.
// Purpose: keep the BANK_WEBHOOK_TOKEN entirely server-side. The admin panel
// calls this endpoint with its session JWT; we verify the caller is an admin,
// then forward to bank-deposit-webhook with the shared token.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SUPA_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPA_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const BANK_WEBHOOK_TOKEN = Deno.env.get("BANK_WEBHOOK_TOKEN") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
};

async function isAdmin(jwt: string): Promise<boolean> {
  if (!jwt || jwt === SUPA_ANON || jwt.startsWith("sb_publishable_")) return false;
  try {
    const userResp = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { "Authorization": `Bearer ${jwt}`, "apikey": SUPA_ANON },
    });
    if (!userResp.ok) return false;
    const user = await userResp.json();
    if (!user?.id) return false;
    const adminResp = await fetch(`${SUPA_URL}/rest/v1/admin_users?user_id=eq.${user.id}&select=user_id`, {
      headers: { "Authorization": `Bearer ${jwt}`, "apikey": SUPA_ANON },
    });
    const admins = await adminResp.json();
    return Array.isArray(admins) && admins.length > 0;
  } catch { return false; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  const authz = req.headers.get("authorization") ?? "";
  const jwt = authz.replace(/^Bearer\s+/i, "");
  const admin = await isAdmin(jwt);
  if (!admin) {
    return new Response(JSON.stringify({ error: "admin-only endpoint" }), { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }

  if (!BANK_WEBHOOK_TOKEN) {
    return new Response(JSON.stringify({ error: "BANK_WEBHOOK_TOKEN not configured on server" }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }

  try {
    const body = await req.text();
    // Forward to bank-deposit-webhook with the server-side token
    const resp = await fetch(`${SUPA_URL}/functions/v1/bank-deposit-webhook?token=${encodeURIComponent(BANK_WEBHOOK_TOKEN)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const respBody = await resp.text();
    return new Response(respBody, {
      status: resp.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
