// Edge Function: manage-admin
// Called by admin.html's "Manage Admins" tab.
// Actions: promote, demote, invite.
// Verifies the caller is already an admin, then uses service_role to
// mutate admin_users and (for invite) send a Supabase Auth invite.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    const body = await req.json();
    const action = String(body.action || "").toLowerCase();
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();

    if (!email) return json({ error: "email required" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "invalid email" }, 400);

    const admin = createClient(url, svcKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (action === "promote") {
      // Look up the auth user
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const user = (list?.users || []).find((u: any) => (u.email || "").toLowerCase() === email);
      if (!user) return json({ error: "No Supabase Auth user with that email. Invite them first." }, 404);
      const { error } = await admin.from("admin_users").upsert(
        { user_id: user.id, email, name: name || null },
        { onConflict: "user_id" }
      );
      if (error) throw error;
      return json({ ok: true, action: "promote", email });
    }

    if (action === "demote") {
      // Prevent removing the last admin
      const { data: currentAdmins } = await admin.from("admin_users").select("email");
      if ((currentAdmins || []).length <= 1) {
        return json({ error: "Cannot remove the last admin." }, 400);
      }
      // Prevent an admin from removing themselves accidentally
      if ((userRes.user.email || "").toLowerCase() === email) {
        return json({ error: "You cannot remove yourself. Have another admin do it." }, 400);
      }
      const { error } = await admin.from("admin_users").delete().eq("email", email);
      if (error) throw error;
      return json({ ok: true, action: "demote", email });
    }

    if (action === "invite") {
      // Send Supabase Auth magic-link invite. Once accepted, they can be promoted.
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { invited_as: "admin", invited_by: userRes.user.email, display_name: name || null },
        redirectTo: "https://mdscholars.com/portal/set-password.html",
      });
      if (error) throw error;
      return json({ ok: true, action: "invite", email, user_id: data.user?.id });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
