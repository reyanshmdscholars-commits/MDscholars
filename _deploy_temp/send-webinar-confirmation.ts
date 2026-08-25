// deno-lint-ignore-file no-explicit-any
// MD Scholars — send-webinar-confirmation
// Deployed as a Supabase Edge Function. Sends a confirmation email with the
// webinar join link to the registrant, using Resend HTTP API. Falls back
// gracefully if RESEND_API_KEY isn't set.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = "MD Scholars <contact@mdscholars.com>";
const BCC = "contact@mdscholars.com";

function esc(s: string) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

function fmtDate(iso: string) {
  if (!iso) return { date: "TBD", time: "", tz: "" };
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
    tz: "",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  try {
    const body = await req.json();
    const { name, email, phone, stage, title, scheduled, duration, presenter, joinUrl } = body ?? {};
    if (!email || !title) {
      return new Response(JSON.stringify({ error: "email and title required" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ ok: false, reason: "RESEND_API_KEY not configured" }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const dt = fmtDate(scheduled);
    const joinBlock = joinUrl
      ? `<div style="margin:24px 0; padding:20px; background:#0d9488; border-radius:6px; text-align:center;">
           <a href="${esc(joinUrl)}" style="display:inline-block; padding:14px 32px; background:#ffffff; color:#0d9488; text-decoration:none; font-weight:700; border-radius:4px; font-size:16px;">Join the Webinar →</a>
           <p style="margin:12px 0 0; color:#d1fae5; font-size:13px;">Or copy this link: <a href="${esc(joinUrl)}" style="color:#ffffff; word-break:break-all;">${esc(joinUrl)}</a></p>
         </div>`
      : `<div style="margin:24px 0; padding:16px 20px; background:#fef3c7; border-left:4px solid #d97706; border-radius:4px;">
           <p style="margin:0; color:#78350f; font-size:14px;">The join link will be emailed to you as soon as it's ready — typically 24-48 hours before the session.</p>
         </div>`;

    const html = `<!DOCTYPE html>
<html><body style="margin:0; padding:0; background:#f8f5ef; font-family:-apple-system,'Segoe UI',Arial,sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f5ef; padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; background:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.05);">
        <tr><td style="background:#001F3F; padding:24px 32px; color:#ffffff;">
          <h1 style="margin:0; font-family:Georgia,serif; font-size:24px; font-weight:700;">MD Scholars</h1>
          <p style="margin:4px 0 0; font-size:12px; letter-spacing:0.1em; text-transform:uppercase; color:#14b8a6;">Research Mentorship</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px; font-size:12px; letter-spacing:0.15em; text-transform:uppercase; color:#0d9488; font-weight:600;">You're Registered</p>
          <h2 style="margin:0 0 8px; font-family:Georgia,serif; font-size:22px; color:#001F3F; line-height:1.25;">${esc(title)}</h2>
          <p style="margin:0 0 20px; color:#475569; font-size:15px; line-height:1.6;">Hi ${esc(name || "there")}, thanks for registering. Here are the details for the session:</p>

          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; margin:16px 0; border-collapse:collapse;">
            <tr><td style="padding:10px 0; border-bottom:1px solid #f1f5f9; color:#64748b; font-size:13px; width:120px;">Date</td>
                <td style="padding:10px 0; border-bottom:1px solid #f1f5f9; color:#0f172a; font-size:15px; font-weight:500;">${esc(dt.date)}</td></tr>
            ${dt.time ? `<tr><td style="padding:10px 0; border-bottom:1px solid #f1f5f9; color:#64748b; font-size:13px;">Time</td>
                <td style="padding:10px 0; border-bottom:1px solid #f1f5f9; color:#0f172a; font-size:15px; font-weight:500;">${esc(dt.time)}</td></tr>` : ""}
            ${duration ? `<tr><td style="padding:10px 0; border-bottom:1px solid #f1f5f9; color:#64748b; font-size:13px;">Duration</td>
                <td style="padding:10px 0; border-bottom:1px solid #f1f5f9; color:#0f172a; font-size:15px; font-weight:500;">${esc(String(duration))} min</td></tr>` : ""}
            ${presenter ? `<tr><td style="padding:10px 0; color:#64748b; font-size:13px;">Presenter</td>
                <td style="padding:10px 0; color:#0f172a; font-size:15px; font-weight:500;">${esc(presenter)}</td></tr>` : ""}
          </table>

          ${joinBlock}

          <p style="margin:20px 0 0; color:#475569; font-size:14px; line-height:1.6;">
            Save this email — the join link stays here so you can come back to it any time. Add the date to your calendar and we'll see you there.
          </p>
          <p style="margin:16px 0 0; color:#475569; font-size:14px; line-height:1.6;">
            Questions? Reply to this email or write to
            <a href="mailto:contact@mdscholars.com" style="color:#0d9488;">contact@mdscholars.com</a>.
          </p>
        </td></tr>
        <tr><td style="background:#f8f5ef; padding:20px 32px; border-top:1px solid #e6e2d8;">
          <p style="margin:0; color:#64748b; font-size:12px; line-height:1.5;">
            MD Scholars LLC · St. Louis, MO<br>
            <a href="https://mdscholars.com" style="color:#0d9488;">mdscholars.com</a> · Physician-led research mentorship
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    const text = `You're registered for: ${title}

Date: ${dt.date}
${dt.time ? `Time: ${dt.time}\n` : ""}${duration ? `Duration: ${duration} min\n` : ""}${presenter ? `Presenter: ${presenter}\n` : ""}
${joinUrl ? `Join link: ${joinUrl}\n` : "The join link will be emailed to you when it's ready.\n"}
Save this email — the join link stays here so you can come back to it anytime.

Questions? Reply to this email or write contact@mdscholars.com.

—
MD Scholars LLC · St. Louis, MO
https://mdscholars.com`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        bcc: [BCC],
        subject: `You're registered — ${title}`,
        html,
        text,
        reply_to: "contact@mdscholars.com",
      }),
    });
    const respBody = await resp.text();
    if (!resp.ok) {
      console.error("Resend error", resp.status, respBody);
      return new Response(JSON.stringify({ ok: false, error: respBody }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("send-webinar-confirmation error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
