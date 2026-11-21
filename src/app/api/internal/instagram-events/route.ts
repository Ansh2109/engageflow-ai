import { timingSafeEqual } from "node:crypto";
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_LEASE_SECONDS,
  createInstagramEventProcessor,
  createInstagramEventRepository,
} from "../../../../lib/instagram/event-processor.ts";

const NO_STORE = { "Cache-Control": "no-store" };
const MIN_SECRET_LENGTH = 32;

function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...NO_STORE,
      ...extraHeaders,
    },
  });
}

function bearerSecret(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer (.+)$/i.exec(header);
  return match ? match[1] : null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export async function POST(request: Request) {
  const expected = process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET;
  if (!expected || expected.length < MIN_SECRET_LENGTH) {
    return json({ error: "PROCESSOR_NOT_CONFIGURED" }, 503);
  }

  const provided = bearerSecret(request);
  if (!provided || !constantTimeEqual(provided, expected)) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  try {
    const repository = createInstagramEventRepository();
    const processor = createInstagramEventProcessor({
      repository,
      batchSize: DEFAULT_BATCH_SIZE,
      leaseSeconds: DEFAULT_LEASE_SECONDS,
    });
    return json({ ok: true, summary: await processor.process() });
  } catch {
    console.error("[Instagram Events] Webhook event processing pass failed.");
    return json({ error: "PROCESSING_UNAVAILABLE" }, 503);
  }
}

export async function GET() {
  return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
    status: 405,
    headers: {
      "Content-Type": "application/json",
      ...NO_STORE,
      Allow: "POST",
    },
  });
}
