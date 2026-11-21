import { matchAutomations } from "./keyword-match.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConnectionStatus, Database, Json, MatchType, ProcessingOutcome, ProcessingStatus } from "../../types/database.ts";
import { createAdminClient } from "../supabase/server.ts";

export {
  createInstagramEventRepository,
} from "./event-processor-repository.ts";


export const DEFAULT_BATCH_SIZE = 5;
export const DEFAULT_LEASE_SECONDS = 60;
export const MAX_AUTOMATION_CANDIDATES = 10;

export type InstagramAccountReference = {
  id: string;
  connectionStatus: ConnectionStatus;
};

export type ClaimedWebhookEvent = {
  eventId: string;
  externalEventId: string;
  eventType: string;
  eventPayload: Json;
  attempts: number;
  claimToken: string;
};

export type CommentCandidatesQuery = {
  instagramAccountId: string;
  mediaId: string;
  limit: number;
};

export type FinishEventInput = {
  eventId: string;
  claimToken: string;
  outcome: ProcessingOutcome;
  instagramAccountId: string | null;
  matchedAutomationIds: Array<string>;
  errorCode: string | null;
};

export type FinishEventResult = {
  processingStatus: ProcessingStatus;
  processingOutcome: ProcessingOutcome | null;
};

export type WebhookEventProcessingRepository = {
  claim(batchSize: number, leaseSeconds: number): Promise<Array<ClaimedWebhookEvent>>;
  findAccountByBusinessId(businessId: string): Promise<InstagramAccountReference | null>;
  findCommentCandidates(query: CommentCandidatesQuery): Promise<Array<{
    automationId: string;
    triggers: Array<{ keyword: string; matchType: MatchType }>;
  }>>;
  finish(input: FinishEventInput): Promise<FinishEventResult>;
};

export function parseCommentEvent(payload: unknown): {
  businessId: string;
  mediaId: string;
  text: string;
  authorId: string;
} | null {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("entry" in payload)
  ) {
    return null;
  }

  const entry = (payload as { entry?: unknown }).entry;
  if (!entry || typeof entry !== "object") return null;

  const entryObj = entry as Record<string, unknown>;
  if (entryObj.field !== "comments") return null;

  const value = entryObj.value;
  if (!value || typeof value !== "object") return null;

  const valueObj = value as Record<string, unknown>;
  const media = valueObj.media;
  if (!media || typeof media !== "object") return null;

  const mediaObj = media as Record<string, unknown>;
  const mediaId = mediaObj.id;
  if (typeof mediaId !== "string") return null;

  const text = typeof valueObj.text === "string" ? valueObj.text : "";

  const from = valueObj.from;
  let authorId = "";
  if (from && typeof from === "object") {
    const fromObj = from as Record<string, unknown>;
    if (typeof fromObj.id === "string") {
      authorId = fromObj.id;
    }
  }

  const id = typeof entryObj.id === "string" ? entryObj.id : "";
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return null;

  const businessId = id;

  return { businessId, mediaId, text, authorId };
}

