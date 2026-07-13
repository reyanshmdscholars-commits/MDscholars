// Supabase Edge Function: send-question-answered
// Triggered by a DB webhook when public.student_questions.answered_at transitions from NULL -> NOT NULL,
// or invoked directly by admin.html/mentor-dashboard.html after saving an answer.
// Emails the student with the answer + a portal link.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const INTERNAL_TOKEN = Deno.env.get("EDGE_FN_INTERNAL_TOKEN") ?? "";
const SUPA_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPA_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPA_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_SUPPORT_EMAIL = Deno.env.get("FROM_SUPPORT_EMAIL") ?? Deno.env.get("FROM_TEAM_EMAIL") ?? "MD Scholars <support@mdscholars.com>";

async function requireAuth(req: Request): Promise<{ ok: true } | { ok: false; reason: string; status: number }> {
  const internal = req.headers.get("x-internal-token");
  if (INTERNAL_TOKEN && internal && internal === INTERNAL_TOKEN) return { ok: true };
  const authz = req.headers.get("authorization") ?? "";
  const jwt = authz.replace(/^Bearer\s+/i, "");
  if (!jwt) return { ok: false, reason: "Missing authorization", status: 401 };
  if (jwt === SUPA_ANON || jwt.startsWith("sb_publishable_")) {
    return { ok: false, reason: "Anonymous keys cannot invoke this endpoint", status: 401 };
  }
  try {
    const userResp = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { "Authorization": `Bearer ${jwt}`, "apikey": SUPA_ANON },
    });
    if (!userResp.ok) return { ok: false, reason: "Invalid session", status: 401 };
    const user = await userResp.json();
    if (!user?.id) return { ok: false, reason: "Invalid session", status: 401 };
    // Allow both admins and mentors to trigger this endpoint via JWT
    const adminResp = await fetch(`${SUPA_URL}/rest/v1/admin_users?user_id=eq.${user.id}&select=user_id`, {
      headers: { "Authorization": `Bearer ${jwt}`, "apikey": SUPA_ANON },
    });
    const admins = await adminResp.json();
    if (Array.isArray(admins) && admins.length > 0) return { ok: true };
    // Fallback: check mentors table
    const mentorResp = await fetch(`${SUPA_URL}/rest/v1/mentors?user_id=eq.${user.id}&select=user_id`, {
      headers: { "Authorization": `Bearer ${jwt}`, "apikey": SUPA_ANON },
    });
    const mentors = await mentorResp.json();
    if (Array.isArray(mentors) && mentors.length > 0) return { ok: true };
    return { ok: false, reason: "Not an admin or mentor", status: 403 };
  } catch (e) {
    return { ok: false, reason: "Auth check failed", status: 500 };
  }
}

