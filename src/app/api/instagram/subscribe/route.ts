import { createAdminClient, createClient } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/crypto";
import { NextResponse } from "next/server";

async function sendMetaRequest(accessToken: string, path: string, bodyParams: Record<string, string>) {
  const url = new URL(`https://graph.facebook.com/v27.0/${path}`);
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(bodyParams),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Meta API ${res.status}: ${JSON.stringify(err)}`);
  }
  return res.json();
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  const { accountId } = body;
  if (!accountId) {
    return NextResponse.json({ error: "MISSING_ACCOUNT_ID" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: account, error: accountError } = await admin
    .from("instagram_accounts")
    .select("id, owner_id, instagram_business_id, unified_connection_id, connection_id")
    .eq("id", accountId)
    .eq("owner_id", authData.user.id)
    .maybeSingle();

  if (accountError || !account) {
    return NextResponse.json({ error: "ACCOUNT_NOT_FOUND" }, { status: 404 });
  }

  let connection: any = null;
  if (account.unified_connection_id) {
    const { data } = await admin
      .from("instagram_unified_login_connections")
      .select("encrypted_access_token")
      .eq("id", account.unified_connection_id)
      .maybeSingle();
    connection = data;
  } else if (account.connection_id) {
    const { data } = await admin
      .from("instagram_business_connections")
      .select("encrypted_access_token")
      .eq("id", account.connection_id)
      .maybeSingle();
    connection = data;
  }

  if (!connection?.encrypted_access_token) {
    return NextResponse.json({ error: "NO_TOKEN" }, { status: 400 });
  }

  const accessToken = decryptToken(connection.encrypted_access_token);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const verifyToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  if (!siteUrl || !verifyToken) {
    return NextResponse.json({ error: "CONFIG_MISSING" }, { status: 500 });
  }

  await sendMetaRequest(accessToken, "me/subscribed_apps", {
    callback_url: `${siteUrl}/api/webhooks/instagram`,
    verify_token: verifyToken,
    fields: "comments",
    object: "instagram",
  });

  return NextResponse.json({ ok: true, subscribed: true });
}
