import { getOwnedInstagramDataContext } from "@/lib/instagram/account-data";
import {
  claimInstagramCommentReplyAttempt,
  getInstagramCommentReplyTarget,
  isInstagramCommentReplyableOnMedia,
  MetaApiError,
  replyToInstagramComment,
  verifyInstagramMediaOwnership,
} from "@/lib/instagram/meta";

const NO_STORE = { "Cache-Control": "no-store" };

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json(
      { error: "forbidden" },
      { status: 403, headers: NO_STORE }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: NO_STORE }
    );
  }

  if (
    !isRecord(body) ||
    body.confirm !== true ||
    typeof body.accountId !== "string" ||
    typeof body.mediaId !== "string" ||
    typeof body.commentId !== "string" ||
    typeof body.message !== "string" ||
    body.message.trim().length === 0 ||
    [...body.message.trim()].length > 2200
  ) {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: NO_STORE }
    );
  }

  const result = await getOwnedInstagramDataContext(body.accountId);
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: result.status, headers: NO_STORE }
    );
  }

  try {
    await verifyInstagramMediaOwnership(
      result.context.config,
      result.context.accessToken,
      result.context.instagramBusinessId,
      body.mediaId
    );
    const comment = await getInstagramCommentReplyTarget(
      result.context.config,
      result.context.accessToken,
      body.commentId
    );
    if (comment.mediaId !== body.mediaId) {
      return Response.json(
        { error: "comment_not_found" },
        { status: 404, headers: NO_STORE }
      );
    }
    if (!isInstagramCommentReplyableOnMedia(comment, body.mediaId)) {
      return Response.json(
        { error: "comment_not_replyable" },
        { status: 409, headers: NO_STORE }
      );
    }
    if (
      !claimInstagramCommentReplyAttempt(
        body.accountId,
        comment.id
      )
    ) {
      return Response.json(
        { error: "reply_attempt_already_made", retryable: false },
        { status: 409, headers: NO_STORE }
      );
    }

    const reply = await replyToInstagramComment(
      result.context.config,
      result.context.accessToken,
      comment.id,
      body.message
    );
    return Response.json({ reply }, { headers: NO_STORE });
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
          { error: "invalid_comment_or_media_id" },
          { status: 400, headers: NO_STORE }
        );
      }
      if (error.code === "meta_media_not_owned") {
        return Response.json(
          { error: "media_not_found" },
          { status: 404, headers: NO_STORE }
        );
      }
      if (error.code === "meta_comment_reply_invalid") {
        return Response.json(
          { error: "invalid_reply_message" },
          { status: 400, headers: NO_STORE }
        );
      }
      if (error.code === "meta_post_outcome_unknown") {
        return Response.json(
          {
            error: "instagram_comment_reply_outcome_unknown",
            outcome: "unknown",
            retryable: false,
          },
          { status: 502, headers: NO_STORE }
        );
      }
      return Response.json(
        { error: "instagram_comment_reply_failed", retryable: false },
        { status: 502, headers: NO_STORE }
      );
    }
    throw error;
  }
}
