// Supabase Edge Function: send-payment-confirmation
// Called by the admin panel when a student is marked "Paid".
// Sends a payment-received confirmation email + notifies admin.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_TEAM_EMAIL = Deno.env.get("FROM_TEAM_EMAIL") ?? Deno.env.get("FROM_EMAIL") ?? "MD Scholars <team@mdscholars.com>";
const ADMIN_NOTIFY_EMAIL = Deno.env.get("ADMIN_NOTIFY_EMAIL") ?? "reyansh.mdscholars@gmail.com";

const TRACK_LABELS: Record<string, string> = {
  "future-physician": "Future Physician Scholars (High School)",
  "pre-med": "Pre-Med Research Scholars (College)",
  "med-accelerator": "Medical Student Accelerator",
  "resident-accelerator": "Resident & Fellow Accelerator",
  "12month": "12-Month Research Track",
  "institutional": "Institutional Program",
};

function deriveFirst(row: Record<string, unknown>): string {
  const fromSplit = String(row.full_name ?? row.name ?? "").trim().split(/\s+/)[0];
  return fromSplit || String(row.first_name ?? "").trim() || "there";
}
function deriveFullName(row: Record<string, unknown>): string {
  const combined = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  if (combined) return combined;
  return String(row.full_name ?? row.name ?? "Applicant").trim();
}

function applicantHtml(firstName: string, trackLabel: string): string {
  return `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8f5ef;font-family:'DM Sans',-apple-system,Segoe UI,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f5ef;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">
        <tr><td style="background:linear-gradient(135deg,#001F3F,#0d9488);padding:32px;text-align:center;color:#ffffff;">
          <div style="font-family:'Playfair Display',Georgia,serif;font-size:28px;font-weight:700;">MD Scholars</div>
          <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#14b8a6;margin-top:6px;">Payment Received</div>
        </td></tr>
        <tr><td style="padding:36px 36px 24px;">
          <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:24px;color:#001F3F;margin:0 0 16px;">Welcome — Your Spot Is Confirmed</h1>
          <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ${firstName},</p>
          <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">We've received your payment for the <strong>${trackLabel}</strong>. Your enrollment is now active and your spot in the cohort is officially confirmed.</p>
          <div style="background:#f0f9f8;border-left:4px solid #14b8a6;padding:16px 20px;border-radius:6px;margin:24px 0;">
            <strong style="color:#001F3F;display:block;margin-bottom:8px;">Next Steps</strong>
            <ol style="margin:0;padding-left:20px;color:#475569;font-size:15px;line-height:1.7;">
              <li>Log in to your student portal: <a href="https://mdscholars.com/portal/login.html" style="color:#0d9488;">mdscholars.com/portal/login.html</a></li>
              <li>Review your track's syllabus, weekly schedule, and first-week assignments</li>
              <li>Watch for your cohort kickoff email with meeting links and your faculty mentor introduction</li>
            </ol>
          </div>
          <p style="font-size:15px;line-height:1.6;margin:0 0 16px;color:#475569;">Questions about billing? Email <a href="mailto:support@mdscholars.com" style="color:#0d9488;text-decoration:none;font-weight:600;">support@mdscholars.com</a> (use subject "billing"). Questions about the course content? Email <a href="mailto:support@mdscholars.com" style="color:#0d9488;text-decoration:none;font-weight:600;">support@mdscholars.com</a> (use subject "education").</p>
          <p style="font-size:15px;line-height:1.6;margin:24px 0 0;color:#475569;">— The MD Scholars Team</p>
        </td></tr>
        <tr><td style="background:#001F3F;padding:20px 36px;color:#94a3b8;font-size:12px;text-align:center;">
          MD Scholars LLC · Physician-Led Research Mentorship
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

serve(async (req) => {
  try {
    if (!RESEND_API_KEY) return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), { status: 500 });
    const body = await req.json();
    const row = body.record ?? body;
    if (!row || !row.email) return new Response(JSON.stringify({ error: "no record/email in payload" }), { status: 400 });
    const trackLabel = TRACK_LABELS[String(row.program_track)] ?? String(row.program_track ?? "MD Scholars");

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_TEAM_EMAIL,
        to: [row.email],
        subject: "Payment received — your MD Scholars spot is confirmed",
        html: applicantHtml(deriveFirst(row), trackLabel),
      }),
    });
    const data = await r.json();

    // Notify admin
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_TEAM_EMAIL,
        to: [ADMIN_NOTIFY_EMAIL],
        subject: `Payment marked received: ${deriveFullName(row)} (${trackLabel})`,
        html: `<p><strong>${deriveFullName(row)}</strong> (${row.email}) was just marked Paid in the admin panel.</p>`,
      }),
    });

    return new Response(JSON.stringify({ ok: true, applicant: data }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
