// deno-lint-ignore-file no-explicit-any
// MD Scholars — send-application-status
// Deployed as a Supabase Edge Function. Sends templated status emails to
// applicants (received, accepted, deferred, rejected, reminder). Uses
// Resend HTTP API. Falls back gracefully if RESEND_API_KEY isn't set.
//
// Trigger from admin.html status changes AND from apply.html after insert.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = "MD Scholars <team@mdscholars.com>";
const REPLY_TO = "contact@mdscholars.com";
const BCC_TEAM = "team@mdscholars.com";

function esc(s: string) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

const TRACK_LABELS: Record<string, string> = {
  "future-physician": "High School — Future Physician Scholars",
  "pre-med":          "College / Pre-Med Research Scholars",
  "med-accelerator":  "Medical School Track",
  "resident-accelerator": "Resident / Fellow / IMG Track",
  "12month":          "12-Month Advanced Research Track",
  "institutional":    "Institutional Partnership",
};

const TRACK_PRICES: Record<string, { standard: number; earlyBird: number; syllabus: string }> = {
  "future-physician": { standard: 1199, earlyBird: 1049, syllabus: "https://mdscholars.com/high-school.html#curriculum" },
  "pre-med":          { standard: 1399, earlyBird: 1249, syllabus: "https://mdscholars.com/college.html#curriculum" },
  "med-accelerator":  { standard: 1599, earlyBird: 1449, syllabus: "https://mdscholars.com/medical-student.html#curriculum" },
  "resident-accelerator": { standard: 1599, earlyBird: 1449, syllabus: "https://mdscholars.com/resident-fellow.html#curriculum" },
  "12month":          { standard: 1799, earlyBird: 1599, syllabus: "https://mdscholars.com/twelve-month.html#curriculum" },
  "institutional":    { standard: 0,    earlyBird: 0,    syllabus: "https://mdscholars.com/for-institutions.html" },
};

function wrap(title: string, previewText: string, bodyHtml: string) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body style="margin:0; padding:0; background:#f8f5ef; font-family:-apple-system,'Segoe UI',Arial,sans-serif; color:#0f172a;">
  <span style="display:none; visibility:hidden; opacity:0; height:0; width:0; overflow:hidden;">${esc(previewText)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f5ef; padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; background:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.05);">
        <tr><td style="background:#001F3F; padding:24px 32px; color:#ffffff;">
          <h1 style="margin:0; font-family:Georgia,serif; font-size:24px; font-weight:700;">MD Scholars</h1>
          <p style="margin:4px 0 0; font-size:12px; letter-spacing:0.1em; text-transform:uppercase; color:#14b8a6;">Research Mentorship</p>
        </td></tr>
        <tr><td style="padding:32px;">${bodyHtml}</td></tr>
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
}

function renderReceived(p: any) {
  const html = `
    <p style="margin:0 0 16px; font-size:12px; letter-spacing:0.15em; text-transform:uppercase; color:#0d9488; font-weight:600;">Application Received</p>
    <h2 style="margin:0 0 12px; font-family:Georgia,serif; font-size:22px; color:#001F3F; line-height:1.25;">Thanks for applying, ${esc(p.first_name || "there")}</h2>
    <p style="margin:0 0 16px; color:#334155; font-size:15px; line-height:1.65;">We've received your application for <strong>${esc(TRACK_LABELS[p.program_track] || p.program_track || "MD Scholars")}</strong>${p.session_label ? ` — <strong>${esc(p.session_label)}</strong>` : ""}. Our team is reviewing it now.</p>
    <div style="margin:20px 0; padding:16px 20px; background:#f8f5ef; border-left:4px solid #0d9488; border-radius:4px;">
      <p style="margin:0; color:#001F3F; font-size:14px; line-height:1.6;"><strong>What happens next:</strong><br>Expect a decision within <strong>3–5 business days</strong>. We'll email you as soon as your application has been reviewed.</p>
    </div>
    <p style="margin:20px 0 8px; color:#475569; font-size:14px; line-height:1.6;">While you wait, feel free to:</p>
    <ul style="margin:0 0 16px 20px; color:#475569; font-size:14px; line-height:1.75;">
      <li>Watch our <a href="https://mdscholars.com/about.html" style="color:#0d9488;">founder introduction</a></li>
      <li>Browse <a href="https://mdscholars.com/testimonials.html" style="color:#0d9488;">student testimonials</a></li>
      <li>Read the <a href="https://mdscholars.com/faqs.html" style="color:#0d9488;">FAQs</a></li>
    </ul>
    <p style="margin:24px 0 0; color:#475569; font-size:14px; line-height:1.6;">Questions? Reply to this email or write <a href="mailto:contact@mdscholars.com" style="color:#0d9488;">contact@mdscholars.com</a>.</p>`;
  return { subject: `We received your MD Scholars application`, html: wrap("Application received", "Your MD Scholars application is under review — decision in 3–5 business days.", html) };
}

