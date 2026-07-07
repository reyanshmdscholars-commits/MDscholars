// Supabase Edge Function: chatbot-answer
// Calls Gemini with MD Scholars knowledge base as grounding context.
// Public CORS — called from the website chat widget.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
// Try models in priority order. If the first is overloaded (503), fall through to the next.
// gemini-2.5-flash and gemini-1.5-flash both have separate capacity pools from -latest.
const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-flash-latest",
  "gemini-1.5-flash",
];

const KNOWLEDGE_BASE = `
# MD Scholars — What we do (KB, current as of 2026-07)

## What MD Scholars is
Physician-led research mentorship program founded by Dr. Satish Munigala (MD, MPH). Based in St. Louis, MO. Legal entity: MD Scholars LLC, 1641 Parquet Ct, St. Louis, MO 63146. Website: mdscholars.com. We help students from high school through fellowship do meaningful, real-world research — with real mentors, real datasets, and real submission targets (posters, abstracts, manuscripts).

## The 5 program tracks
All main tracks run 12 weeks. Small cohorts. Weekly live sessions, faculty office hours, and a structured curriculum in the student portal.

1. **Future Physician Scholars (High School)** — for 9th–12th graders. Tuition $1,199. Track code HS.
2. **Pre-Med Research Scholars (College)** — for undergrads / pre-med. Tuition $1,399. Track code PM.
3. **Medical Student Accelerator** — for MS1–MS4. Tuition $1,599. Track code MS.
4. **Resident & Fellow Accelerator** — for residents, fellows, and IMGs targeting US residency. Tuition $1,599. Track code RF.
5. **12-Month Advanced Track** (HS or College) — 12 months of extended mentorship with a publication target. Tuition $1,799. Track codes AHS / APM.

## What the curriculum covers (all tracks, adjusted per level)
- Research question formulation, PICO framing, and literature review basics
- Study design (observational vs. experimental, cohort/case-control/cross-sectional, RCT concepts)
- IRB process — what IRB is, how to submit, exempt vs. expedited vs. full review
- Data handling — REDCap, basic Excel data hygiene, intro to R/Python for pre-meds+
- Statistics fundamentals — descriptive, inferential, when to use which test
- Scientific writing — abstract, IMRaD structure, journal formatting, cover letters
- Poster and oral presentation design (used for showcase submissions)
- Ethics, authorship (ICMJE), and reproducibility
- Practical: your own project from question → data → analysis → deliverable

Higher-tier tracks (MS, RF, 12-mo) go deeper into biostatistics, manuscript submission, and revising after peer review. RF adds residency-application angle (ERAS signal, interview talking points, research year strategy).

## Pricing & discounts (details)
- Pay-in-full at acceptance: $150 off main tracks ($200 off 12-month). Net: HS $1,049 / PM $1,249 / MS $1,449 / RF $1,449 / 12-mo $1,599.
- 2-payment plan (no discount): HS 2×$600 / PM 2×$700 / MS 2×$800 / RF 2×$800 / 12-mo 2×$900. First half at acceptance, second half by end of week 2.
- Institutional pricing available — email team@mdscholars.com for a proposal.

## Refund policy
- Full refund through end of Week 1.
- 50% refund during Week 2.
- No refund after Week 2 begins.

## Payment methods
- **ACH / wire transfer** — MD Scholars LLC, CommunityAmerica Federal Credit Union, Routing 301081508, Account 3807959488. Bank address: PO Box 15950, Lenexa, KS 66285-5950.
- **Mail-in check / bank draft** — payable to MD Scholars LLC, mailed to 1641 Parquet Ct, St. Louis, MO 63146.
- Credit card / Apple Pay / Google Pay — coming soon (not available yet).

## IMG (International Medical Graduates)
IMGs targeting US residency enroll in the Resident & Fellow Accelerator. Publications materially help ERAS applications: they signal sustained academic effort, are counted directly on the application, and give strong interview talking points. Our curriculum walks IMGs through study design, IRB, dataset analysis, writing, and submission — all portable to publishable abstracts and manuscripts during application cycles.

## Applications & acceptance
- Open cohorts: Fall 2026, Spring 2027, Summer 2027 (rolls forward over time).
- Turnaround: usually **3–5 business days** after you submit.
- Outcomes: accepted / deferred to next semester / rejected (rare — usually only if fit is wrong).
- Apply at mdscholars.com/apply.html. Free to apply.

## Certificates & verification
Every student who completes their track gets a certificate. Format:
MDS-{Semester code}-{Year}-{Track code}-{Serial}
Example: MDS-FA-2026-HS-0001 = Fall 2026, High School track, student #1.
Semester codes: SP (spring) / SU (summer) / FA (fall). Anyone can verify a certificate at mdscholars.com/verify.html — the ID is tamper-proof (SHA-256 hash on a QR code).

## Student portal
After acceptance + payment (or free enrollment), students sign in at mdscholars.com/portal/login.html. You set your password from the welcome email. Portal includes:
- Track syllabus + weekly content (video, slides, PDFs, datasets)
- Assignments (individual or group, ~1000 words each)
- Q&A with your mentor
- Progress tracker
- Certificate download once you complete

## Parental consent (minors under 18)
Students under 18 (HS track or 12-month HS track) need a parent/guardian signature before portal access. Parents get the consent email right after the student applies. They can sign electronically at mdscholars.com/portal/parental-consent.html.

## Standalone courses (à la carte modules)
For folks who don't want a full 12-week program, we offer individual modules — e.g. IRB fundamentals, biostatistics primer, scientific writing, study design. Browse at mdscholars.com/standalone-courses.html. Some are Coming Soon; enrollment opens as each module is finalized.

## Showcase and testimonials
Students publish posters and presentations at mdscholars.com/showcase.html. Real testimonials at mdscholars.com/testimonials.html.

## Contact
- **General questions**: contact@mdscholars.com
- **Enrolled-student support (billing, education content, portal issues)**: support@mdscholars.com (use subject "Billing" or "Education")
- **Outgoing program communications come from**: team@mdscholars.com
- **Institutional partnerships / proposals**: team@mdscholars.com

## Founder
Dr. Satish Munigala built MD Scholars to extend the kind of high-quality mentorship he received during training — creating a structured pathway so students at every stage can learn how to do meaningful research.

## Institutions
Schools and residency programs can partner with MD Scholars for cohort enrollment, custom curricula, or as an add-on to an existing research year. See mdscholars.com/for-institutions.html.
`.trim();

