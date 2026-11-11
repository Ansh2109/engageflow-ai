import { createInstagramWebhookApi } from "@/lib/instagram/webhook";
import { createAdminClient } from "@/lib/supabase/server";

function createWebhookApi() {
  return createInstagramWebhookApi({
    verificationToken: process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN,
    appSecret: process.env.META_APP_SECRET,
    async persistEvents(events) {
      const admin = createAdminClient();
      const { error } = await admin.from("webhook_events").upsert(events, {
        onConflict: "external_event_id,event_type",
        ignoreDuplicates: true,
      });
      if (error) {
        console.error("[Instagram Webhook] Event persistence failed.");
        throw error;
      }
    },
  });
}

export async function GET(request: Request) {
  return createWebhookApi().GET(request);
}

export async function POST(request: Request) {
  return createWebhookApi().POST(request);
}