function renderAccepted(p: any) {
  const track = TRACK_PRICES[p.program_track];
  const paymentBlock = track && track.standard > 0 ? `
    <div style="margin:20px 0; padding:20px 24px; background:#ecfdf5; border:1px solid #86efac; border-radius:6px;">
      <p style="margin:0 0 6px; font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:#065f46; font-weight:600;">Program Tuition</p>
      <p style="margin:0 0 4px; font-size:24px; font-weight:700; color:#001F3F;">$${track.standard.toLocaleString()}</p>
      <p style="margin:0 0 12px; color:#065f46; font-size:14px;">or <strong>$${track.earlyBird.toLocaleString()}</strong> with early-signup discount (paid in full at enrollment)</p>
      <a href="https://mdscholars.com/enroll.html" style="display:inline-block; padding:12px 24px; background:#0d9488; color:#fff; text-decoration:none; font-weight:600; border-radius:4px; font-size:14px;">Complete Enrollment →</a>
    </div>
    <p style="margin:16px 0; color:#475569; font-size:14px; line-height:1.6;">Payment methods: ACH / wire transfer, mail-in check. Full instructions on the <a href="https://mdscholars.com/enroll.html" style="color:#0d9488;">enrollment page</a>. Instalment plans (two payments) are available on request — email <a href="mailto:billing@mdscholars.com" style="color:#0d9488;">billing@mdscholars.com</a>.</p>` : "";

  const html = `
    <p style="margin:0 0 16px; font-size:12px; letter-spacing:0.15em; text-transform:uppercase; color:#0d9488; font-weight:600;">Congratulations</p>
    <h2 style="margin:0 0 12px; font-family:Georgia,serif; font-size:24px; color:#001F3F; line-height:1.25;">You've been accepted, ${esc(p.first_name || "there")}!</h2>
    <p style="margin:0 0 16px; color:#334155; font-size:15px; line-height:1.65;">We're excited to welcome you to <strong>${esc(TRACK_LABELS[p.program_track] || p.program_track || "MD Scholars")}</strong>${p.session_label ? ` — <strong>${esc(p.session_label)}</strong>` : ""}. Your background and research interests were a strong fit for the program.</p>
    ${paymentBlock}
    <p style="margin:20px 0 8px; color:#475569; font-size:14px; line-height:1.6;"><strong style="color:#001F3F;">Next steps:</strong></p>
    <ol style="margin:0 0 16px 20px; color:#475569; font-size:14px; line-height:1.85;">
      <li>Complete your payment via the enrollment link above</li>
      <li>You'll receive a payment-confirmation email with your student ID and portal login</li>
      <li>Course materials and orientation info follow within 48 hours of enrollment</li>
    </ol>
    <p style="margin:24px 0 0; color:#475569; font-size:14px; line-height:1.6;">Questions about tuition or enrollment? Email <a href="mailto:billing@mdscholars.com" style="color:#0d9488;">billing@mdscholars.com</a>. General questions to <a href="mailto:contact@mdscholars.com" style="color:#0d9488;">contact@mdscholars.com</a>.</p>`;
  return { subject: `🎉 Accepted to MD Scholars — ${TRACK_LABELS[p.program_track] || "next steps inside"}`, html: wrap("You're accepted", "Congratulations — welcome to MD Scholars. Complete enrollment to secure your spot.", html) };
}

function renderReminder(p: any) {
  const track = TRACK_PRICES[p.program_track];
  const html = `
    <p style="margin:0 0 16px; font-size:12px; letter-spacing:0.15em; text-transform:uppercase; color:#d97706; font-weight:600;">Reminder</p>
    <h2 style="margin:0 0 12px; font-family:Georgia,serif; font-size:22px; color:#001F3F; line-height:1.25;">Your MD Scholars spot is still waiting</h2>
    <p style="margin:0 0 16px; color:#334155; font-size:15px; line-height:1.65;">Hi ${esc(p.first_name || "there")}, we noticed you haven't completed enrollment for <strong>${esc(TRACK_LABELS[p.program_track] || p.program_track || "your program")}</strong>${p.session_label ? ` (${esc(p.session_label)})` : ""}. Cohort spots are limited and we'd love to have you.</p>
    <div style="margin:20px 0; padding:18px 22px; background:#fef3c7; border-left:4px solid #d97706; border-radius:4px;">
      <p style="margin:0; color:#78350f; font-size:14px; line-height:1.6;">${track && track.earlyBird < track.standard ? `<strong>Early-signup discount still available:</strong> save $${(track.standard - track.earlyBird).toLocaleString()} when you pay in full at enrollment.` : "Complete enrollment to secure your spot in the upcoming cohort."}</p>
    </div>
    <p style="margin:16px 0; text-align:center;">
      <a href="https://mdscholars.com/enroll.html" style="display:inline-block; padding:12px 28px; background:#0d9488; color:#fff; text-decoration:none; font-weight:600; border-radius:4px; font-size:15px;">Complete Enrollment →</a>
    </p>
    <p style="margin:24px 0 8px; color:#475569; font-size:14px; line-height:1.6;">Need more time or want to defer to the next session? Reply to this email and we'll help figure out the best path.</p>
    <p style="margin:16px 0 0; color:#475569; font-size:14px;">Questions: <a href="mailto:billing@mdscholars.com" style="color:#0d9488;">billing@mdscholars.com</a></p>`;
  return { subject: `Reminder — your MD Scholars spot is still open`, html: wrap("Reminder", "Your accepted spot is still open — complete enrollment to secure your cohort seat.", html) };
}