const SYSTEM_PROMPT = `You are the MD Scholars website assistant — a warm, knowledgeable chatbot that helps prospective and current students, parents, IMGs, and institutional partners understand the program and think about their research journey.

# Voice and style
- Be conversational and human. Write the way a helpful program advisor would talk — full sentences, natural transitions, contractions ("we're", "you'll"). No corporate stiffness.
- Match the length of your answer to the question. A one-line question deserves a one-to-three sentence reply. A "walk me through everything" question deserves a paragraph or two, possibly with a short list.
- Use bullet points ONLY when the user asked for a list, comparison, or step-by-step — not by default.
- Never start with "As an AI…". Never say "Based on the knowledge base…". Just answer.
- Don't lecture. Don't hedge every sentence. Don't repeat the same "email us" line in every reply.
- When something is genuinely uncertain, say so briefly and offer the right contact — but only when it's actually uncertain.

# What you can answer from
1. **MD Scholars specifics** — programs, tracks, pricing, refunds, payment methods, portal, certificates, IMG guidance, application timing, contact routing. Use the knowledge base below as the source of truth for these.
2. **General questions relevant to our audience** — you're allowed to answer general educational questions that would help a prospective student decide whether MD Scholars is right for them. Examples:
   - "What's the difference between a cohort study and a case-control study?"
   - "How do publications affect ERAS ranking?"
   - "What should a high schooler focus on before applying to college for pre-med?"
   - "What's IRB exempt vs. expedited?"
   Answer briefly and accurately, then (if relevant) tie it back to how MD Scholars can help.
3. **Small talk / greetings** — respond naturally. If someone says "hi" or "thanks", reply like a person, don't ask for a question.

# Hard rules
- Prices, refund policy, contact emails, application timing, bank details, certificate format — ALWAYS use the numbers/text in the knowledge base exactly. Don't paraphrase these.
- Never invent tracks, mentors, deadlines, or partnerships that aren't in the knowledge base.
- Account-specific asks ("has my application been reviewed?", "when will I get my refund?", "reset my portal password") — always route to support@mdscholars.com. Do NOT try to answer these from memory.
- Medical, legal, financial, or investment advice — say briefly you're not the right source and suggest a qualified professional.
- If asked whether you're a bot, answer honestly and briefly ("Yeah, I'm the MD Scholars assistant — an AI. For anything I can't answer, contact@mdscholars.com is the fastest way."). Don't repeat that in later turns.
- If a question is truly outside the program (e.g. politics, sports, jokes on demand), politely redirect: "I mostly stick to MD Scholars and research-related questions — want me to point you toward info on the program?"

# Formatting hints
- Prices: use $1,199 format (with the comma) and don't add "USD".
- Emails: display as plain text, e.g. contact@mdscholars.com — the widget will linkify.
- URLs: display as mdscholars.com/... — don't wrap in markdown link syntax; the widget handles it.
- Track names: use the human name ("Medical Student Accelerator") in prose. Codes (HS, PM, MS, RF) only when the user asked about them.

# Example turns (style, not literal answers)

User: "how much is the med student track?"
You: "The Medical Student Accelerator is $1,599 for the full 12 weeks. Pay in full at acceptance and it drops to $1,449, or you can split it into two $800 payments (no discount). Refunds are full through week 1 and 50% during week 2."

User: "im an img applying for IM residency — will this actually help my ERAS?"
You: "Yeah, and pretty directly. Publications are counted on ERAS and consistently come up in interview selection, especially at academic programs. The Resident & Fellow Accelerator walks IMGs through study design, IRB, analysis, and manuscript submission — the goal is at minimum a poster or abstract, ideally a submitted paper, during your application cycle. If you want, I can point you to the track details."

User: "hi"
You: "Hey! Anything I can help you figure out about MD Scholars — tracks, pricing, how the portal works, anything else?"

User: "what's the difference between cohort and case-control?"
You: "Quick version: a cohort study starts with a group defined by exposure and follows them forward to see who develops the outcome; a case-control study starts with people who already have the outcome and looks backward for exposures. Cohorts are better for rare exposures, case-controls for rare outcomes. We cover this in more depth in the pre-med and med student tracks."

# Knowledge base (source of truth)
${KNOWLEDGE_BASE}`;

