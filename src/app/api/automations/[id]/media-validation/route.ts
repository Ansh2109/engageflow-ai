import { createAutomationMediaValidationApi } from "@/lib/automations/media-validation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getOwnedInstagramDataContext } from "@/lib/instagram/account-data";
import { MetaApiError, verifyInstagramMedia } from "@/lib/instagram/meta";

const NO_STORE = { "Cache-Control": "no-store" };

class InstagramContextError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
  }
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, routeContext: RouteContext) {
  const { id } = await routeContext.params;
  const supabase = await createClient();
  const api = createAutomationMediaValidationApi({
    getUserId: async () => {
      const { data, error } = await supabase.auth.getUser();
      return error ? null : (data.user?.id ?? null);
    },
    repository: {
      async getDraft(ownerId, automationId) {
        const { data, error } = await supabase
          .from("automations")
          .select("instagram_account_id, target_post_id, target_media_type")
          .eq("id", automationId)
          .eq("owner_id", ownerId)
          .eq("automation_type", "COMMENT_TO_DM")
          .eq("status", "DRAFT")
          .maybeSingle();
        if (error) throw error;
        if (!data) return null;
        return {
          instagramAccountId: data.instagram_account_id,
          mediaId: data.target_post_id,
          mediaType: data.target_media_type,
        };
      },
      async verifyMedia(instagramAccountId, mediaId) {
        const result = await getOwnedInstagramDataContext(instagramAccountId);
        if (!result.ok) {
          throw new InstagramContextError(result.status, result.error);
        }
        try {
          return await verifyInstagramMedia(
            result.context.config,
            result.context.accessToken,
            result.context.instagramBusinessId,
            mediaId
          );
        } catch (error) {
          if (error instanceof MetaApiError && error.code === "meta_token_invalid") {
            await result.context.markConnectionStatus("REVOKED");
          }
          throw error;
        }
      },
      async recordVerifiedMedia(input) {
        const admin = createAdminClient();
        const { error } = await admin
          .from("automation_media_validations")
          .upsert(
            {
              automation_id: input.automationId,
              owner_id: input.ownerId,
              instagram_account_id: input.instagramAccountId,
              media_id: input.mediaId,
              media_type: input.mediaType,
              verified_at: input.verifiedAt,
              valid_until: input.validUntil,
              is_valid: true,
            },
            { onConflict: "automation_id" }
          );
        if (error) throw error;
      },
    },
  });

  try {
    return await api.validate(request, id);
  } catch (error) {
    if (error instanceof InstagramContextError) {
      return Response.json(
        { error: error.code },
        { status: error.status, headers: NO_STORE }
      );
    }
    if (error instanceof MetaApiError) {
      const status =
        error.code === "meta_identity_invalid"
          ? 400
          : error.code === "meta_media_not_owned"
            ? 404
            : error.code === "meta_token_invalid"
              ? 401
              : 502;
      return Response.json(
        {
          error:
            error.code === "meta_media_not_owned"
              ? "media_not_found"
              : error.code === "meta_token_invalid"
                ? "reconnect_required"
                : "media_verification_failed",
        },
        { status, headers: NO_STORE }
      );
    }
    console.error("[Automations] Media verification failed.");
    return Response.json(
      { error: "MEDIA_VALIDATION_UNAVAILABLE" },
      { status: 503, headers: NO_STORE }
    );
  }
}
