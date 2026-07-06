// Supabase Edge Function: send-status-change
// Triggered by a Database Webhook on UPDATE of public.applications where status changed.
// Sends accept / waitlist / reject email to the applicant via Resend.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_TEAM_EMAIL = Deno.env.get("FROM_TEAM_EMAIL") ?? Deno.env.get("FROM_EMAIL") ?? "MD Scholars <team@mdscholars.com>";

const TRACK_LABELS: Record<string, string> = {
  "future-physician": "Future Physician Scholars (High School)",
  "pre-med": "Pre-Med Research Scholars (College)",
  "med-accelerator": "Medical Student Accelerator",
  "resident-accelerator": "Resident & Fellow Accelerator",
  "12month": "12-Month Research Track",
  "institutional": "Institutional Program",
};

function shell(title: string, bodyHtml: string): string {
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f8f5ef;font-family:'DM Sans',-apple-system,Segoe UI,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f5ef;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">
        <tr><td style="background:linear-gradient(135deg,#001F3F,#0d9488);padding:32px;text-align:center;color:#ffffff;">
          <div style="font-family:'Playfair Display',Georgia,serif;font-size:28px;font-weight:700;">MD Scholars</div>
          <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#14b8a6;margin-top:6px;">Research Mentorship</div>
        </td></tr>
        <tr><td style="padding:36px;">
          <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:24px;color:#001F3F;margin:0 0 16px;">${title}</h1>
          ${bodyHtml}
          <p style="font-size:15px;line-height:1.6;margin:24px 0 0;color:#475569;">— The MD Scholars Team</p>
        </td></tr>
        <tr><td style="background:#001F3F;padding:20px 36px;color:#94a3b8;font-size:12px;text-align:center;">
          MD Scholars LLC · Physician-Led Research Mentorship
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function acceptedBody(firstName: string, trackLabel: string): string {
  return `
<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ${firstName},</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Congratulations! You've been <strong style="color:#0d9488;">accepted</strong> into the <strong>${trackLabel}</strong> track at MD Scholars.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">We were impressed by your application and we're excited to have you join an upcoming cohort.</p>
<div style="background:#f0f9f8;border-left:4px solid #14b8a6;padding:16px 20px;border-radius:6px;margin:24px 0;">
  <strong style="color:#001F3F;display:block;margin-bottom:8px;">Next steps</strong>
  <ol style="margin:0;padding-left:20px;color:#475569;font-size:15px;line-height:1.7;">
    <li><strong>Watch your inbox</strong> for a second email titled <em>"Set up your MD Scholars account"</em> — it contains your link to create a password and access the student portal.</li>
    <li>Once you've set your password, sign in at <a href="https://mdscholars.com/portal/login.html" style="color:#0d9488;text-decoration:none;font-weight:600;">mdscholars.com/portal/login.html</a>.</li>
    <li>Complete payment using the instructions below to secure your spot in the cohort.</li>
  </ol>
</div>
<p style="margin:20px 0 12px;text-align:center;"><a href="https://mdscholars.com/portal/login.html" style="background:#14b8a6;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">Open Student Portal →</a></p>

<h2 style="font-family:'Playfair Display',Georgia,serif;color:#001F3F;font-size:18px;margin:32px 0 12px;">Payment Options</h2>
<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 12px;">Your track-specific tuition will be sent in a follow-up message. Choose one of the options below to complete payment:</p>

<div style="background:#ecfdf5;border-left:4px solid #10b981;padding:14px 18px;border-radius:6px;margin:12px 0;">
  <strong style="color:#065f46;display:block;margin-bottom:4px;">💰 Pay-in-Full (save $150–$200)</strong>
  <span style="color:#065f46;font-size:14px;line-height:1.6;">Pay the full tuition right after acceptance and we'll discount your invoice by $150–$200 depending on your track.</span>
</div>

<div style="background:#f8f5ef;border-left:4px solid #c9a84c;padding:14px 18px;border-radius:6px;margin:12px 0;">
  <strong style="color:#001F3F;display:block;margin-bottom:4px;">2-Payment Plan</strong>
  <span style="color:#475569;font-size:14px;line-height:1.6;">Split tuition into two equal installments: first at acceptance, second by the end of week 2. No discount applies.</span>
</div>

<h3 style="font-family:'Playfair Display',Georgia,serif;color:#001F3F;font-size:16px;margin:24px 0 8px;">Bank transfer details (ACH / Wire)</h3>
<table cellpadding="6" style="border-collapse:collapse;font-size:14px;color:#475569;margin-top:6px;">
  <tr><td style="color:#94a3b8;width:160px;padding:4px 12px 4px 0;">Payee</td><td><strong style="color:#001F3F;">MD Scholars LLC</strong></td></tr>
  <tr><td style="color:#94a3b8;padding:4px 12px 4px 0;">Payee address</td><td>St. Louis, MO 63146</td></tr>
  <tr><td style="color:#94a3b8;padding:4px 12px 4px 0;">Bank</td><td>CommunityAmerica Federal Credit Union</td></tr>
  <tr><td style="color:#94a3b8;padding:4px 12px 4px 0;">Bank address</td><td>PO Box 15950, Lenexa, KS 66285-5950</td></tr>
  <tr><td style="color:#94a3b8;padding:4px 12px 4px 0;">Account number</td><td style="font-family:monospace;color:#001F3F;"><strong>3807959488</strong></td></tr>
  <tr><td style="color:#94a3b8;padding:4px 12px 4px 0;">Routing number</td><td style="font-family:monospace;color:#001F3F;"><strong>301081508</strong></td></tr>
</table>
<p style="font-size:14px;line-height:1.6;color:#475569;margin:16px 0 0;">Please include your full name and program track in the memo field. After initiating the transfer, email <a href="mailto:support@mdscholars.com" style="color:#0d9488;text-decoration:none;font-weight:600;">support@mdscholars.com</a> with the subject <strong>Billing — ${firstName}</strong> so we can match your payment.</p>

<h3 style="font-family:'Playfair Display',Georgia,serif;color:#001F3F;font-size:16px;margin:24px 0 8px;">Refund policy</h3>
<ul style="margin:0;padding-left:20px;color:#475569;font-size:14px;line-height:1.7;">
  <li><strong>Week 1:</strong> Full refund, no questions asked</li>
  <li><strong>Week 2:</strong> 50% refund</li>
  <li><strong>After week 2:</strong> No refund</li>
</ul>

<p style="font-size:15px;line-height:1.6;margin:24px 0 0;color:#475569;">Welcome aboard. Reply anytime with questions.</p>`;
}

function waitlistedBody(firstName: string, trackLabel: string): string {
  return `
<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ${firstName},</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Thank you for applying to the <strong>${trackLabel}</strong> track at MD Scholars. We received an exceptional set of applications this cycle and have placed you on our <strong style="color:#c9a84c;">waitlist</strong>.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Waitlisted applicants are reviewed for openings as our cohort finalizes. We'll reach out promptly if a spot opens, and you'll have priority consideration in the next cycle.</p>
<p style="font-size:15px;line-height:1.6;margin:0 0 16px;color:#475569;">Thank you for your patience and for the care you put into your application.</p>`;
}

function rejectedBody(firstName: string, trackLabel: string): string {
  return `
<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ${firstName},</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Thank you for applying to the <strong>${trackLabel}</strong> track at MD Scholars. After careful review, we are unable to offer you a place in this particular cohort.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px;"><strong>Please do not be discouraged.</strong> This decision is not a reflection of your potential or your future in medicine — we received many more strong applications than seats we had available. The applicants we admit this cycle are not necessarily "better" than those we cannot admit; they are simply the best fit for this specific cohort right now.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">We genuinely encourage you to <strong>apply again next year's cycle</strong>. Strong reapplicants are common — many of our current scholars applied more than once. In the meantime, consider strengthening your application with:</p>
<ul style="font-size:15px;line-height:1.7;margin:0 0 16px;padding-left:1.25rem;color:#475569;">
  <li>A research methods or biostatistics course at your school</li>
  <li>A volunteer role in a clinical, research, or community-health setting</li>
  <li>A self-driven reading list on a clinical question you find interesting</li>
  <li>Our <a href="https://mdscholars.com/additional-services.html" style="color:#0d9488;text-decoration:none;font-weight:600;">standalone short courses</a> when those become available</li>
</ul>
<p style="font-size:15px;line-height:1.6;margin:0 0 16px;color:#475569;">If you have any questions or would like specific guidance on strengthening a future application, please reply to this email — we read every message and are happy to help.</p>
<p style="font-size:15px;line-height:1.6;margin:0 0 16px;color:#475569;">— The MD Scholars Team</p>`;
}

function deferredBody(firstName: string, trackLabel: string): string {
  return `
<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ${firstName},</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Good news — your application to the <strong>${trackLabel}</strong> track at MD Scholars has been <strong style="color:#0d9488;">accepted, and we are deferring your enrollment to the next semester</strong>. This means your spot is guaranteed; you do not need to re-apply.</p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">A few reasons we defer admitted applicants:</p>
<ul style="font-size:15px;line-height:1.7;margin:0 0 16px;padding-left:1.25rem;color:#475569;">
  <li>The current cohort is at capacity and we want to keep small-group ratios.</li>
  <li>The next semester is a better fit for your track and timing.</li>
  <li>You requested a later start when you applied.</li>
</ul>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">We will email you again about <strong>4 weeks before</strong> the next cohort starts with payment instructions, an updated syllabus, and your portal access details. There is nothing you need to do right now.</p>
<p style="font-size:15px;line-height:1.6;margin:0 0 16px;color:#475569;">If your situation changes and the deferred semester no longer works for you, just reply to this email and we will accommodate.</p>
<p style="font-size:15px;line-height:1.6;margin:0 0 16px;color:#475569;">Welcome aboard — we are looking forward to working with you.</p>
<p style="font-size:15px;line-height:1.6;margin:0 0 16px;color:#475569;">— The MD Scholars Team</p>`;
}

serve(async (req) => {
  try {
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), { status: 500 });
    }
    const body = await req.json();
    // Supabase DB webhook (UPDATE): { type, table, record, old_record, schema }
    const row = body.record ?? body;
    const oldRow = body.old_record ?? {};
    if (!row || !row.email) {
      return new Response(JSON.stringify({ error: "no record/email in payload" }), { status: 400 });
    }
    // Only send when status actually changed
    if (oldRow && row.status === oldRow.status) {
      return new Response(JSON.stringify({ skipped: "status unchanged" }), { status: 200 });
    }
    const trackLabel = TRACK_LABELS[String(row.program_track)] ?? String(row.program_track ?? "MD Scholars");
    // Derive first name from whatever the payload actually sent
    const rowFullName = String(row.full_name ?? row.name ?? "").trim();
    const derivedFirst = rowFullName ? rowFullName.split(/\s+/)[0] : "";
    const firstName = String(row.first_name || derivedFirst || "there");

    let subject = "";
    let html = "";
    switch (row.status) {
      case "accepted":
        subject = `🎉 You're accepted to MD Scholars — ${trackLabel}`;
        html = shell("Welcome to MD Scholars!", acceptedBody(firstName, trackLabel));
        break;
      case "waitlisted":
        subject = `Your MD Scholars application — waitlisted`;
        html = shell("You're on the Waitlist", waitlistedBody(firstName, trackLabel));
        break;
      case "rejected":
        subject = `Update on your MD Scholars application`;
        html = shell("Application Decision", rejectedBody(firstName, trackLabel));
        break;
      case "deferred":
        subject = `Your MD Scholars application — accepted, deferred to next semester`;
        html = shell("Welcome — see you next semester!", deferredBody(firstName, trackLabel));
        break;
      default:
        return new Response(JSON.stringify({ skipped: `no template for status=${row.status}` }), { status: 200 });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_TEAM_EMAIL, to: [row.email], subject, html }),
    });
    const data = await res.json();

    // If accepted → also kick off student provisioning (auth user + profile + invite email)
    let provisionResult: unknown = null;
    if (row.status === "accepted") {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://nygeinaoevzyptkgchqb.supabase.co";
      const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      try {
        const provRes = await fetch(`${SUPABASE_URL}/functions/v1/provision-student`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(SERVICE_KEY ? { "Authorization": `Bearer ${SERVICE_KEY}` } : {}),
          },
          body: JSON.stringify({ record: row }),
        });
        provisionResult = await provRes.json();
      } catch (e) {
        provisionResult = { error: String(e) };
      }
    }

    return new Response(JSON.stringify({ ok: true, sentTo: row.email, status: row.status, resend: data, provision: provisionResult }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("send-status-change error", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
