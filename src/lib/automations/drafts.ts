import type {
  AutomationStatus,
  AutomationType,
  MatchType,
} from "@/types/database";

export type DraftMediaType = "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";

export type CommentToDmDraftInput = {
  name: string;
  accountId: string;
  mediaId: string;
  mediaType: DraftMediaType;
  matchMode: MatchType;
  keywords: string[];
  privateMessage: string;
  publicReplyEnabled: boolean;
  publicReply: string;
};

export type AutomationDraft = CommentToDmDraftInput & {
  id: string;
  automationType: AutomationType;
  status: "DRAFT";
  createdAt: string;
  updatedAt: string;
};

export type AutomationListItem = {
  id: string;
  name: string;
  automationType: AutomationType;
  accountName: string;
  accountUsername: string;
  status: AutomationStatus;
  updatedAt: string;
};

type AutomationDraftRepository = {
  list: (ownerId: string) => Promise<AutomationListItem[]>;
  get: (ownerId: string, id: string) => Promise<AutomationDraft | null>;
  save: (
    ownerId: string,
    id: string | null,
    input: CommentToDmDraftInput
  ) => Promise<string>;
  delete: (ownerId: string, id: string) => Promise<boolean>;
};

type AutomationDraftApiDependencies = {
  getUserId: () => Promise<string | null>;
  repository: AutomationDraftRepository;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_ID_PATTERN = /^[0-9]{1,32}$/;
const MEDIA_TYPES = new Set<DraftMediaType>([
  "IMAGE",
  "VIDEO",
  "CAROUSEL_ALBUM",
]);
const MATCH_MODES = new Set<MatchType>(["EXACT", "CONTAINS"]);
const INPUT_FIELDS = new Set([
  "name",
  "accountId",
  "mediaId",
  "mediaType",
  "matchMode",
  "keywords",
  "privateMessage",
  "publicReplyEnabled",
  "publicReply",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateCommentToDmDraft(
  value: unknown
): CommentToDmDraftInput | null {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !INPUT_FIELDS.has(key)) ||
    typeof value.name !== "string" ||
    typeof value.accountId !== "string" ||
    typeof value.mediaId !== "string" ||
    typeof value.mediaType !== "string" ||
    typeof value.matchMode !== "string" ||
    !Array.isArray(value.keywords) ||
    typeof value.privateMessage !== "string" ||
    typeof value.publicReplyEnabled !== "boolean" ||
    typeof value.publicReply !== "string"
  ) {
    return null;
  }

  const name = value.name.trim();
  const privateMessage = value.privateMessage;
  const publicReply = value.publicReply;
  const keywords = value.keywords.map((keyword) =>
    typeof keyword === "string" ? keyword.trim() : ""
  );
  const normalizedKeywords = [...new Map(
    keywords.map((keyword) => [keyword.toLowerCase(), keyword])
  ).values()];

  if (
    name.length < 1 ||
    name.length > 120 ||
    !UUID_PATTERN.test(value.accountId) ||
    !MEDIA_ID_PATTERN.test(value.mediaId) ||
    !MEDIA_TYPES.has(value.mediaType as DraftMediaType) ||
    !MATCH_MODES.has(value.matchMode as MatchType) ||
    keywords.some((keyword) => keyword.length < 1 || keyword.length > 64) ||
    normalizedKeywords.length < 1 ||
    normalizedKeywords.length > 20 ||
    privateMessage.trim().length < 1 ||
    [...privateMessage].length > 2200 ||
    [...publicReply].length > 2200 ||
    (value.publicReplyEnabled && publicReply.trim().length < 1)
  ) {
    return null;
  }

  return {
    name,
    accountId: value.accountId,
    mediaId: value.mediaId,
    mediaType: value.mediaType as DraftMediaType,
    matchMode: value.matchMode as MatchType,
    keywords: normalizedKeywords,
    privateMessage,
    publicReplyEnabled: value.publicReplyEnabled,
    publicReply,
  };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function errorCode(error: unknown): string | null {
  if (!isRecord(error) || typeof error.code !== "string") return null;
  return error.code;
}

async function authenticatedUser(
  getUserId: AutomationDraftApiDependencies["getUserId"]
): Promise<string | Response> {
  try {
    const userId = await getUserId();
    return userId || json({ error: "unauthorized" }, 401);
  } catch {
    console.error("[Automations] Authentication lookup failed.");
    return json({ error: "authentication_unavailable" }, 500);
  }
}

export function createAutomationDraftApi({
  getUserId,
  repository,
}: AutomationDraftApiDependencies) {
  return {
    async list(): Promise<Response> {
      const ownerId = await authenticatedUser(getUserId);
      if (ownerId instanceof Response) return ownerId;
      try {
        return json({ automations: await repository.list(ownerId) });
      } catch {
        console.error("[Automations] Listing drafts failed.");
        return json({ error: "automations_unavailable" }, 500);
      }
    },

    async get(id: string): Promise<Response> {
      const ownerId = await authenticatedUser(getUserId);
      if (ownerId instanceof Response) return ownerId;
      if (!UUID_PATTERN.test(id)) return json({ error: "not_found" }, 404);
      try {
        const draft = await repository.get(ownerId, id);
        return draft
          ? json({ draft })
          : json({ error: "not_found" }, 404);
      } catch {
        console.error("[Automations] Loading a draft failed.");
        return json({ error: "draft_unavailable" }, 500);
      }
    },

    async save(request: Request, id: string | null = null): Promise<Response> {
      const ownerId = await authenticatedUser(getUserId);
      if (ownerId instanceof Response) return ownerId;
      if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);
      if (id !== null && !UUID_PATTERN.test(id)) {
        return json({ error: "invalid_request" }, 400);
      }

      let payload: unknown;
      try {
        const body = await request.text();
        if (body.length > 32_000) {
          return json({ error: "invalid_request" }, 400);
        }
        payload = JSON.parse(body);
      } catch {
        return json({ error: "invalid_request" }, 400);
      }
      const input = validateCommentToDmDraft(payload);
      if (!input) return json({ error: "invalid_request" }, 400);

      try {
        const automationId = await repository.save(ownerId, id, input);
        const draft = await repository.get(ownerId, automationId);
        if (!draft) return json({ error: "draft_unavailable" }, 500);
        return json({ draft }, id ? 200 : 201);
      } catch (error) {
        if (errorCode(error) === "P0002") {
          return json({ error: "draft_or_account_not_found" }, 404);
        }
        if (errorCode(error) === "22023") {
          return json({ error: "invalid_request" }, 400);
        }
        console.error("[Automations] Saving a draft failed.");
        return json({ error: "draft_save_failed" }, 500);
      }
    },

    async delete(request: Request, id: string): Promise<Response> {
      const ownerId = await authenticatedUser(getUserId);
      if (ownerId instanceof Response) return ownerId;
      if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);
      if (!UUID_PATTERN.test(id)) return json({ error: "not_found" }, 404);
      try {
        return (await repository.delete(ownerId, id))
          ? json({ deleted: true })
          : json({ error: "not_found" }, 404);
      } catch {
        console.error("[Automations] Deleting a draft failed.");
        return json({ error: "draft_delete_failed" }, 500);
      }
    },
  };
}

export type { AutomationDraftRepository };
