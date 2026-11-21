import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  Json,
  MatchType,
  ProcessingOutcome,
  ProcessingStatus,
} from "../../types/database";
import { createAdminClient } from "../supabase/server.ts";
import type { WebhookEventProcessingRepository } from "./event-processor.ts";
import { MAX_AUTOMATION_CANDIDATES } from "./event-processor.ts";


/**
 * Service-role repository for the Instagram webhook event processor.
 *
 * Only three kinds of statement are issued here:
 *   1. the two service-role-only RPCs that own claim/finalization state,
 *   2. read-only SELECTs against instagram_accounts/automations/triggers.
 * No INSERT, UPDATE, DELETE or upsert is performed on application tables, and
 * no Meta API call is made.
 */

type ClaimRow = {
  event_id: string;
  external_event_id: string;
  event_type: string;
  event_payload: Json;
  attempts: number;
  claim_token: string;
};

type FinishRow = {
  processing_status: ProcessingStatus;
  processing_outcome: ProcessingOutcome | null;
};

/** Mutable during assembly; returned as the readonly candidate shape. */
type MutableCandidate = {
  automationId: string;
  triggers: Array<{ keyword: string; matchType: MatchType }>;
};

export function createInstagramEventRepository(
  client: SupabaseClient<Database> = createAdminClient() as SupabaseClient<Database>
): WebhookEventProcessingRepository {
  return {
    async claim(batchSize, leaseSeconds) {
      const { data, error } = await client.rpc(
        "claim_instagram_webhook_events",
        {
          p_batch_size: batchSize,
          p_lease_seconds: leaseSeconds,
        }
      );
      if (error) throw error;

      return ((data ?? []) as ClaimRow[]).map((row) => ({
        eventId: row.event_id,
        externalEventId: row.external_event_id,
        eventType: row.event_type,
        eventPayload: row.event_payload,
        attempts: row.attempts,
        claimToken: row.claim_token,
      }));
    },

    async findAccountByBusinessId(businessId) {
      const { data, error } = await client
        .from("instagram_accounts")
        .select("id, connection_status")
        .eq("instagram_business_id", businessId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { id: data.id, connectionStatus: data.connection_status };
    },

    async findCommentCandidates({ instagramAccountId, mediaId, limit }) {
      const { data: automations, error: automationError } = await client
        .from("automations")
        .select("id")
        .eq("instagram_account_id", instagramAccountId)
        .eq("status", "ACTIVE")
        .eq("automation_type", "COMMENT_TO_DM")
        .eq("target_post_id", mediaId)
        .order("id", { ascending: true })
        .limit(Math.min(limit, MAX_AUTOMATION_CANDIDATES));
      if (automationError) throw automationError;

      const automationIds = (automations ?? []).map((row) => row.id);
      if (automationIds.length === 0) return [];

      const { data: triggers, error: triggerError } = await client
        .from("automation_triggers")
        .select("automation_id, keyword, match_type")
        .eq("trigger_type", "COMMENT_KEYWORD")
        .in("automation_id", automationIds);
      if (triggerError) throw triggerError;

      const byAutomation = new Map<string, MutableCandidate>();
      for (const automationId of automationIds) {
        byAutomation.set(automationId, { automationId, triggers: [] });
      }

      for (const trigger of triggers ?? []) {
        const candidate = byAutomation.get(trigger.automation_id);
        if (!candidate) continue;
        candidate.triggers.push({
          keyword: trigger.keyword,
          matchType: trigger.match_type as MatchType,
        });
      }

      return [...byAutomation.values()].sort((left, right) =>
        left.automationId.localeCompare(right.automationId)
      );
    },

    async finish(input) {
      const { data, error } = await client.rpc(
        "finish_instagram_webhook_event",
        {
          p_event_id: input.eventId,
          p_claim_token: input.claimToken,
          p_outcome: input.outcome,
          p_instagram_account_id: input.instagramAccountId,
          p_matched_automation_ids: input.matchedAutomationIds,
          p_error_code: input.errorCode,
        }
      );
      if (error) throw error;

      const row = ((data ?? []) as FinishRow[])[0];
      if (!row) throw new Error("EVENT_FINALIZATION_EMPTY");
      return {
        processingStatus: row.processing_status,
        processingOutcome: row.processing_outcome,
      };
    },
  };
}
