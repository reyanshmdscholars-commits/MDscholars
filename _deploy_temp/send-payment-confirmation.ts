// deno-lint-ignore-file no-explicit-any
// MD Scholars — send-payment-confirmation (v2 with syllabus link)
// Triggered from admin.html after payment_status → paid.
// Extends the previous version by attaching a track-specific syllabus link
// and course goals/expectations.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = ["https://mdscholars.com", "https://www.mdscholars.com"];
function corsHeaders(origin: string | null) {
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

async function callerIsAdmin(req: Request): Promise<boolean> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const client = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: { user } } = await client.auth.getUser();
  if (!user?.email) return false;
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data } = await svc.from("admin_users").select("email").eq("email", user.email).maybeSingle();
  return !!data;
}
const FROM = "MD Scholars <billing@mdscholars.com>";
const REPLY_TO = "billing@mdscholars.com";
const BCC_TEAM = "team@mdscholars.com";

function esc(s: string) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

const TRACK_META: Record<string, { label: string; syllabusUrl: string; goals: string[]; expectations: string[] }> = {
  "future-physician": {
    label: "High School — Future Physician Scholars",
    syllabusUrl: "https://mdscholars.com/high-school.html#curriculum",
    goals: [
      "Introduction to biomedical research methodology",
      "Data literacy and critical appraisal of medical literature",
      "Abstract writing and poster development",
      "Physician mentor evaluation letter",
    ],
    expectations: [
      "Attend all 12 weekly live sessions (recorded if you miss)",
      "Complete weekly assignments (typically 1–2 hours)",
      "Submit a final poster or written report by the last week",
    ],
  },
  "pre-med": {
    label: "College / Pre-Med Research Scholars",
    syllabusUrl: "https://mdscholars.com/college.html#curriculum",
    goals: [
      "Complete a dataset-based research project",
      "Submit an abstract to a national or regional conference",
      "Build AMCAS-ready research documentation",
      "Possible co-authorship on a manuscript",
    ],
    expectations: [
      "Attend weekly live mentorship sessions (12 weeks)",
      "Work on your research project 3–5 hours per week",
      "Submit final deliverables — abstract, methods summary, mentor evaluation",
    ],
  },
  "med-accelerator": {
    label: "Medical School Track",
    syllabusUrl: "https://mdscholars.com/medical-student.html#curriculum",
    goals: [
      "Design and complete a clinical research project",
      "Manuscript development with physician co-author",
      "Conference abstract submission (national)",
      "ERAS documentation + performance-based letter of support",
    ],
    expectations: [
      "Weekly 1:1 mentorship (12 weeks)",
      "Independent project work 5–8 hours per week",
      "Manuscript draft submitted by week 10",
    ],
  },
  "resident-accelerator": {
    label: "Resident / Fellow / IMG Track",
    syllabusUrl: "https://mdscholars.com/resident-fellow.html#curriculum",
    goals: [
      "Advanced biostatistics and analysis support",
      "Full manuscript pipeline — from data to submission",
      "Peer review and journal strategy coaching",
      "ACGME documentation + fellowship portfolio",
    ],
    expectations: [
      "Weekly 1:1 with senior physician mentor",
      "Independent research work 6–10 hours per week",
      "Manuscript submitted to a peer-reviewed journal by end of track",
    ],
  },
  "12month": {
    label: "12-Month Advanced Research Track",
    syllabusUrl: "https://mdscholars.com/twelve-month.html#curriculum",
    goals: [
      "Full-cycle research project — from PICO to publication",
      "IRB submission and ethics training",
      "Peer-reviewed manuscript submission",
      "National conference presentation",
    ],
    expectations: [
      "52 weeks of structured, mentored work",
      "6–10 hours per week of research + weekly touchpoints",
      "Manuscript submitted and abstract accepted by month 12",
    ],
  },
  "institutional": {
    label: "Institutional Partnership",
    syllabusUrl: "https://mdscholars.com/for-institutions.html",
    goals: ["Customized curriculum for your cohort", "Dedicated program manager", "Quarterly KPI reporting"],
    expectations: ["Kick-off session within 2 weeks of enrollment", "Weekly cohort touchpoints", "Quarterly review with your institutional lead"],
  },
};

