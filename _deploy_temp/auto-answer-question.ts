// Supabase Edge Function: auto-answer-question
// Called by the student portal RIGHT AFTER they submit a question.
// Sends the question to Gemini with the MD Scholars KB + a classifier prompt.
// If Gemini can confidently answer from the KB (no billing/refund/legal/complaint content),
// it UPDATEs the student_questions row with the answer and returns it to the client.
// Otherwise it leaves the row pending for admin/mentor review.
//
// Guardrails:
//   - Never auto-answer questions containing blocked keywords (refund, complaint, legal, urgent, etc.)
//   - Confidence must be >= 0.75 based on Gemini's own self-report
//   - Log every attempt with question_id + confidence + verdict for audit

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const SUPA_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPA_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPA_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_TOKEN = Deno.env.get("EDGE_FN_INTERNAL_TOKEN") ?? "";

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest", "gemini-1.5-flash"];

const KILL_SWITCH_KEY = "AUTO_ANSWER_DISABLED";
const AUTO_ANSWER_DISABLED = Deno.env.get(KILL_SWITCH_KEY) === "true";

// Any question containing these keywords is NEVER auto-answered — always goes to human review.
// Case-insensitive substring match.
const BLOCKED_KEYWORDS = [
  "refund", "cancel", "cancellation", "chargeback", "complaint", "complain",
  "legal", "lawyer", "attorney", "lawsuit", "sue", "subpoena",
  "urgent", "emergency", "asap", "immediately",
  "harass", "discriminat", "unfair",
  "password", "reset my password", "locked out", "can't log in", "cant log in",
  "billing error", "wrong charge", "double charged", "unauthorized",
  "drop me", "drop my", "quit the program", "leave the program",
  "personal", "private", "confidential",
];

const CONFIDENCE_THRESHOLD = 0.75;

const KNOWLEDGE_BASE = `
# MD Scholars — What we do (KB, current as of 2026-07)

## What MD Scholars is
Physician-led research mentorship program founded by Dr. Satish Munigala (MD, MPH). Based in St. Louis, MO. We help students from high school through fellowship do meaningful, real-world research — with real mentors, real datasets, and real submission targets (posters, abstracts, manuscripts).

## The 5 program tracks
All main tracks run 12 weeks. Small cohorts. Weekly live sessions, faculty office hours, and a structured curriculum in the student portal.

1. **Future Physician Scholars (High School)** — for 9th–12th graders. Tuition $1,199.
2. **Pre-Med Research Scholars (College)** — for undergrads / pre-med. Tuition $1,399.
3. **Medical Student Accelerator** — for MS1–MS4. Tuition $1,599.
4. **Resident & Fellow Accelerator** — for residents, fellows, and IMGs targeting US residency. Tuition $1,599.
5. **12-Month Advanced Track** (HS or College) — 12 months of extended mentorship with a publication target. Tuition $1,799.

## Discounts
- Pay-in-full at acceptance: $150 off main tracks ($200 off 12-month).
- 2-payment plan (no discount).

## Refund policy
- Full refund through end of Week 1.
- 50% refund during Week 2.
- No refund after Week 2 begins.

## Payment methods
Full payment details are sent privately in the acceptance email — we don't quote them in chat for security.

## Applications & acceptance
- Open cohorts: Fall 2026, Spring 2027, Summer 2027.
- Turnaround: usually 3–5 business days.
- Apply at mdscholars.com/apply.html. Free to apply.

## Certificates & verification
Every student who completes gets a certificate. Format: MDS-{Semester code}-{Year}-{Track code}-{Serial}. Verify at mdscholars.com/verify.html.

## Student portal
After acceptance + payment (or free enrollment), students sign in at mdscholars.com/portal/login.html. Portal includes: track syllabus, weekly content, assignments (individual or group), Q&A with your mentor, progress tracker, certificate download.

## Parental consent (minors under 18)
Students under 18 need a parent/guardian signature before portal access. Signed at mdscholars.com/portal/parental-consent.html.

## Contact
- General: contact@mdscholars.com
- Enrolled student support: support@mdscholars.com (subject "Billing" or "Education")
`.trim();

