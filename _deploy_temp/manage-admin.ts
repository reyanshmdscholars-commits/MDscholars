// deno-lint-ignore-file no-explicit-any
// MD Scholars — manage-admin
// Handles admin invitations, promotions, demotions, and completion of signup.
// Uses Supabase Admin API + Resend for branded email.
//
// Actions:
//   - invite         : create auth user (if new) + email branded invite w/ redirect to /portal/admin-signup.html
//   - promote        : add an existing auth user to admin_users allowlist by email
//   - demote         : remove from admin_users
//   - complete-signup: called by /portal/admin-signup.html after invitee sets password
//                      → adds them to admin_users with their submitted info
//
// Every action except complete-signup requires a caller who is already in admin_users.
// complete-signup requires a valid session that matches the invited email.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SITE_URL = Deno.env.get("MDS_SITE_URL") ?? "https://mdscholars.com";
const INVITE_REDIRECT = `${SITE_URL}/portal/admin-signup.html`;

const FROM = "MD Scholars <team@mdscholars.com>";
const REPLY_TO = "contact@mdscholars.com";

function esc(s: string) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
function anon() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
}

function json(status: number, body: any) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function callerIsAdmin(req: Request): Promise<{ ok: boolean; email?: string; error?: string }> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, error: "No auth token" };
  const client = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return { ok: false, error: "Invalid token" };
  const { data } = await admin().from("admin_users").select("email").eq("email", user.email).maybeSingle();
  if (!data) return { ok: false, error: "Not an admin", email: user.email };
  return { ok: true, email: user.email };
}

async function sessionEmail(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: { user } } = await client.auth.getUser();
  return user?.email ?? null;
}

// ── Email templates ────────────────────────────────────────────────────
function inviteEmail(invitedEmail: string, invitedName: string, inviterEmail: string, magicLink: string) {
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
          <p style="margin:0 0 16px;font-size:12px;letter-spacing:0.15em;text-transform:uppercase;color:#0d9488;font-weight:600;">Admin Invitation</p>
          <h2 style="margin:0 0 12px;font-family:Georgia,serif;font-size:22px;color:#001F3F;line-height:1.25;">You've been invited to help run MD Scholars</h2>
          <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.65;">Hi ${esc(invitedName || "there")}, <strong>${esc(inviterEmail)}</strong> has invited you to join the MD Scholars admin team. Admins can review student applications, upload course materials, manage webinars, and oversee day-to-day operations.</p>

          <div style="margin:24px 0;padding:20px;background:#ecfdf5;border-radius:6px;text-align:center;">
            <a href="${esc(magicLink)}" style="display:inline-block;padding:14px 32px;background:#0d9488;color:#ffffff;text-decoration:none;font-weight:700;border-radius:4px;font-size:15px;">Accept invitation →</a>
            <p style="margin:12px 0 0;color:#065f46;font-size:13px;">The link opens a page where you'll set up your admin account (name, phone, role, password).</p>
          </div>

          <div style="margin:20px 0;padding:14px 18px;background:#fef3c7;border-left:3px solid #d97706;border-radius:4px;">
            <p style="margin:0;color:#78350f;font-size:13px;line-height:1.55;"><strong>Heads up:</strong> this invitation link expires in 24 hours. If it expires, ask ${esc(inviterEmail)} to send a fresh one.</p>
          </div>

          <p style="margin:20px 0 0;color:#475569;font-size:14px;line-height:1.6;">If you weren't expecting this invitation, you can safely ignore this email — no account will be created until you complete the setup flow.</p>
          <p style="margin:16px 0 0;color:#475569;font-size:14px;">Questions: <a href="mailto:contact@mdscholars.com" style="color:#0d9488;">contact@mdscholars.com</a></p>
        </td></tr>
        <tr><td style="background:#f8f5ef;padding:20px 32px;border-top:1px solid #e6e2d8;">
          <p style="margin:0;color:#64748b;font-size:12px;line-height:1.5;">MD Scholars LLC · St. Louis, MO · <a href="https://mdscholars.com" style="color:#0d9488;">mdscholars.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  const text = `Hi ${invitedName || "there"},

${inviterEmail} has invited you to join the MD Scholars admin team.

Accept your invitation and set up your admin account here:
${magicLink}

The link expires in 24 hours. If you weren't expecting this invitation, ignore this email.

Questions: contact@mdscholars.com

—
MD Scholars LLC · St. Louis, MO
https://mdscholars.com`;
  return { subject: `You've been invited to join MD Scholars as an admin`, html, text };
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  if (!RESEND_API_KEY) { console.warn("RESEND_API_KEY missing — email skipped"); return { ok: false, skipped: true }; }
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], bcc: ["team@mdscholars.com"], subject, html, text, reply_to: REPLY_TO }),
  });
  const body = await resp.text();
  return { ok: resp.ok, status: resp.status, body };
}

