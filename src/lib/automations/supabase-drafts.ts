import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type {
  AutomationDraft,
  AutomationDraftRepository,
  AutomationListItem,
  CommentToDmDraftInput,
} from "./drafts";

type AutomationRow = {
  id: string;
  name: string;
  automation_type: AutomationListItem["automationType"];
  status: AutomationListItem["status"];
  instagram_account_id: string;
  target_post_id: string | null;
  target_media_type: string | null;
  created_at: string;
  updated_at: string;
};

function isDraftMediaType(
  value: string | null
): value is CommentToDmDraftInput["mediaType"] {
  return (
    value === "IMAGE" ||
    value === "VIDEO" ||
    value === "CAROUSEL_ALBUM"
  );
}

export function createSupabaseAutomationDraftRepository(
  supabase: SupabaseClient<Database>
): AutomationDraftRepository {
  async function get(ownerId: string, id: string): Promise<AutomationDraft | null> {
    const { data: automation, error: automationError } = await supabase
      .from("automations")
      .select(
        "id, owner_id, name, automation_type, status, instagram_account_id, target_post_id, target_media_type, created_at, updated_at"
      )
      .eq("id", id)
      .eq("owner_id", ownerId)
      .eq("automation_type", "COMMENT_TO_DM")
      .eq("status", "DRAFT")
      .maybeSingle();

    if (automationError) throw automationError;
    if (
      !automation ||
      !automation.target_post_id ||
      !isDraftMediaType(automation.target_media_type)
    ) {
      return null;
    }

    const [{ data: triggers, error: triggersError }, { data: actions, error: actionsError }] =
      await Promise.all([
        supabase
          .from("automation_triggers")
          .select("keyword, match_type, trigger_type")
          .eq("automation_id", id)
          .eq("trigger_type", "COMMENT_KEYWORD"),
        supabase
          .from("automation_actions")
          .select(
            "message_text, public_comment_reply_text, public_reply_enabled, action_type"
          )
          .eq("automation_id", id),
      ]);

    if (triggersError) throw triggersError;
    if (actionsError) throw actionsError;
    const action = actions?.[0];
    if (!triggers?.length || !action) return null;

    return {
      id: automation.id,
      automationType: automation.automation_type,
      status: "DRAFT",
      name: automation.name,
      accountId: automation.instagram_account_id,
      mediaId: automation.target_post_id,
      mediaType: automation.target_media_type,
      matchMode: triggers[0].match_type,
      keywords: triggers.map(({ keyword }) => keyword),
      privateMessage: action.message_text,
      publicReplyEnabled: action.public_reply_enabled,
      publicReply: action.public_comment_reply_text ?? "",
      createdAt: automation.created_at,
      updatedAt: automation.updated_at,
    };
  }

  return {
    async list(ownerId): Promise<AutomationListItem[]> {
      const { data: automations, error: automationsError } = await supabase
        .from("automations")
        .select(
          "id, name, automation_type, status, instagram_account_id, updated_at"
        )
        .eq("owner_id", ownerId)
        .order("updated_at", { ascending: false });
      if (automationsError) throw automationsError;
      if (!automations?.length) return [];

      const ids = automations.map(({ instagram_account_id }) => instagram_account_id);
      const { data: accounts, error: accountsError } = await supabase
        .from("instagram_accounts")
        .select("id, username, name")
        .eq("owner_id", ownerId)
        .in("id", ids);

      if (accountsError) throw accountsError;
      const accountById = new Map(accounts?.map((account) => [account.id, account]));
      return automations.map((automation) => {
        const account = accountById.get(automation.instagram_account_id);
        return {
          id: automation.id,
          name: automation.name,
          automationType: automation.automation_type,
          accountName: account?.name || `@${account?.username ?? "Instagram"}`,
          accountUsername: account?.username ?? "",
          status: automation.status,
          updatedAt: automation.updated_at,
        };
      });
    },

    get,

    async save(ownerId, id, input): Promise<string> {
      const { data: account, error: accountError } = await supabase
        .from("instagram_accounts")
        .select("id")
        .eq("id", input.accountId)
        .eq("owner_id", ownerId)
        .eq("connection_status", "CONNECTED")
        .maybeSingle();
      if (accountError) throw accountError;
      if (!account) {
        const error = new Error("Connected account not found.") as Error & {
          code: string;
        };
        error.code = "P0002";
        throw error;
      }

      const { data: automationId, error: saveError } = await supabase.rpc(
        "save_comment_to_dm_draft",
        {
          p_automation_id: id,
          p_instagram_account_id: input.accountId,
          p_name: input.name,
          p_media_id: input.mediaId,
          p_media_type: input.mediaType,
          p_match_type: input.matchMode,
          p_keywords: input.keywords,
          p_message_text: input.privateMessage,
          p_public_reply_enabled: input.publicReplyEnabled,
          p_public_comment_reply_text: input.publicReply,
        }
      );
      if (saveError) throw saveError;
      if (!automationId) throw new Error("Draft save returned no ID.");
      return automationId;
    },

    async delete(ownerId, id): Promise<boolean> {
      const { data, error } = await supabase
        .from("automations")
        .delete()
        .eq("id", id)
        .eq("owner_id", ownerId)
        .eq("status", "DRAFT")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
  };
}

export type { AutomationRow };
