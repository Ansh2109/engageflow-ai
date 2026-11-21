import "server-only";
import { decryptToken } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/server";

type WebhookEventRow = {
  id: string;
  instagram_account_id: string;
  event_payload: any;
  matched_automation_ids: string[];
};

type AutomationActionRow = {
  automation_id: string;
  action_type: string;
  message_text: string;
  public_comment_reply_text: string | null;
  public_reply_enabled: boolean;
};

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

async function logActivity(admin: any, entry: {
  owner_id: string;
  instagram_account_id: string | null;
  automation_id: string | null;
  webhook_event_id: string | null;
  action_type: string;
  status: "SENT" | "FAILED";
  error_message: string | null;
}) {
  await admin.from("activity_logs").insert({
    owner_id: entry.owner_id,
    instagram_account_id: entry.instagram_account_id,
    automation_id: entry.automation_id,
    webhook_event_id: entry.webhook_event_id,
    event_type: "change:comments",
    action_type: entry.action_type,
    status: entry.status,
    error_code: entry.error_message ? "EXECUTION_ERROR" : null,
    error_message: entry.error_message,
    metadata: {},
  });
}

export async function executeMatchedEvents() {
  const admin = createAdminClient();

  const { data: events, error: eventsError } = await admin
    .from("webhook_events")
    .select("id, instagram_account_id, event_payload, matched_automation_ids")
    .eq("processing_outcome", "MATCHED")
    .is("processed_at", null)
    .limit(50);

  if (eventsError) throw eventsError;
  if (!events?.length) return { executed: 0 };

  let executed = 0;

  for (const event of events) {
    try {
      if (!event.instagram_account_id || !event.matched_automation_ids?.length) continue;

      const { data: account, error: accountError } = await admin
        .from("instagram_accounts")
        .select("id, owner_id, instagram_business_id, unified_connection_id, connection_id")
        .eq("id", event.instagram_account_id)
        .maybeSingle();

      if (accountError || !account) continue;

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

      if (!connection?.encrypted_access_token) continue;

      const accessToken = decryptToken(connection.encrypted_access_token);

      const payload = event.event_payload;
      const entry = payload?.entry;
      const change = entry?.change;
      const value = change?.value;
      const commentId = value?.comment_id ?? value?.id;
      const fromId = value?.from?.id;

      if (!commentId) continue;

      const { data: automations, error: autoError } = await admin
        .from("automations")
        .select("id")
        .in("id", event.matched_automation_ids)
        .eq("status", "ACTIVE");

      if (autoError || !automations?.length) continue;

      const automationIds = automations.map((a) => a.id);

      const { data: actions, error: actionsError } = await admin
        .from("automation_actions")
        .select("automation_id, action_type, message_text, public_comment_reply_text, public_reply_enabled")
        .in("automation_id", automationIds);

      if (actionsError || !actions?.length) continue;

      for (const action of actions) {
        const isSendDm = action.action_type === "SEND_DM" || action.action_type === "SEND_DM_AND_REPLY_COMMENT";
        const isReply = action.action_type === "REPLY_COMMENT" || action.action_type === "SEND_DM_AND_REPLY_COMMENT";

        if (isSendDm && fromId) {
          try {
            await sendMetaRequest(accessToken, "me/messages", {
              recipient: JSON.stringify({ id: fromId }),
              message: action.message_text,
            });
            await logActivity(admin, {
              owner_id: account.owner_id,
              instagram_account_id: account.id,
              automation_id: action.automation_id,
              webhook_event_id: event.id,
              action_type: "SEND_DM",
              status: "SENT",
              error_message: null,
            });
          } catch (err) {
            await logActivity(admin, {
              owner_id: account.owner_id,
              instagram_account_id: account.id,
              automation_id: action.automation_id,
              webhook_event_id: event.id,
              action_type: "SEND_DM",
              status: "FAILED",
              error_message: err instanceof Error ? err.message : String(err),
            });
          }
        }

        if (isReply && action.public_comment_reply_text) {
          try {
            await sendMetaRequest(accessToken, `${commentId}/replies`, {
              message: action.public_comment_reply_text,
            });
            await logActivity(admin, {
              owner_id: account.owner_id,
              instagram_account_id: account.id,
              automation_id: action.automation_id,
              webhook_event_id: event.id,
              action_type: "REPLY_COMMENT",
              status: "SENT",
              error_message: null,
            });
          } catch (err) {
            await logActivity(admin, {
              owner_id: account.owner_id,
              instagram_account_id: account.id,
              automation_id: action.automation_id,
              webhook_event_id: event.id,
              action_type: "REPLY_COMMENT",
              status: "FAILED",
              error_message: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      await admin
        .from("webhook_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", event.id);

      executed += 1;
    } catch {
      continue;
    }
  }

  return { executed };
}