async function sb(path: string, init: RequestInit = {}) {
  return fetch(`${SUPA_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      apikey: SUPA_SERVICE,
      Authorization: `Bearer ${SUPA_SERVICE}`,
      "Content-Type": "application/json",
    },
  });
}

function escapeHtml(s: string): string {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function emailShell(firstName: string, questionText: string, answerText: string, trackFile: string): string {
  const trackLink = `https://mdscholars.com/portal/courses/${trackFile}#questions`;
  return `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8f5ef;font-family:'DM Sans',-apple-system,Segoe UI,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f5ef;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">
        <tr><td style="background:linear-gradient(135deg,#001F3F,#0d9488);padding:32px;text-align:center;color:#ffffff;">
          <div style="font-family:'Playfair Display',Georgia,serif;font-size:28px;font-weight:700;">MD Scholars</div>
          <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#14b8a6;margin-top:6px;">Your question has been answered</div>
        </td></tr>
        <tr><td style="padding:36px 36px 24px;">
          <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;color:#001F3F;margin:0 0 16px;">Hi ${escapeHtml(firstName)},</h1>
          <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Your mentor has just answered a question you submitted in the portal. Here it is:</p>
          <div style="background:#f8f5ef;border-left:4px solid #0d9488;padding:16px 20px;border-radius:6px;margin:24px 0;">
            <strong style="color:#001F3F;display:block;margin-bottom:8px;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;">Your question</strong>
            <div style="font-size:15px;line-height:1.65;color:#334155;white-space:pre-wrap;">${escapeHtml(questionText)}</div>
          </div>
          <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;">
            <strong style="color:#001F3F;display:block;margin-bottom:8px;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;">Answer</strong>
            <div style="font-size:15px;line-height:1.7;color:#0f172a;white-space:pre-wrap;">${escapeHtml(answerText)}</div>
          </div>
          <div style="text-align:center;margin:28px 0 12px;">
            <a href="${trackLink}" style="display:inline-block;background:#0d9488;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">Open in Portal →</a>
          </div>
          <p style="font-size:14px;line-height:1.6;color:#64748b;margin:24px 0 0;">Follow-up question? Just reply in your track's Q&amp;A tab in the portal — your mentor will get it. For anything unrelated to course content, email <a href="mailto:support@mdscholars.com" style="color:#0d9488;font-weight:600;">support@mdscholars.com</a>.</p>
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

const TRACK_TO_FILE: Record<string, string> = {
  "future-physician": "future-physician.html",
  "pre-med": "pre-med.html",
  "med-accelerator": "med-accelerator.html",
  "resident-accelerator": "resident-accelerator.html",
  "12month": "12month.html",
  "institutional": "institutional.html",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-internal-token" } });
  }
  const _authz = await requireAuth(req);
  if (!_authz.ok) {
    return new Response(JSON.stringify({ error: _authz.reason }), { status: _authz.status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
  try {
    if (!RESEND_API_KEY) return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), { status: 500 });
    const body = await req.json();
    // Accept both the DB-webhook shape ({record: {...}}) and direct invocation ({question_id: uuid})
    const row = body.record ?? body;
    const questionId: string | undefined = row.id || body.question_id;
    if (!questionId) return new Response(JSON.stringify({ error: "missing question id" }), { status: 400 });

    // Only fire when the transition is NULL -> NOT NULL (skip re-emails on re-edits)
    if (body.old_record && body.old_record.answered_at) {
      return new Response(JSON.stringify({ ok: true, skipped: "already answered before this update" }), { status: 200 });
    }

    // Fetch full question row + student email + track (via student_profiles + applications)
    const qResp = await sb(`/rest/v1/student_questions?id=eq.${questionId}&select=id,question,answer,answered_at,student_id`);
    const qRows = await qResp.json();
    if (!Array.isArray(qRows) || !qRows.length) return new Response(JSON.stringify({ error: "question not found" }), { status: 404 });
    const q = qRows[0];
    if (!q.answer || !q.answered_at) return new Response(JSON.stringify({ ok: true, skipped: "no answer yet" }), { status: 200 });

    const pResp = await sb(`/rest/v1/student_profiles?id=eq.${q.student_id}&select=full_name,email,program_track`);
    const pRows = await pResp.json();
    if (!Array.isArray(pRows) || !pRows.length) return new Response(JSON.stringify({ error: "student profile not found" }), { status: 404 });
    const student = pRows[0];
    if (!student.email) return new Response(JSON.stringify({ error: "no email on student profile" }), { status: 400 });

    const firstName = String(student.full_name || "").split(/\s+/)[0] || "there";
    const trackFile = TRACK_TO_FILE[String(student.program_track)] || "pre-med.html";

    const emailResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_SUPPORT_EMAIL,
        to: [student.email],
        subject: "Your mentor answered your MD Scholars question",
        html: emailShell(firstName, q.question, q.answer, trackFile),
      }),
    });
    const emailData = await emailResp.json();
    if (!emailResp.ok) {
      return new Response(JSON.stringify({ error: "resend error", detail: emailData }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true, resend: emailData }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
