



// MD Scholars -- send-webinar-reminders
// Called by pg_cron every 5 minutes. Finds webinars starting in ~60 min,
// sends a reminder email to each registered attendee who hasn't been reminded yet.
//
// Idempotent: marks webinar_registrations.reminder_sent_at so it won't double-send.
// Callable manually from admin.html "Send reminders now" button too.

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
const CRON_SECRET = Deno.env.get("MDS_CRON_SECRET") ?? "";  // Shared secret for pg_cron -> edge fn
const FROM = "MD Scholars <team@mdscholars.com>";

function svc() { return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function esc(s: string) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}
function json(status: number, body: any, CORS: Record<string,string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Render date/time in Central Time (MD Scholars operates from St. Louis).
// Deno edge runtime defaults to UTC so we MUST pass the timezone explicitly.
function fmtDate(iso: string) {
  if (!iso) return { date: "TBD", time: "" };
  const d = new Date(iso);
  const TZ = "America/Chicago";
  return {
    date: d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: TZ }),
    time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: TZ }),
  };
}

function reminderEmailHtml(name: string, w: any) {
  const dt = fmtDate(w.scheduled_at);
  const join = w.join_url
    ? `<div style="margin:24px 0;padding:20px;background:#0d9488;border-radius:6px;text-align:center;">
         <a href="${esc(w.join_url)}" style="display:inline-block;padding:14px 32px;background:#ffffff;color:#0d9488;text-decoration:none;font-weight:700;border-radius:4px;font-size:16px;">Join the Webinar -></a>
         <p style="margin:12px 0 0;color:#d1fae5;font-size:13px;">Or copy: <a href="${esc(w.join_url)}" style="color:#ffffff;word-break:break-all;">${esc(w.join_url)}</a></p>
       </div>`
    : `<p style="margin:16px 0;color:#78350f;background:#fef3c7;padding:14px 18px;border-left:4px solid #d97706;border-radius:4px;">The join link will be shared shortly. Watch your inbox.</p>`;
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f8f5ef;font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f5ef;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
      <tr><td style="background:#001F3F;padding:24px 32px;color:#fff;">
        <h1 style="margin:0;font-family:Georgia,serif;font-size:24px;font-weight:700;">MD Scholars</h1>
        <p style="margin:4px 0 0;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#14b8a6;">Research Mentorship</p>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="margin:0 0 12px;font-size:12px;letter-spacing:0.15em;text-transform:uppercase;color:#d97706;font-weight:600;">[!] Starting Soon</p>
        <h2 style="margin:0 0 8px;font-family:Georgia,serif;font-size:22px;color:#001F3F;line-height:1.25;">${esc(w.title)}</h2>
        <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">Hi ${esc(name || "there")}, your MD Scholars webinar starts in about <strong>1 hour</strong>. Here's your reminder + join link.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;border-collapse:collapse;">
          <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:13px;width:120px;">Date</td>
              <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:15px;font-weight:500;">${esc(dt.date)}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:13px;">Time</td>
              <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:15px;font-weight:500;">${esc(dt.time)}</td></tr>
          ${w.presenter ? `<tr><td style="padding:10px 0;color:#64748b;font-size:13px;">Presenter</td>
              <td style="padding:10px 0;color:#0f172a;font-size:15px;font-weight:500;">${esc(w.presenter)}</td></tr>` : ""}
        </table>
        ${join}
        <p style="margin:20px 0 0;color:#475569;font-size:14px;line-height:1.6;">See you soon! Questions? Reply to this email or write <a href="mailto:contact@mdscholars.com" style="color:#0d9488;">contact@mdscholars.com</a>.</p>
      </td></tr>
      <tr><td style="background:#f8f5ef;padding:20px 32px;border-top:1px solid #e6e2d8;">
        <p style="margin:0;color:#64748b;font-size:12px;line-height:1.5;">MD Scholars LLC . St. Louis, MO . <a href="https://mdscholars.com" style="color:#0d9488;">mdscholars.com</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

async function sendReminder(reg: any, w: any) {
  if (!RESEND_API_KEY) return { ok: false, skipped: true, reason: "no RESEND_API_KEY" };
  const html = reminderEmailHtml(reg.name || "there", w);
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [reg.email],
      subject: `Starting in 1 hour -- ${w.title}`,
      html,
      reply_to: "contact@mdscholars.com",
    }),
  });
  return { ok: resp.ok, status: resp.status };
}

async function processReminders(scope: { webinarId?: string; force?: boolean }) {
  const db = svc();
  // Time window: webinars scheduled 45-90 min from now (60min-target with slop)
  const now = new Date();
  const windowStart = new Date(now.getTime() + 45 * 60 * 1000).toISOString();
  const windowEnd   = new Date(now.getTime() + 90 * 60 * 1000).toISOString();

  let q = db.from("webinars").select("id, title, scheduled_at, join_url, presenter, duration_minutes").eq("is_published", true);
  if (scope.webinarId) q = q.eq("id", scope.webinarId);
  else q = q.gte("scheduled_at", windowStart).lte("scheduled_at", windowEnd);
  const { data: webinars, error: wErr } = await q;
  if (wErr) return { error: wErr.message };
  if (!webinars || webinars.length === 0) return { ok: true, webinars_checked: 0, sent: 0 };

  const results: any[] = [];
  for (const w of webinars) {
    let regQ = db.from("webinar_registrations").select("id, name, email, reminder_sent_at").eq("webinar_id", w.id);
    if (!scope.force) regQ = regQ.is("reminder_sent_at", null);
    const { data: regs } = await regQ;
    if (!regs || regs.length === 0) { results.push({ webinar: w.id, sent: 0 }); continue; }
    let sent = 0, failed = 0;
    for (const reg of regs) {
      const r = await sendReminder(reg, w);
      if (r.ok) {
        sent++;
        await db.from("webinar_registrations").update({ reminder_sent_at: new Date().toISOString() }).eq("id", reg.id);
      } else {
        failed++;
      }
    }
    results.push({ webinar: w.id, title: w.title, registrations: regs.length, sent, failed });
  }
  return { ok: true, results };
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

serve(async (req) => {
  const origin = req.headers.get("origin");
  const CORS = cors(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" }, CORS);

  try {
    const body = await req.json().catch(() => ({}));
    // Auth: (1) cron header with shared secret, OR (2) admin JWT
    const cronHeader = req.headers.get("x-mds-cron-secret") || body?.cron_secret || "";
    const isCron = CRON_SECRET && cronHeader === CRON_SECRET;
    const isAdmin = isCron ? true : await callerIsAdmin(req);
    if (!isAdmin) return json(403, { error: "Forbidden: admin or valid cron secret required" }, CORS);

    const result = await processReminders({ webinarId: body?.webinar_id, force: !!body?.force });
    return json(200, result, CORS);
  } catch (err) {
    return json(500, { error: String(err) }, CORS);
  }
});
