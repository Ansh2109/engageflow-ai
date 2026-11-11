export type AutomationMediaType = "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";

export type AutomationMediaValidationDraft = {
  instagramAccountId: string;
  mediaId: string | null;
  mediaType: string | null;
};

type AutomationMediaValidationRepository = {
  getDraft: (
    ownerId: string,
    automationId: string
  ) => Promise<AutomationMediaValidationDraft | null>;
  verifyMedia: (
    instagramAccountId: string,
    mediaId: string
  ) => Promise<AutomationMediaType>;
  recordVerifiedMedia: (input: {
    automationId: string;
    ownerId: string;
    instagramAccountId: string;
    mediaId: string;
    mediaType: AutomationMediaType;
    verifiedAt: string;
    validUntil: string;
  }) => Promise<void>;
};

type AutomationMediaValidationDependencies = {
  getUserId: () => Promise<string | null>;
  repository: AutomationMediaValidationRepository;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const META_ID_PATTERN = /^[0-9]{1,32}$/;
const MEDIA_TYPES: ReadonlySet<string> = new Set([
  "IMAGE",
  "VIDEO",
  "CAROUSEL_ALBUM",
]);
const NO_STORE = { "Cache-Control": "no-store" };

function isMediaType(value: string): value is AutomationMediaType {
  return MEDIA_TYPES.has(value);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
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

export function createAutomationMediaValidationApi({
  getUserId,
  repository,
}: AutomationMediaValidationDependencies) {
  return {
    async validate(request: Request, automationId: string): Promise<Response> {
      const ownerId = await getUserId();
      if (!ownerId) return json({ error: "UNAUTHORIZED" }, 401);
      if (!isSameOrigin(request)) return json({ error: "FORBIDDEN" }, 403);
      if (!UUID_PATTERN.test(automationId)) {
        return json({ error: "NOT_FOUND" }, 404);
      }

      const draft = await repository.getDraft(ownerId, automationId);
      if (!draft) return json({ error: "NOT_FOUND" }, 404);
      if (
        !draft.mediaId ||
        !META_ID_PATTERN.test(draft.mediaId) ||
        !draft.mediaType ||
        !isMediaType(draft.mediaType)
      ) {
        return json({ error: "INVALID_CONFIGURATION" }, 409);
      }

      const verifiedType = await repository.verifyMedia(
        draft.instagramAccountId,
        draft.mediaId
      );
      if (verifiedType !== draft.mediaType) {
        return json({ error: "MEDIA_CONFIGURATION_MISMATCH" }, 409);
      }

      const verifiedAt = new Date();
      const validUntil = new Date(
        verifiedAt.getTime() + 5 * 60 * 1000
      ).toISOString();
      await repository.recordVerifiedMedia({
        automationId,
        ownerId,
        instagramAccountId: draft.instagramAccountId,
        mediaId: draft.mediaId,
        mediaType: verifiedType,
        verifiedAt: verifiedAt.toISOString(),
        validUntil,
      });

      return json({ verified: true, validUntil });
    },
  };
}

export type { AutomationMediaValidationRepository };