function renderDeferred(p: any) {
  const html = `
    <p style="margin:0 0 16px; font-size:12px; letter-spacing:0.15em; text-transform:uppercase; color:#0d9488; font-weight:600;">Application Update</p>
    <h2 style="margin:0 0 12px; font-family:Georgia,serif; font-size:22px; color:#001F3F; line-height:1.25;">You're accepted for our next session</h2>
    <p style="margin:0 0 16px; color:#334155; font-size:15px; line-height:1.65;">Hi ${esc(p.first_name || "there")}, thanks for applying to <strong>${esc(TRACK_LABELS[p.program_track] || p.program_track || "MD Scholars")}</strong>. The current cohort is full, but based on the strength of your application we're offering you a guaranteed spot in the <strong>next available session</strong>.</p>
    <div style="margin:20px 0; padding:16px 20px; background:#f8f5ef; border-left:4px solid #0d9488; border-radius:4px;">
      <p style="margin:0; color:#001F3F; font-size:14px; line-height:1.6;"><strong>What this means:</strong> we've held your application on file. When registration for the next cohort opens, you'll be one of the first to receive an enrollment invitation with pricing details.</p>
    </div>
    <p style="margin:16px 0 8px; color:#475569; font-size:14px; line-height:1.6;">You don't need to reapply — just watch for our email when the next session opens (typically 6–8 weeks before the cohort start date).</p>
    <p style="margin:16px 0 0; color:#475569; font-size:14px; line-height:1.6;">Have questions or want to be considered for a waitlist spot in the current cohort? Reply to this email or write <a href="mailto:contact@mdscholars.com" style="color:#0d9488;">contact@mdscholars.com</a>.</p>`;
  return { subject: `MD Scholars — accepted for our next session`, html: wrap("Deferred acceptance", "The current cohort is full — we've held your spot for the next session.", html) };
}

function renderRejected(p: any) {
  const html = `
    <p style="margin:0 0 16px; font-size:12px; letter-spacing:0.15em; text-transform:uppercase; color:#64748b; font-weight:600;">Application Update</p>
    <h2 style="margin:0 0 12px; font-family:Georgia,serif; font-size:22px; color:#001F3F; line-height:1.25;">Thank you for applying, ${esc(p.first_name || "there")}</h2>
    <p style="margin:0 0 16px; color:#334155; font-size:15px; line-height:1.65;">Thank you for the time and thought you put into your MD Scholars application. After careful review, we're not able to offer you a spot in the current cohort.</p>
    <p style="margin:16px 0; color:#334155; font-size:15px; line-height:1.65;">This isn't a reflection of your potential — cohort spots are limited and we're only able to accept applicants where we're confident the program is the strongest fit right now. Many of our current students applied more than once before joining.</p>
    <div style="margin:20px 0; padding:16px 20px; background:#f8f5ef; border-radius:4px;">
      <p style="margin:0; color:#001F3F; font-size:14px; line-height:1.6;"><strong>We'd love for you to reapply.</strong> Whether you're building more research background, finishing coursework, or refining your interests, we'll be glad to reconsider in a future cycle.</p>
    </div>
    <p style="margin:16px 0 0; color:#475569; font-size:14px; line-height:1.6;">In the meantime, our <a href="https://mdscholars.com/webinars.html" style="color:#0d9488;">free webinars</a> and <a href="https://mdscholars.com/showcase.html" style="color:#0d9488;">student showcase</a> are open to everyone. Feedback or questions welcome at <a href="mailto:contact@mdscholars.com" style="color:#0d9488;">contact@mdscholars.com</a>.</p>`;
  return { subject: `MD Scholars — application update`, html: wrap("Application update", "Thank you for applying — we'd love for you to reapply in a future cycle.", html) };
}

function render(kind: string, payload: any) {
  switch (kind) {
    case "received": return renderReceived(payload);
    case "accepted": return renderAccepted(payload);
    case "reminder": return renderReminder(payload);
    case "deferred": return renderDeferred(payload);
    case "rejected": return renderRejected(payload);
    default: return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const body = await req.json();
    const { kind, email, first_name, last_name, program_track, session_label } = body ?? {};
    if (!kind || !email) {
      return new Response(JSON.stringify({ error: "kind and email required" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    const rendered = render(kind, { email, first_name, last_name, program_track, session_label });
    if (!rendered) {
      return new Response(JSON.stringify({ error: `unknown kind: ${kind}` }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ ok: false, reason: "RESEND_API_KEY not configured", preview: rendered.subject }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        bcc: [BCC_TEAM],
        subject: rendered.subject,
        html: rendered.html,
        reply_to: REPLY_TO,
      }),
    });
    const respBody = await resp.text();
    if (!resp.ok) {
      console.error("Resend error", resp.status, respBody);
      return new Response(JSON.stringify({ ok: false, error: respBody }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, kind }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("send-application-status error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
