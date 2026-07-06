// Supabase Edge Function: send-application-confirmation
// Triggered by a Database Webhook on INSERT into public.applications
// Sends a confirmation email to the applicant via Resend.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_TEAM_EMAIL = Deno.env.get("FROM_TEAM_EMAIL") ?? Deno.env.get("FROM_EMAIL") ?? "MD Scholars <team@mdscholars.com>";
const ADMIN_NOTIFY_EMAIL = Deno.env.get("ADMIN_NOTIFY_EMAIL") ?? "agupta@synexar.ai";

// Compute age from yyyy-mm-dd
function ageFromDob(dob: string): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function parentalConsentHtml(parentName: string, applicantName: string, trackLabel: string): string {
  const consentUrl = `https://mdscholars.com/portal/parental-consent.html?for=${encodeURIComponent(applicantName)}`;
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f8f5ef;font-family:'DM Sans',-apple-system,Segoe UI,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f5ef;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">
        <tr><td style="background:linear-gradient(135deg,#001F3F,#0d9488);padding:32px;text-align:center;color:#ffffff;">
          <div style="font-family:'Playfair Display',Georgia,serif;font-size:28px;font-weight:700;">MD Scholars</div>
          <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#14b8a6;margin-top:6px;">Parental Consent &amp; Enrollment Details</div>
        </td></tr>
        <tr><td style="padding:36px;">
          <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;color:#001F3F;margin:0 0 16px;">Parental Consent Required</h1>
          <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Hello ${parentName},</p>
          <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Thank you for your interest in the MD Scholars Research Mentorship Program. Because <strong>${applicantName}</strong> is under 18, we require parental consent before enrollment in the <strong>${trackLabel}</strong>.</p>
          <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Please review the full consent terms below. You can then either reply to this email to confirm, or sign electronically using the secure form link further down.</p>

          <h2 style="font-family:'Playfair Display',Georgia,serif;color:#001F3F;font-size:18px;margin:28px 0 10px;">Consent Agreement (please read in full)</h2>
          <div style="background:#f8f5ef;border:1px solid #e0dbd0;border-radius:8px;padding:18px 22px;font-size:14px;line-height:1.7;color:#334155;">
            <p style="margin:0 0 12px;">I, the parent or legal guardian of <strong>${applicantName}</strong>, give my consent for my child to enroll in and participate in the MD Scholars Research Mentorship Program (<strong>${trackLabel}</strong>) operated by MD Scholars LLC. I confirm and acknowledge the following:</p>
            <ol style="margin:0 0 0 18px;padding:0;color:#334155;">
              <li style="margin-bottom:10px;"><strong>Program activities.</strong> The program consists of remote/virtual research mentorship, instructional video and reading material, weekly assignments, group discussions, and one-on-one mentor feedback. There is no in-person component required.</li>
              <li style="margin-bottom:10px;"><strong>Voluntary participation.</strong> My child's participation is voluntary. Either my child or I may withdraw at any time, subject to the published refund policy.</li>
              <li style="margin-bottom:10px;"><strong>Privacy &amp; data.</strong> I authorize MD Scholars to collect and store the information my child provides in their application and during the program (name, email, age, school, written work, and progress data), and to use that information solely for program administration, mentorship, and certificate verification. MD Scholars will not sell my child's personal information to third parties.</li>
              <li style="margin-bottom:10px;"><strong>Communication.</strong> I authorize MD Scholars faculty and assigned mentors to communicate with my child by email and through the secure student portal for the purposes of mentorship, assignments, and feedback.</li>
              <li style="margin-bottom:10px;"><strong>Research output.</strong> I understand that any research output (abstracts, datasets, written work) produced as part of the program may be used by my child for academic purposes (e.g., submission to conferences, school portfolios, college applications). De-identified examples may be used by MD Scholars for educational illustration only with separate, written permission.</li>
              <li style="margin-bottom:10px;"><strong>Health &amp; safety.</strong> The program is academic in nature and does not involve any patient contact, clinical procedures, or laboratory work with biohazardous materials. There are no known health risks beyond those of normal at-home computer use.</li>
              <li style="margin-bottom:10px;"><strong>Tuition &amp; refund policy.</strong> I have read and accept the tuition options (pay-in-full with $150–$200 discount, or 2-payment plan) and the refund policy: <strong>full refund within Week&nbsp;1; 50% refund in Week&nbsp;2; no refund after Week&nbsp;2.</strong></li>
              <li style="margin-bottom:0;"><strong>Liability.</strong> I release MD Scholars LLC and its faculty/mentors from liability for ordinary course events, except in cases of gross negligence or willful misconduct.</li>
            </ol>
          </div>

          <h2 style="font-family:'Playfair Display',Georgia,serif;color:#001F3F;font-size:18px;margin:28px 0 10px;">Tuition &amp; Payment Information</h2>
          <p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 12px;">If your child is accepted, the following payment options apply. Track-specific tuition will be confirmed in the acceptance email.</p>

          <div style="background:#ecfdf5;border-left:4px solid #10b981;padding:14px 18px;border-radius:6px;margin:12px 0;">
            <strong style="color:#065f46;display:block;margin-bottom:4px;">Pay-in-Full (save $150–$200)</strong>
            <span style="color:#065f46;font-size:14px;line-height:1.6;">Pay the full tuition right after acceptance and the invoice is discounted by $150–$200 depending on the track.</span>
          </div>

          <div style="background:#f8f5ef;border-left:4px solid #c9a84c;padding:14px 18px;border-radius:6px;margin:12px 0;">
            <strong style="color:#001F3F;display:block;margin-bottom:4px;">2-Payment Plan</strong>
            <span style="color:#475569;font-size:14px;line-height:1.6;">Split tuition into two equal installments: first at acceptance, second by the end of week&nbsp;2. No discount applies.</span>
          </div>

          <h3 style="font-family:'Playfair Display',Georgia,serif;color:#001F3F;font-size:16px;margin:20px 0 8px;">Bank transfer details (ACH / Wire)</h3>
          <table cellpadding="6" style="border-collapse:collapse;font-size:14px;color:#475569;margin-top:6px;">
            <tr><td style="color:#94a3b8;width:160px;padding:4px 12px 4px 0;">Payee</td><td><strong style="color:#001F3F;">MD Scholars LLC</strong></td></tr>
            <tr><td style="color:#94a3b8;padding:4px 12px 4px 0;">Payee address</td><td>St. Louis, MO 63146</td></tr>
            <tr><td style="color:#94a3b8;padding:4px 12px 4px 0;">Bank</td><td>CommunityAmerica Federal Credit Union</td></tr>
            <tr><td style="color:#94a3b8;padding:4px 12px 4px 0;">Bank address</td><td>PO Box 15950, Lenexa, KS 66285-5950</td></tr>
            <tr><td style="color:#94a3b8;padding:4px 12px 4px 0;">Account number</td><td style="font-family:monospace;color:#001F3F;"><strong>3807959488</strong></td></tr>
            <tr><td style="color:#94a3b8;padding:4px 12px 4px 0;">Routing number</td><td style="font-family:monospace;color:#001F3F;"><strong>301081508</strong></td></tr>
          </table>

          <h3 style="font-family:'Playfair Display',Georgia,serif;color:#001F3F;font-size:16px;margin:20px 0 8px;">Refund policy</h3>
          <ul style="margin:0;padding-left:20px;color:#475569;font-size:14px;line-height:1.7;">
            <li><strong>Week 1:</strong> Full refund, no questions asked</li>
            <li><strong>Week 2:</strong> 50% refund</li>
            <li><strong>After week 2:</strong> No refund</li>
          </ul>

          <p style="margin:28px 0 12px;text-align:center;">
            <a href="${consentUrl}" style="background:#14b8a6;color:#fff;padding:14px 30px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">Sign consent form electronically →</a>
          </p>
          <p style="font-size:13px;line-height:1.6;color:#94a3b8;margin:0 0 16px;text-align:center;">Or simply reply to this email with <em>"I consent on behalf of ${applicantName}"</em> and your full name.</p>

          <p style="font-size:15px;line-height:1.6;margin:24px 0 0;color:#475569;">If you have any questions, we'd be happy to discuss the program with you — simply reply to this email.</p>
          <p style="font-size:15px;line-height:1.6;margin:20px 0 0;color:#475569;">Best regards,<br><strong>Dr. Satish Munigala</strong><br>Founder, MD Scholars</p>
        </td></tr>
        <tr><td style="background:#001F3F;padding:20px 36px;color:#94a3b8;font-size:12px;text-align:center;">
          MD Scholars LLC · Physician-Led Research Mentorship<br>
          Replies to this email reach team@mdscholars.com
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const TRACK_LABELS: Record<string, string> = {
  "future-physician": "Future Physician Scholars (High School)",
  "pre-med": "Pre-Med Research Scholars (College)",
  "med-accelerator": "Medical Student Accelerator",
  "resident-accelerator": "Resident & Fellow Accelerator",
  "12month": "12-Month Research Track",
  "institutional": "Institutional Program",
};

// Derive first name / full name from whatever the payload actually sent
function deriveFirst(row: Record<string, unknown>): string {
  const fromSplit = String(row.full_name ?? row.name ?? "").trim().split(/\s+/)[0];
  return fromSplit || String(row.first_name ?? "").trim();
}
function deriveFullName(row: Record<string, unknown>): string {
  const combined = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  if (combined) return combined;
  return String(row.full_name ?? row.name ?? "Applicant").trim();
}

function applicantEmailHtml(firstName: string, trackLabel: string): string {
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
        <tr><td style="padding:36px 36px 24px;">
          <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:24px;color:#001F3F;margin:0 0 16px;">Application Received</h1>
          <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ${firstName},</p>
          <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Thank you for applying to MD Scholars. We've received your application for the <strong>${trackLabel}</strong> track and our faculty team will review it shortly.</p>
          <div style="background:#f0f9f8;border-left:4px solid #14b8a6;padding:16px 20px;border-radius:6px;margin:24px 0;">
            <strong style="color:#001F3F;display:block;margin-bottom:8px;">What happens next?</strong>
            <ol style="margin:0;padding-left:20px;color:#475569;font-size:15px;line-height:1.7;">
              <li>Our faculty team reviews your application (typically 3–5 business days)</li>
              <li>You'll receive an acceptance, waitlist, or decision email at this address</li>
              <li>Accepted applicants receive enrollment details and a dashboard invite</li>
            </ol>
          </div>

          <h2 style="font-family:'Playfair Display',Georgia,serif;color:#001F3F;font-size:18px;margin:28px 0 8px;">Tuition &amp; payment overview</h2>
          <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 12px;">So you can plan ahead, here are the payment options that will apply if you're accepted. Track-specific tuition will be confirmed in the acceptance email.</p>

          <div style="background:#ecfdf5;border-left:4px solid #10b981;padding:14px 18px;border-radius:6px;margin:10px 0;">
            <strong style="color:#065f46;display:block;margin-bottom:4px;">Pay-in-Full (save $150–$200)</strong>
            <span style="color:#065f46;font-size:14px;line-height:1.6;">Pay the full tuition right after acceptance and your invoice is discounted by $150–$200 depending on the track.</span>
          </div>
          <div style="background:#f8f5ef;border-left:4px solid #c9a84c;padding:14px 18px;border-radius:6px;margin:10px 0;">
            <strong style="color:#001F3F;display:block;margin-bottom:4px;">2-Payment Plan</strong>
            <span style="color:#475569;font-size:14px;line-height:1.6;">Split tuition into two equal installments: first at acceptance, second by the end of week&nbsp;2. No discount applies.</span>
          </div>

          <h3 style="font-family:'Playfair Display',Georgia,serif;color:#001F3F;font-size:15px;margin:18px 0 6px;">Bank transfer details (ACH / Wire)</h3>
          <table cellpadding="5" style="border-collapse:collapse;font-size:13px;color:#475569;">
            <tr><td style="color:#94a3b8;width:140px;padding:3px 10px 3px 0;">Payee</td><td><strong style="color:#001F3F;">MD Scholars LLC</strong></td></tr>
            <tr><td style="color:#94a3b8;padding:3px 10px 3px 0;">Payee address</td><td>St. Louis, MO 63146</td></tr>
            <tr><td style="color:#94a3b8;padding:3px 10px 3px 0;">Bank</td><td>CommunityAmerica Federal Credit Union</td></tr>
            <tr><td style="color:#94a3b8;padding:3px 10px 3px 0;">Bank address</td><td>PO Box 15950, Lenexa, KS 66285-5950</td></tr>
            <tr><td style="color:#94a3b8;padding:3px 10px 3px 0;">Account number</td><td style="font-family:monospace;color:#001F3F;"><strong>3807959488</strong></td></tr>
            <tr><td style="color:#94a3b8;padding:3px 10px 3px 0;">Routing number</td><td style="font-family:monospace;color:#001F3F;"><strong>301081508</strong></td></tr>
          </table>

          <h3 style="font-family:'Playfair Display',Georgia,serif;color:#001F3F;font-size:15px;margin:18px 0 6px;">Refund policy</h3>
          <ul style="margin:0;padding-left:20px;color:#475569;font-size:13px;line-height:1.7;">
            <li><strong>Week 1:</strong> Full refund, no questions asked</li>
            <li><strong>Week 2:</strong> 50% refund</li>
            <li><strong>After week 2:</strong> No refund</li>
          </ul>

          <p style="font-size:15px;line-height:1.6;margin:24px 0 16px;color:#475569;">In the meantime, feel free to read about our <a href="https://mdscholars.com/programs.html" style="color:#0d9488;text-decoration:none;font-weight:600;">program tracks</a> or reach out at <a href="mailto:contact@mdscholars.com" style="color:#0d9488;text-decoration:none;font-weight:600;">contact@mdscholars.com</a> with any questions.</p>
          <p style="font-size:15px;line-height:1.6;margin:24px 0 0;color:#475569;">— The MD Scholars Team</p>
        </td></tr>
        <tr><td style="background:#001F3F;padding:20px 36px;color:#94a3b8;font-size:12px;text-align:center;">
          MD Scholars LLC · Physician-Led Research Mentorship<br>
          You're receiving this because you submitted an application at mdscholars.com.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function adminNotifyHtml(row: Record<string, unknown>): string {
  const trackLabel = TRACK_LABELS[String(row.program_track)] ?? row.program_track;
  return `
<div style="font-family:Arial,sans-serif;color:#0f172a;">
  <h2 style="color:#001F3F;">New Application Received</h2>
  <p><strong>${row.first_name} ${row.last_name}</strong> just applied.</p>
  <table cellpadding="6" style="border-collapse:collapse;font-size:14px;">
    <tr><td style="color:#475569;">Email:</td><td>${row.email}</td></tr>
    <tr><td style="color:#475569;">Phone:</td><td>${row.phone ?? "—"}</td></tr>
    <tr><td style="color:#475569;">Track:</td><td>${trackLabel}</td></tr>
    <tr><td style="color:#475569;">Education:</td><td>${row.education_level ?? "—"}</td></tr>
    <tr><td style="color:#475569;">Location:</td><td>${row.city ?? "—"}, ${row.state ?? "—"}, ${row.country ?? "—"}</td></tr>
  </table>
  <p style="margin-top:20px;"><a href="https://reyanshmdscholars-commits.github.io/MDscholars/admin.html" style="background:#14b8a6;color:#fff;padding:10px 18px;text-decoration:none;border-radius:6px;font-weight:600;">Open Admin Panel</a></p>
</div>`;
}

serve(async (req) => {
  try {
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), { status: 500 });
    }
    const body = await req.json();
    // Supabase DB webhook payload shape: { type, table, record, schema, old_record }
    const row = body.record ?? body;
    if (!row || !row.email) {
      return new Response(JSON.stringify({ error: "no record/email in payload" }), { status: 400 });
    }
    const trackLabel = TRACK_LABELS[String(row.program_track)] ?? String(row.program_track ?? "MD Scholars");

    // Send applicant confirmation
    const applicantRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_TEAM_EMAIL,
        to: [row.email],
        subject: "Your MD Scholars application was received",
        html: applicantEmailHtml(String(row.first_name ?? deriveFirst(row) ?? "there"), trackLabel),
      }),
    });
    const applicantData = await applicantRes.json();

    // If applicant is a minor and we have a parent email, also send parental consent request.
    // We treat someone as a minor if their DOB shows <18 OR they're on the HS track / High School edu level
    // (handles cases where DOB picker was skipped or filled with a placeholder date).
    const age = ageFromDob(String(row.date_of_birth ?? ""));
    const parentEmail = row.parent_email ? String(row.parent_email) : "";
    const parentName = row.parent_name ? String(row.parent_name) : "Parent / Guardian";
    const applicantName = (`${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()) || String(row.full_name ?? row.name ?? "").trim();
    const track = String(row.program_track ?? "");
    const eduLevel = String(row.education_level ?? "").toLowerCase();
    const role = String(row.applicant_role ?? "").toLowerCase();
    const likelyMinor =
      (age !== null && age < 18) ||
      track === "future-physician" ||
      role === "hs" ||
      eduLevel.includes("high school") ||
      eduLevel.includes("hs");
    let parentConsentData: unknown = null;
    if (likelyMinor && parentEmail) {
      const parentRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_TEAM_EMAIL,
          to: [parentEmail],
          subject: "Parental Consent Required — MD Scholars Program",
          html: parentalConsentHtml(parentName, applicantName || "your child (applicant)", trackLabel),
        }),
      });
      parentConsentData = await parentRes.json();
    }

    // Notify admin
    const adminRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_TEAM_EMAIL,
        to: [ADMIN_NOTIFY_EMAIL],
        subject: `New application: ${deriveFullName(row)} (${trackLabel})`,
        html: adminNotifyHtml(row),
      }),
    });
    const adminData = await adminRes.json();

    return new Response(
      JSON.stringify({ ok: true, applicant: applicantData, parentConsent: parentConsentData, admin: adminData, age }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("send-application-confirmation error", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
