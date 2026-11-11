import { getOwnedInstagramDataContext } from "@/lib/instagram/account-data";
import {
  getInstagramComments,
  MetaApiError,
  verifyInstagramMediaOwnership,
} from "@/lib/instagram/meta";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await getOwnedInstagramDataContext(
    url.searchParams.get("accountId")
  );
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: result.status, headers: NO_STORE }
    );
  }

  const mediaId = url.searchParams.get("mediaId");
  if (!mediaId) {
    return Response.json(
      { error: "invalid_media_id" },
      { status: 400, headers: NO_STORE }
    );
  }
  const after = url.searchParams.get("after") ?? undefined;

  try {
    await verifyInstagramMediaOwnership(
      result.context.config,
      result.context.accessToken,
      result.context.instagramBusinessId,
      mediaId
    );
    const page = await getInstagramComments(
      result.context.config,
      result.context.accessToken,
      mediaId,
      after
    );
    return Response.json(
      { comments: page.comments, nextCursor: page.nextCursor },
      { headers: NO_STORE }
    );
  } catch (error) {
    if (error instanceof MetaApiError) {
      if (error.code === "meta_token_invalid") {
        await result.context.markConnectionStatus("REVOKED");
        return Response.json(
          { error: "reconnect_required" },
          { status: 401, headers: NO_STORE }
        );
      }
      if (error.code === "meta_identity_invalid") {
        return Response.json(
          { error: "invalid_media_id" },
          { status: 400, headers: NO_STORE }
        );
      }
      if (error.code === "meta_pagination_invalid") {
        return Response.json(
          { error: "invalid_cursor" },
          { status: 400, headers: NO_STORE }
        );
      }
      if (error.code === "meta_media_not_owned") {
        return Response.json(
          { error: "media_not_found" },
          { status: 404, headers: NO_STORE }
        );
      }
      return Response.json(
        { error: "instagram_comments_unavailable" },
        { status: 502, headers: NO_STORE }
      );
    }
    throw error;
  }
}
