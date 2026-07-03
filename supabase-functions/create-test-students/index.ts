// Edge Function: create-test-students
// Called by admin.html's "Provision Test Students" button.
// Verifies the caller is in admin_users, then creates 5 test-*@mdscholars.com
// auth users + student_profiles rows using SUPABASE_SERVICE_ROLE_KEY.
// This keeps the service_role secret server-side, not exposed to the client.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TRACKS = [
  { key: "future-physician",     email: "test-highschool@mdscholars.com", name: "Test Student — High School",       student_id: "MDS-TEST-2026-HS-01" },
  { key: "pre-med",              email: "test-college@mdscholars.com",    name: "Test Student — College",           student_id: "MDS-TEST-2026-COL-01" },
  { key: "med-accelerator",      email: "test-med@mdscholars.com",        name: "Test Student — Medical",           student_id: "MDS-TEST-2026-MED-01" },
  { key: "resident-accelerator", email: "test-resident@mdscholars.com",   name: "Test Student — Resident",          student_id: "MDS-TEST-2026-RES-01" },
  { key: "12month",              email: "test-12month@mdscholars.com",    name: "Test Student — 12-Month Advanced", student_id: "MDS-TEST-2026-12MO-01" },
];
const PWD = "MDScholarsTest2026!";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller is an admin using their session JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Missing Authorization" }, 401);
    const asCaller = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userRes, error: userErr } = await asCaller.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Not authenticated" }, 401);
    const { data: isAdminRes } = await asCaller.rpc("is_admin");
    if (isAdminRes !== true) return json({ error: "Not an admin" }, 403);

    // Now act with service_role to create users and upsert profiles
    const admin = createClient(url, svcKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: existingList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const results: Array<{ email: string; ok: boolean; note?: string; error?: string }> = [];

    for (const t of TRACKS) {
      try {
        const existing = existingList?.users?.find((u: any) => u.email === t.email);
        let uid = existing?.id;
        if (!uid) {
          const { data: created, error } = await admin.auth.admin.createUser({
            email: t.email, password: PWD, email_confirm: true,
            user_metadata: { is_test_student: true, name: t.name, track: t.key },
          });
          if (error) throw error;
          uid = created.user!.id;
        } else {
          // Ensure password is correct (in case Reyansh changed it)
          await admin.auth.admin.updateUserById(uid, { password: PWD, email_confirm: true });
        }

        const { error: pe } = await admin.from("student_profiles").upsert({
          user_id: uid,
          email: t.email,
          full_name: t.name,
          program_track: t.key,
          student_id: t.student_id,
          payment_status: "free",
          application_status: "accepted",
          consent_required: false,
          consent_status: "not_required",
        }, { onConflict: "email" });
        if (pe) throw pe;

        results.push({ email: t.email, ok: true, note: existing ? "refreshed" : "created" });
      } catch (e: any) {
        results.push({ email: t.email, ok: false, error: String(e.message ?? e) });
      }
    }
    return json({ ok: true, results });
  } catch (e: any) {
    return json({ error: String(e.message ?? e) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { "Content-Type": "application/json", ...CORS },
  });
}