serve(async (req) => {
  const origin = req.headers.get("origin");
  const CORS = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...CORS, "Content-Type": "application/json" } });

  // ── SECURITY: admin-only. Payment confirmations only fire from admin.html
  // or from bank-deposit-webhook (which passes a service-role token).
  if (!(await callerIsAdmin(req))) {
    return new Response(JSON.stringify({ error: "Forbidden: admin required" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  try {
    const body = await req.json();
    const rec = body?.record ?? body ?? {};
    const email = rec.email;
    const firstName = rec.first_name || rec.firstName || "";
    const track = rec.program_track || rec.programTrack || "";
    const sessionLabel = rec.session_label || rec.sessionLabel || null;
    const amountUsd = rec.amount_usd || rec.amount || null;

    if (!email) {
      return new Response(JSON.stringify({ error: "email required" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const meta = TRACK_META[track] || { label: track || "MD Scholars program", syllabusUrl: "https://mdscholars.com/programs.html", goals: [], expectations: [] };

    const goalsList = meta.goals.length ? `<ul style="margin:8px 0 20px 20px; color:#334155; font-size:14px; line-height:1.75;">${meta.goals.map(g => `<li>${esc(g)}</li>`).join("")}</ul>` : "";
    const expectList = meta.expectations.length ? `<ul style="margin:8px 0 20px 20px; color:#334155; font-size:14px; line-height:1.75;">${meta.expectations.map(g => `<li>${esc(g)}</li>`).join("")}</ul>` : "";

    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ ok: false, reason: "RESEND_API_KEY not configured" }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

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
          <p style="margin:0 0 16px; font-size:12px; letter-spacing:0.15em; text-transform:uppercase; color:#0d9488; font-weight:600;">Payment Received</p>
          <h2 style="margin:0 0 12px; font-family:Georgia,serif; font-size:24px; color:#001F3F; line-height:1.25;">You're enrolled, ${esc(firstName || "welcome")}!</h2>
          <p style="margin:0 0 16px; color:#334155; font-size:15px; line-height:1.65;">Congratulations — your payment for <strong>${esc(meta.label)}</strong>${sessionLabel ? ` (${esc(sessionLabel)})` : ""} has been received${amountUsd ? ` ($${Number(amountUsd).toLocaleString()})` : ""}. Welcome to the cohort.</p>

          <div style="margin:20px 0; padding:18px 22px; background:#ecfdf5; border:1px solid #86efac; border-radius:6px; text-align:center;">
            <a href="${esc(meta.syllabusUrl)}" style="display:inline-block; padding:12px 28px; background:#0d9488; color:#fff; text-decoration:none; font-weight:600; border-radius:4px; font-size:15px;">View Your Syllabus →</a>
            <p style="margin:12px 0 0; color:#065f46; font-size:13px;">Full curriculum, week-by-week modules, and deliverables</p>
          </div>

          <h3 style="margin:24px 0 4px; font-family:Georgia,serif; font-size:16px; color:#001F3F;">Course Goals</h3>
          ${goalsList}

          <h3 style="margin:8px 0 4px; font-family:Georgia,serif; font-size:16px; color:#001F3F;">What We Expect From You</h3>
          ${expectList}

          <h3 style="margin:16px 0 8px; font-family:Georgia,serif; font-size:16px; color:#001F3F;">Next Steps</h3>
          <ol style="margin:0 0 16px 20px; color:#334155; font-size:14px; line-height:1.75;">
            <li>Your student ID and portal login will arrive in a separate email within 24 hours</li>
            <li>You'll receive an orientation invitation for the cohort kickoff</li>
            <li>Week 1 course materials will unlock in your portal on the cohort start date</li>
          </ol>

          <div style="margin:24px 0 0; padding:16px 20px; background:#f8f5ef; border-radius:4px; font-size:13px; color:#475569; line-height:1.6;">
            <strong style="color:#001F3F;">Refund policy reminder:</strong> Full refund through the end of week 1 · 50% refund through week 2 · No refund after week 2 starts. Full terms on our <a href="https://mdscholars.com/terms.html" style="color:#0d9488;">Terms page</a>.
          </div>

          <p style="margin:20px 0 0; color:#475569; font-size:14px; line-height:1.6;">Billing questions: <a href="mailto:billing@mdscholars.com" style="color:#0d9488;">billing@mdscholars.com</a> · Course questions: <a href="mailto:support@mdscholars.com" style="color:#0d9488;">support@mdscholars.com</a>.</p>
        </td></tr>
        <tr><td style="background:#f8f5ef; padding:20px 32px; border-top:1px solid #e6e2d8;">
          <p style="margin:0; color:#64748b; font-size:12px; line-height:1.5;">
            MD Scholars LLC · St. Louis, MO · <a href="https://mdscholars.com" style="color:#0d9488;">mdscholars.com</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        bcc: [BCC_TEAM],
        subject: `Payment received — welcome to ${meta.label}`,
        html,
        reply_to: REPLY_TO,
      }),
    });
    const respBody = await resp.text();
    if (!resp.ok) {
      console.error("Resend error", resp.status, respBody);
      return new Response(JSON.stringify({ ok: false, error: respBody }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("send-payment-confirmation error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