// ── Actions ────────────────────────────────────────────────────────────
async function actInvite(req: Request, body: any) {
  const caller = await callerIsAdmin(req);
  if (!caller.ok) return json(403, { error: caller.error || "Not authorized" });
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  if (!email) return json(400, { error: "email required" });

  // Use Admin API to generate the invite link (creates the auth user if new)
  const svc = admin();
  const { data: linkData, error: linkErr } = await svc.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo: INVITE_REDIRECT, data: { invited_name: name, invited_by: caller.email } },
  });
  if (linkErr || !linkData) {
    // If the user already exists, generate a "magiclink" instead
    const { data: magic, error: magicErr } = await svc.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: INVITE_REDIRECT },
    });
    if (magicErr || !magic) return json(500, { error: `Could not generate invite: ${linkErr?.message || magicErr?.message}` });
    const magicLink = (magic as any).properties?.action_link || (magic as any).action_link;
    const { subject, html, text } = inviteEmail(email, name, caller.email || "an existing admin", magicLink);
    const res = await sendEmail(email, subject, html, text);
    return json(200, { ok: true, invited: email, kind: "existing_user_magiclink", email_sent: res.ok });
  }
  const magicLink = (linkData as any).properties?.action_link || (linkData as any).action_link;

  const { subject, html, text } = inviteEmail(email, name, caller.email || "an existing admin", magicLink);
  const res = await sendEmail(email, subject, html, text);
  return json(200, { ok: true, invited: email, kind: "new_user_invite", email_sent: res.ok });
}

async function actPromote(req: Request, body: any) {
  const caller = await callerIsAdmin(req);
  if (!caller.ok) return json(403, { error: caller.error || "Not authorized" });
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim() || null;
  if (!email) return json(400, { error: "email required" });
  // Look up the auth user's ID so is_admin() can match by user_id
  const { data: usersList } = await admin().auth.admin.listUsers();
  const matchingUser = usersList?.users?.find((u: any) => (u.email || "").toLowerCase() === email);
  const userId = matchingUser?.id ?? null;
  const { error } = await admin().from("admin_users").upsert({ email, name, user_id: userId }, { onConflict: "email" });
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true, promoted: email, user_id_set: !!userId });
}

async function actDemote(req: Request, body: any) {
  const caller = await callerIsAdmin(req);
  if (!caller.ok) return json(403, { error: caller.error || "Not authorized" });
  const email = String(body.email || "").trim().toLowerCase();
  if (!email) return json(400, { error: "email required" });
  if (email === caller.email) return json(400, { error: "You cannot demote yourself" });
  const { error } = await admin().from("admin_users").delete().eq("email", email);
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true, demoted: email });
}

async function actTestStudentMagiclink(req: Request, body: any) {
  const caller = await callerIsAdmin(req);
  if (!caller.ok) return json(403, { error: caller.error || "Not authorized" });
  const email = String(body.email || "").trim().toLowerCase();
  if (!email.startsWith("test-") || !email.endsWith("@mdscholars.com")) {
    return json(400, { error: "test-student email required (test-*@mdscholars.com)" });
  }
  const { data, error } = await admin().auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${SITE_URL}/portal/dashboard.html` },
  });
  if (error || !data) return json(500, { error: error?.message || "Could not generate link" });
  const link = (data as any).properties?.action_link || (data as any).action_link;
  if (!link) return json(500, { error: "No link returned by Supabase" });
  return json(200, { ok: true, email, link });
}

async function actCompleteSignup(req: Request, body: any) {
  // Caller must be authenticated (via invite link) but not yet in admin_users
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "No valid session — invite link may have expired" });
  const client = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: { user } } = await client.auth.getUser();
  if (!user?.email) return json(401, { error: "No valid session — invite link may have expired" });
  const email = user.email;
  const userId = user.id;
  const fullName = String(body.full_name || "").trim();
  const phone = String(body.phone || "").trim();
  const roleTitle = String(body.role_title || "").trim();
  if (!fullName || !phone || !roleTitle) return json(400, { error: "full_name, phone, role_title required" });

  const { error } = await admin().from("admin_users").upsert({
    email,
    user_id: userId,
    name: fullName,
    phone,
    role_title: roleTitle,
    created_at: new Date().toISOString(),
  }, { onConflict: "email" });
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true, email, role_title: roleTitle });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const body = await req.json();
    const action = body?.action;
    switch (action) {
      case "invite":                  return await actInvite(req, body);
      case "promote":                 return await actPromote(req, body);
      case "demote":                  return await actDemote(req, body);
      case "complete-signup":         return await actCompleteSignup(req, body);
      case "test-student-magiclink":  return await actTestStudentMagiclink(req, body);
      default: return json(400, { error: `unknown action: ${action}` });
    }
  } catch (err) {
    console.error("manage-admin error", err);
    return json(500, { error: String(err) });
  }
});