export function createInstagramEventProcessor({
  repository,
  batchSize = DEFAULT_BATCH_SIZE,
  leaseSeconds = DEFAULT_LEASE_SECONDS,
}: {
  repository: WebhookEventProcessingRepository;
  batchSize?: number;
  leaseSeconds?: number;
}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > DEFAULT_BATCH_SIZE) {
    throw new RangeError(`batchSize must be between 1 and ${DEFAULT_BATCH_SIZE}`);
  }
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 180) {
    throw new RangeError("leaseSeconds must be between 1 and 180");
  }

  async function process() {
    const claimed = await repository.claim(batchSize, leaseSeconds);
    if (claimed.length === 0) {
      return {
        claimed: 0,
        matched: 0,
        noMatch: 0,
        ignored: 0,
        retryableFailures: 0,
        terminalFailures: 0,
        leaseLost: 0,
        finalizationFailures: 0,
      };
    }

    let matched = 0;
    let noMatch = 0;
    let ignored = 0;
    let retryableFailures = 0;
    let terminalFailures = 0;
    let leaseLost = 0;
    let finalizationFailures = 0;

    for (const event of claimed) {
      const parsed = parseCommentEvent(event.eventPayload);
      if (!parsed) {
        ignored += 1;
        const result = await repository.finish({
          eventId: event.eventId,
          claimToken: event.claimToken,
          outcome: "IGNORED",
          instagramAccountId: null,
          matchedAutomationIds: [],
          errorCode: "MALFORMED_EVENT_PAYLOAD",
        });
        if (result.processingStatus === "PENDING" && result.processingOutcome === "RETRYABLE_FAILURE") {
          retryableFailures += 1;
        } else if (result.processingStatus === "FAILED" && result.processingOutcome === "TERMINAL_FAILURE") {
          terminalFailures += 1;
        }
        continue;
      }

      if (event.eventType !== "change:comments") {
        ignored += 1;
        await repository.finish({
          eventId: event.eventId,
          claimToken: event.claimToken,
          outcome: "IGNORED",
          instagramAccountId: null,
          matchedAutomationIds: [],
          errorCode: "UNSUPPORTED_EVENT_TYPE",
        });
        continue;
      }

      const account = await repository.findAccountByBusinessId(parsed.businessId);
      if (!account) {
        ignored += 1;
        await repository.finish({
          eventId: event.eventId,
          claimToken: event.claimToken,
          outcome: "IGNORED",
          instagramAccountId: null,
          matchedAutomationIds: [],
          errorCode: "UNKNOWN_ACCOUNT",
        });
        continue;
      }

      if (account.connectionStatus !== "CONNECTED") {
        ignored += 1;
        await repository.finish({
          eventId: event.eventId,
          claimToken: event.claimToken,
          outcome: "IGNORED",
          instagramAccountId: account.id,
          matchedAutomationIds: [],
          errorCode: "ACCOUNT_NOT_CONNECTED",
        });
        continue;
      }

      if (parsed.authorId === account.id) {
        ignored += 1;
        await repository.finish({
          eventId: event.eventId,
          claimToken: event.claimToken,
          outcome: "IGNORED",
          instagramAccountId: account.id,
          matchedAutomationIds: [],
          errorCode: "SELF_AUTHORED_COMMENT",
        });
        continue;
      }

      if (parsed.text.trim().length === 0) {
        ignored += 1;
        await repository.finish({
          eventId: event.eventId,
          claimToken: event.claimToken,
          outcome: "IGNORED",
          instagramAccountId: account.id,
          matchedAutomationIds: [],
          errorCode: "MISSING_COMMENT_TEXT",
        });
        continue;
      }

      const candidates = await repository.findCommentCandidates({
        instagramAccountId: account.id,
        mediaId: parsed.mediaId,
        limit: MAX_AUTOMATION_CANDIDATES,
      });

      const matchedAutomationIds = matchAutomations(parsed.text, candidates);
      const outcome =
        matchedAutomationIds.length > 0 ? "MATCHED" : "NO_MATCH";
      if (outcome === "MATCHED") {
        matched += 1;
      } else {
        noMatch += 1;
      }

      try {
        await repository.finish({
          eventId: event.eventId,
          claimToken: event.claimToken,
          outcome,
          instagramAccountId: account.id,
          matchedAutomationIds,
          errorCode: null,
        });
      } catch (error) {
        finalizationFailures += 1;
        if ((error as { code?: unknown }).code === "40001") {
          leaseLost += 1;
          continue;
        }
        if (
          String((error as { code?: unknown }).code ?? "").startsWith("08")
        ) {
          continue;
        }
        retryableFailures += 1;
      }
    }

    return {
      claimed: claimed.length,
      matched,
      noMatch,
      ignored,
      retryableFailures,
      terminalFailures,
      leaseLost,
      finalizationFailures,
    };
  }

  return { process };
}