const CLASSIFIER_PROMPT = `You are the MD Scholars mentor assistant. A student has submitted a question inside their portal. Your job: decide whether this question is FULLY and safely answerable using the knowledge base below. If yes, write the answer as their mentor would. If no, respond with a classification only — a human will pick it up.

# Decision rules

Answer only when ALL these are true:
- The question is about MD Scholars content that's clearly covered in the KB (tracks, pricing, refund policy, portal features, certificate format, application process, curriculum topics), OR a common research/education concept a mentor would happily explain briefly (study design, IRB basics, ERAS context, poster vs abstract, etc.).
- The answer does not require any information about THIS student's specific account (their application status, payment status, cohort assignment, cert ID, portal password, personal grade, mentor name).
- The question is not about anything that could be sensitive (money owed, refunds requested, complaints, legal issues, dropping out, harassment, login issues, personal accommodations).

Set confidence = 1.0 for KB-direct answers (e.g. "what's the refund window?", "how do I verify a certificate?").
Set confidence = 0.85 for general educational answers (e.g. "what's IRB exempt vs expedited?").
Set confidence < 0.75 for anything you're not sure about. When in doubt, DO NOT answer — let a human handle it.

# Output format
Respond ONLY with valid JSON, no markdown, no backticks. Schema:
{
  "answerable": boolean,
  "confidence": number between 0 and 1,
  "draft_answer": string (empty if answerable is false),
  "reason": string (brief note on why you chose this verdict)
}

# Voice for the draft_answer
- Warm, direct, conversational. Full sentences.
- Match answer length to question length. One-line Q → 2-3 sentence A. Bigger Q → paragraph max.
- Never invent tracks, prices, dates, or bank details not in the KB. Use KB text verbatim for pricing and policies.
- Sign off naturally, no "As an AI…" or "Based on the knowledge base…" openers.
- If tangentially relevant, offer to route to a mentor for depth.

# Knowledge base
${KNOWLEDGE_BASE}

# The student's question`;

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

async function requireAuth(req: Request): Promise<{ ok: boolean; userId?: string }> {
  const authz = req.headers.get("authorization") ?? "";
  const jwt = authz.replace(/^Bearer\s+/i, "");
  if (!jwt || jwt === SUPA_ANON || jwt.startsWith("sb_publishable_")) return { ok: false };
  try {
    const userResp = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { "Authorization": `Bearer ${jwt}`, "apikey": SUPA_ANON },
    });
    if (!userResp.ok) return { ok: false };
    const user = await userResp.json();
    if (!user?.id) return { ok: false };
    return { ok: true, userId: user.id };
  } catch { return { ok: false }; }
}

function isBlocked(text: string): string | null {
  const lc = text.toLowerCase();
  for (const kw of BLOCKED_KEYWORDS) {
    if (lc.includes(kw)) return kw;
  }
  return null;
}

