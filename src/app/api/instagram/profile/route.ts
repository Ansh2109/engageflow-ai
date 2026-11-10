import { getOwnedInstagramDataContext } from "@/lib/instagram/account-data";
import {
  getInstagramProfile,
  MetaApiError,
} from "@/lib/instagram/meta";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const accountId = new URL(request.url).searchParams.get("accountId");
  const result = await getOwnedInstagramDataContext(accountId);
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: result.status, headers: NO_STORE }
    );
  }

  try {
    const profile = await getInstagramProfile(
      result.context.config,
      result.context.accessToken,
      result.context.instagramBusinessId
    );
    return Response.json({ profile }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof MetaApiError) {
      if (error.code === "meta_token_invalid") {
        await result.context.markConnectionStatus("REVOKED");
        return Response.json(
          { error: "reconnect_required" },
          { status: 401, headers: NO_STORE }
        );
      }
      return Response.json(
        { error: "instagram_profile_unavailable" },
        { status: 502, headers: NO_STORE }
      );
    }
    throw error;
  }
}
