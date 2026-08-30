// MD Scholars — parental-consent-token
// Signed-token workflow for parental consent (protects against fake signatures).
//
// Actions:
//   - generate: (admin OR after minor application submit) → creates token + returns URL
//                Also emails the parent with the consent URL if RESEND_API_KEY is set
//   - verify:   (parental-consent.html on page load) → returns { ok, application_id, child_first, ... }
//   - submit:   (parental-consent.html on submit) → validates token + inserts consent row + marks used
//
// The consent row is inserted server-side with elevated privileges here, so the
// public `parental_consents_anon_insert` policy can eventually be removed.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SITE_URL = Deno.env.get("MDS_SITE_URL") ?? "https://mdscholars.com";

const FROM = "MD Scholars <team@mdscholars.com>";
const REPLY_TO = "contact@mdscholars.com";

function svc() { return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function esc(s: string) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}
function json(status: number, body: any, CORS: Record<string,string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function callerIsAdmin(req: Request): Promise<boolean> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const client = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: { user } } = await client.auth.getUser();
  if (!user?.email) return false;
  const { data } = await svc().from("admin_users").select("email").eq("email", user.email).maybeSingle();
  return !!data;
}

async function sendConsentEmail(to: string, applicantName: string, url: string) {
  if (!RESEND_API_KEY) return { ok: false, skipped: true };
  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f8f5ef;font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f5ef;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
        <tr><td style="background:#001F3F;padding:24px 32px;color:#ffffff;">
          <h1 style="margin:0;font-family:Georgia,serif;font-size:24px;font-weight:700;">MD Scholars</h1>
          <p style="margin:4px 0 0;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#14b8a6;">Research Mentorship</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;font-size:12px;letter-spacing:0.15em;text-transform:uppercase;color:#0d9488;font-weight:600;">Parental Consent Required</p>
          <h2 style="margin:0 0 12px;font-family:Georgia,serif;font-size:22px;color:#001F3F;line-height:1.25;">Your consent is needed for ${esc(applicantName)}</h2>
          <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.65;">${esc(applicantName)} has applied to MD Scholars, our physician-led research mentorship program. Because they're a minor, we need your consent before we can proceed with enrollment.</p>
          <div style="margin:24px 0;padding:20px;background:#ecfdf5;border-radius:6px;text-align:center;">
            <a href="${esc(url)}" style="display:inline-block;padding:14px 32px;background:#0d9488;color:#ffffff;text-decoration:none;font-weight:700;border-radius:4px;font-size:15px;">Review &amp; sign consent →</a>
            <p style="margin:12px 0 0;color:#065f46;font-size:13px;">This secure link is unique to your child's application and expires in 7 days.</p>
          </div>
          <p style="margin:16px 0;color:#475569;font-size:14px;line-height:1.6;">The consent form explains what your child will do in the program, our safeguarding practices, and what data we collect. If you have questions before signing, email <a href="mailto:contact@mdscholars.com" style="color:#0d9488;">contact@mdscholars.com</a>.</p>
        </td></tr>
        <tr><td style="background:#f8f5ef;padding:20px 32px;border-top:1px solid #e6e2d8;">
          <p style="margin:0;color:#64748b;font-size:12px;line-height:1.5;">MD Scholars LLC · St. Louis, MO · <a href="https://mdscholars.com" style="color:#0d9488;">mdscholars.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], bcc: ["team@mdscholars.com"], subject: `Parental consent needed for ${applicantName} — MD Scholars`, html, reply_to: REPLY_TO }),
  });
  return { ok: resp.ok, status: resp.status };
}