async function callGemini(question: string): Promise<{ answerable: boolean; confidence: number; draft_answer: string; reason: string } | null> {
  const payload = {
    contents: [{ role: "user", parts: [{ text: CLASSIFIER_PROMPT + "\n\n" + question }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 800,
      responseMimeType: "application/json",
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
  };
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify(payload),
      });
      if (resp.status === 503 || resp.status === 429) continue;
      const data = await resp.json();
      if (!resp.ok) return null;
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      try {
        return JSON.parse(text);
      } catch {
        // Some models wrap in ```json…```
        const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
        return JSON.parse(cleaned);
      }
    } catch { continue; }
  }
  return null;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  if (AUTO_ANSWER_DISABLED) {
    return new Response(JSON.stringify({ ok: true, handled: false, reason: "auto-answer disabled (env kill-switch)" }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
  const auth = await requireAuth(req);
  if (!auth.ok) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  try {
    const body = await req.json();
    const questionId: string = String(body.question_id || "").trim();
    if (!questionId) return new Response(JSON.stringify({ error: "missing question_id" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

    // Fetch question + verify student owns it
    const qResp = await sb(`/rest/v1/student_questions?id=eq.${questionId}&select=id,question,answer,student_id,status`);
    const rows = await qResp.json();
    if (!Array.isArray(rows) || !rows.length) return new Response(JSON.stringify({ error: "question not found" }), { status: 404, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    const q = rows[0];

    // Ownership check: this question's student_profile must belong to the caller
    const profResp = await sb(`/rest/v1/student_profiles?id=eq.${q.student_id}&select=auth_user_id`);
    const profs = await profResp.json();
    if (!Array.isArray(profs) || !profs.length || profs[0].auth_user_id !== auth.userId) {
      return new Response(JSON.stringify({ error: "not your question" }), { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // If already answered, do nothing
    if (q.answer && q.status === "answered") {
      return new Response(JSON.stringify({ ok: true, handled: false, reason: "already answered" }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // Guardrail 1: blocked keywords → never auto-answer
    const blockedKw = isBlocked(q.question);
    if (blockedKw) {
      await sb(`/rest/v1/student_questions?id=eq.${questionId}`, {
        method: "PATCH",
        body: JSON.stringify({ auto_answer_verdict: `blocked:${blockedKw}` }),
      }).catch(() => {});
      return new Response(JSON.stringify({ ok: true, handled: false, reason: "sensitive-topic keyword; routed to human", blocked_keyword: blockedKw }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // Guardrail 2: very long questions are usually context-rich and should go to human
    if (q.question.length > 800) {
      return new Response(JSON.stringify({ ok: true, handled: false, reason: "long question; routed to human" }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // Call Gemini classifier
    const verdict = await callGemini(q.question);
    if (!verdict) {
      return new Response(JSON.stringify({ ok: true, handled: false, reason: "gemini unavailable" }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // Log the verdict for audit (best effort)
    await sb(`/rest/v1/student_questions?id=eq.${questionId}`, {
      method: "PATCH",
      body: JSON.stringify({ auto_answer_verdict: `${verdict.answerable ? "answerable" : "not-answerable"}:${verdict.confidence.toFixed(2)}` }),
    }).catch(() => {});

    if (!verdict.answerable || verdict.confidence < CONFIDENCE_THRESHOLD || !verdict.draft_answer || verdict.draft_answer.length < 10) {
      return new Response(JSON.stringify({ ok: true, handled: false, reason: `verdict below threshold (${verdict.confidence})` }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // Compose auto-answer with a clear "reviewed by mentor" prefix so the student
    // knows this was generated + can still get a human follow-up if needed.
    const answerText = verdict.draft_answer + "\n\n— MD Scholars assistant. Your mentor will follow up if you want more detail; just reply here.";

    // Write answer to DB
    const updateResp = await sb(`/rest/v1/student_questions?id=eq.${questionId}`, {
      method: "PATCH",
      body: JSON.stringify({
        answer: answerText,
        status: "auto-answered",
        answered_at: new Date().toISOString(),
      }),
      headers: { "Prefer": "return=representation" },
    });
    if (!updateResp.ok) {
      return new Response(JSON.stringify({ ok: true, handled: false, reason: "db update failed", detail: await updateResp.text() }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // Fire the notification email via send-question-answered (using internal token)
    try {
      await fetch(`${SUPA_URL}/functions/v1/send-question-answered`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL_TOKEN },
        body: JSON.stringify({ question_id: questionId }),
      });
    } catch (e) { /* email failure shouldn't block the auto-answer surfacing to student */ }

    return new Response(JSON.stringify({
      ok: true,
      handled: true,
      answer: answerText,
      confidence: verdict.confidence,
      reason: verdict.reason,
    }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