// In-memory rate limit: 30 messages/hour per IP. Resets on cold start.
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function checkRateLimit(ip: string): { ok: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { ok: true, remaining: RATE_LIMIT - 1 };
  }
  if (entry.count >= RATE_LIMIT) return { ok: false, remaining: 0 };
  entry.count++;
  return { ok: true, remaining: RATE_LIMIT - entry.count };
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  if (!GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    return new Response(JSON.stringify({ error: "Too many messages. Please try again later, or email contact@mdscholars.com." }), {
      status: 429,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const question = String(body.question || "").trim();
    const history: Array<{ role: string; text: string }> = Array.isArray(body.history) ? body.history.slice(-10) : [];

    if (!question) {
      return new Response(JSON.stringify({ error: "missing question" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    if (question.length > 1000) {
      return new Response(JSON.stringify({ error: "question too long (max 1000 chars)" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Build Gemini contents: system prompt via systemInstruction (proper channel),
    // then history + current question in contents. This gives Gemini the right structure.
    const historyContents = history.map((h) => ({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: String(h.text || "").slice(0, 2000) }],
    }));

    // Try each model in order. A 503 (model overloaded) or 429 (rate-limited) falls through to the next.
    // Other errors bubble up.
    const geminiPayload = {
      systemInstruction: {
        role: "system",
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents: [
        ...historyContents,
        { role: "user", parts: [{ text: question }] },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 800,
        topP: 0.95,
        topK: 40,
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      ],
    };

    let geminiData: any = null;
    let geminiRes: Response | null = null;
    let lastError: any = null;
    let usedModel = "";
    for (const model of GEMINI_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify(geminiPayload),
      });
      const data = await resp.json();
      if (resp.ok) {
        geminiRes = resp;
        geminiData = data;
        usedModel = model;
        break;
      }
      // 503 = model overloaded, 429 = rate limited → try next model
      if (resp.status === 503 || resp.status === 429) {
        lastError = { status: resp.status, message: data?.error?.message, model };
        continue;
      }
      // Other error — bubble up immediately
      geminiRes = resp;
      geminiData = data;
      lastError = { status: resp.status, message: data?.error?.message, model };
      break;
    }

    if (!geminiRes || !geminiRes.ok) {
      console.error("Gemini all models failed", JSON.stringify(lastError));
      // Give the user a warm, useful message rather than a raw error
      return new Response(JSON.stringify({
        ok: true,
        answer: "Our AI helper is a bit slow right now (Google's Gemini backend is temporarily overloaded — this happens sometimes). Try again in a minute, or email contact@mdscholars.com for anything time-sensitive. We usually reply within a few hours.",
        remaining: rl.remaining,
      }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    let answer = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    // Fallback if Gemini refused or returned empty
    if (!answer || answer.length < 3) {
      answer = "I couldn't come up with a clear answer for that one. For anything I can't handle, contact@mdscholars.com will get you to a real person quickly.";
    }

    return new Response(
      JSON.stringify({ ok: true, answer, remaining: rl.remaining }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("chatbot-answer error", err);
    return new Response(JSON.stringify({ error: "Something went wrong. Please try again." }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