async function actGenerate(req: Request, body: any, CORS: any) {
  // Admin OR called by other trusted flow with application_id
  const isAdmin = await callerIsAdmin(req);
  const appId = String(body.application_id || "");
  if (!appId) return json(400, { error: "application_id required" }, CORS);
  // Load applicant details
  const { data: app } = await svc().from("applications").select("id, first_name, last_name, parent_email, date_of_birth").eq("id", appId).maybeSingle();
  if (!app) return json(404, { error: "application not found" }, CORS);
  const parentEmail = (body.parent_email || app.parent_email || "").toString().trim().toLowerCase();
  if (!parentEmail) return json(400, { error: "parent_email required" }, CORS);
  // Rate-limit: only admin OR the recent-application flow can generate
  if (!isAdmin) {
    // Non-admin path: only allow generation within 5 minutes of application creation
    const { data: appMeta } = await svc().from("applications").select("created_at").eq("id", appId).maybeSingle();
    if (!appMeta || (Date.now() - new Date(appMeta.created_at).getTime()) > 5 * 60 * 1000) {
      return json(403, { error: "Non-admin generation only allowed within 5 minutes of application submission" }, CORS);
    }
  }
  const { data: tok, error: tokErr } = await svc().from("parental_consent_tokens").insert({
    application_id: appId,
    parent_email: parentEmail,
    child_first: app.first_name,
    child_last: app.last_name,
    child_dob: app.date_of_birth,
    created_by: isAdmin ? "admin" : "auto",
  }).select("id").single();
  if (tokErr) return json(500, { error: tokErr.message }, CORS);
  const url = `${SITE_URL}/portal/parental-consent.html?token=${tok.id}`;
  const emailRes = await sendConsentEmail(parentEmail, `${app.first_name || "your child"} ${app.last_name || ""}`.trim(), url);
  return json(200, { ok: true, token_id: tok.id, url, email_sent: emailRes.ok });
}

async function actVerify(req: Request, body: any, CORS: any) {
  const tokenId = String(body.token || "");
  if (!tokenId) return json(400, { error: "token required" }, CORS);
  const { data: t } = await svc().from("parental_consent_tokens").select("*").eq("id", tokenId).maybeSingle();
  if (!t) return json(404, { error: "invalid or unknown token" }, CORS);
  if (t.used_at) return json(410, { error: "This link has already been used" }, CORS);
  if (t.expires_at && new Date(t.expires_at) < new Date()) return json(410, { error: "This link has expired" }, CORS);
  return json(200, {
    ok: true,
    application_id: t.application_id,
    parent_email: t.parent_email,
    child_first: t.child_first,
    child_last: t.child_last,
    child_dob: t.child_dob,
    expires_at: t.expires_at,
  }, CORS);
}

async function actSubmit(req: Request, body: any, CORS: any) {
  const tokenId = String(body.token || "");
  if (!tokenId) return json(400, { error: "token required" }, CORS);
  const { data: t, error: tErr } = await svc().from("parental_consent_tokens").select("*").eq("id", tokenId).maybeSingle();
  if (tErr || !t) return json(404, { error: "invalid token" }, CORS);
  if (t.used_at) return json(410, { error: "Consent already submitted with this link" }, CORS);
  if (t.expires_at && new Date(t.expires_at) < new Date()) return json(410, { error: "Link expired — request a new one" }, CORS);

  // Required consent fields
  const parentName = String(body.parent_name || "").trim();
  const relationship = String(body.relationship || "").trim();
  const signature = String(body.signature || "").trim();
  const parentPhone = String(body.parent_phone || "").trim();
  if (!parentName || !relationship || !signature) return json(400, { error: "parent_name, relationship, signature required" }, CORS);
  if (signature.toLowerCase() !== parentName.toLowerCase()) return json(400, { error: "Signature must match printed name" }, CORS);

  // Insert into parental_consents
  const { error: insErr } = await svc().from("parental_consents").insert({
    application_id: t.application_id,
    parent_email: t.parent_email,
    parent_name: parentName,
    parent_phone: parentPhone,
    relationship,
    child_first_name: t.child_first,
    child_last_name: t.child_last,
    child_dob: t.child_dob,
    signature,
    status: "signed",
    signed_at: new Date().toISOString(),
    consent_token_id: tokenId,
  });
  if (insErr) return json(500, { error: `Failed to save consent: ${insErr.message}` }, CORS);

  // Mark token as used
  await svc().from("parental_consent_tokens").update({ used_at: new Date().toISOString() }).eq("id", tokenId);

  return json(200, { ok: true, message: "Consent recorded" }, CORS);
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  const CORS = cors(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" }, CORS);
  try {
    const body = await req.json();
    switch (body?.action) {
      case "generate": return await actGenerate(req, body, CORS);
      case "verify":   return await actVerify(req, body, CORS);
      case "submit":   return await actSubmit(req, body, CORS);
      default: return json(400, { error: `unknown action: ${body?.action}` }, CORS);
    }
  } catch (err) {
    return json(500, { error: String(err) }, CORS);
  }
});
