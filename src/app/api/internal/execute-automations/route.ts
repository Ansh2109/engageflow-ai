import { timingSafeEqual } from "node:crypto";
import { executeMatchedEvents } from "@/lib/automations/message-executor";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...NO_STORE },
  });
}

export async function POST(request: Request) {
  const expected = process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET;
  if (!expected || expected.length < 32) {
    return json({ error: "PROCESSOR_NOT_CONFIGURED" }, 503);
  }

  const header = request.headers.get("authorization");
  const match = /^Bearer (.+)$/i.exec(header ?? "");
  const provided = match ? match[1] : null;

  if (!provided || !constantTimeEqual(provided, expected)) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  try {
    const result = await executeMatchedEvents();
    return json({ ok: true, ...result });
  } catch {
    return json({ error: "EXECUTION_UNAVAILABLE" }, 503);
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const l = Buffer.from(left, "utf8");
  const r = Buffer.from(right, "utf8");
  return l.length === r.length && timingSafeEqual(l, r);
}

export async function GET() {
  return json({ error: "METHOD_NOT_ALLOWED" }, 405);
}