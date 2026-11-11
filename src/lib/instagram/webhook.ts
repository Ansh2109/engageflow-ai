import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Json } from "../../types/database";

const MAX_BODY_BYTES = 1_048_576;
const MAX_EVENTS_PER_REQUEST = 100;
const NO_STORE = { "Cache-Control": "no-store" };

export type InstagramWebhookEvent = {
  external_event_id: string;
  event_type: string;
  event_payload: Json;
};

type InstagramWebhookDependencies = {
  verificationToken: string | undefined;
  appSecret: string | undefined;
  persistEvents: (events: InstagramWebhookEvent[]) => Promise<void>;
};

class PayloadTooLargeError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is Json {
  const pending: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    visited += 1;
    if (visited > 50_000 || current.depth > 64) return false;

    if (
      current.value === null ||
      typeof current.value === "string" ||
      typeof current.value === "boolean"
    ) {
      continue;
    }
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) return false;
      continue;
    }
    if (Array.isArray(current.value)) {
      for (const child of current.value) {
        pending.push({ value: child, depth: current.depth + 1 });
      }
      continue;
    }
    if (isRecord(current.value)) {
      for (const child of Object.values(current.value)) {
        pending.push({ value: child, depth: current.depth + 1 });
      }
      continue;
    }
    return false;
  }
  return true;
}

function isExternalId(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,64}$/.test(value);
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function verifySignature(
  body: Uint8Array,
  signature: string | null,
  appSecret: string
): boolean {
  const match = signature?.match(/^sha256=([a-f\d]{64})$/i);
  if (!match) return false;

  const expected = createHmac("sha256", appSecret).update(body).digest();
  const received = Buffer.from(match[1], "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function canonicalJson(value: Json): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    const properties = Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(value[key] as Json)}`
      );
    return `{${properties.join(",")}}`;
  }
  return JSON.stringify(value);
}

function eventId(
  accountId: string,
  eventType: string,
  payload: Json,
  providerId?: string
): string {
  if (providerId) return `${accountId}:${providerId}`;
  const digest = createHash("sha256")
    .update(`${eventType}:${canonicalJson(payload)}`)
    .digest("hex");
  return `${accountId}:sha256:${digest}`;
}

function providerIdFromValue(
  value: Record<string, Json>,
  field: string
): string | undefined {
  const candidate =
    value.comment_id ??
    (field === "comments" ? value.id : undefined);
  return typeof candidate === "string" && candidate.length <= 190
    ? candidate
    : undefined;
}

function parseWebhookPayload(raw: string): InstagramWebhookEvent[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed.object !== "instagram") return null;
  if (
    !Array.isArray(parsed.entry) ||
    parsed.entry.length === 0 ||
    parsed.entry.length > MAX_EVENTS_PER_REQUEST
  ) {
    return null;
  }

  const events: InstagramWebhookEvent[] = [];
  for (const entryValue of parsed.entry) {
    if (!isRecord(entryValue)) return null;
    const accountId = entryValue.id;
    const timestamp = entryValue.time;
    if (
      !isExternalId(accountId) ||
      typeof timestamp !== "number" ||
      !Number.isSafeInteger(timestamp) ||
      timestamp < 0
    ) {
      return null;
    }

    if (entryValue.changes !== undefined) {
      if (!Array.isArray(entryValue.changes)) return null;
      for (const changeValue of entryValue.changes) {
        if (!isRecord(changeValue) || !isRecord(changeValue.value)) return null;
        const field = changeValue.field;
        if (
          typeof field !== "string" ||
          !/^[a-zA-Z0-9_-]{1,64}$/.test(field) ||
          !isJsonValue(changeValue.value)
        ) {
          return null;
        }

        const eventType = `change:${field.toLowerCase()}`;
        const payload: Json = {
          object: "instagram",
          entry: {
            id: accountId,
            time: timestamp,
            change: {
              field: field.toLowerCase(),
              value: changeValue.value,
            },
          },
        };
        events.push({
          external_event_id: eventId(
            accountId,
            eventType,
            payload,
            providerIdFromValue(
              changeValue.value as Record<string, Json>,
              field.toLowerCase()
            )
          ),
          event_type: eventType,
          event_payload: payload,
        });
      }
    }

    if (entryValue.messaging !== undefined) {
      if (!Array.isArray(entryValue.messaging)) return null;
      for (const messagingValue of entryValue.messaging) {
        if (!isRecord(messagingValue) || !isJsonValue(messagingValue)) {
          return null;
        }
        const sender = messagingValue.sender;
        const recipient = messagingValue.recipient;
        const eventTimestamp = messagingValue.timestamp;
        if (
          !isRecord(sender) ||
          !isExternalId(sender.id) ||
          !isRecord(recipient) ||
          !isExternalId(recipient.id) ||
          typeof eventTimestamp !== "number" ||
          !Number.isSafeInteger(eventTimestamp) ||
          eventTimestamp < 0
        ) {
          return null;
        }

        const message = messagingValue.message;
        const messageRecord = isRecord(message) ? message : null;
        const kind = messageRecord
          ? "message"
          : ["postback", "read", "delivery", "reaction", "referral"].find(
              (key) => messagingValue[key] !== undefined
            ) ?? "event";
        const eventType = `messaging:${kind}`;
        const payload: Json = {
          object: "instagram",
          entry: {
            id: accountId,
            time: timestamp,
            messaging: messagingValue,
          },
        };
        const providerId =
          messageRecord &&
          typeof messageRecord.mid === "string" &&
          messageRecord.mid.length > 0 &&
          messageRecord.mid.length <= 190
            ? messageRecord.mid
            : undefined;
        events.push({
          external_event_id: eventId(
            accountId,
            eventType,
            payload,
            providerId
          ),
          event_type: eventType,
          event_payload: payload,
        });
      }
    }

    if (
      entryValue.changes === undefined &&
      entryValue.messaging === undefined
    ) {
      return null;
    }
    if (events.length > MAX_EVENTS_PER_REQUEST) return null;
  }

  return events.length > 0 ? events : null;
}

async function readLimitedBody(request: Request): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && /^\d+$/.test(contentLength)) {
    if (Number(contentLength) > MAX_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }
  }

  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function textResponse(
  body: string,
  status: number,
  contentType = "text/plain; charset=utf-8"
): Response {
  return new Response(body, {
    status,
    headers: { ...NO_STORE, "Content-Type": contentType },
  });
}

export function createInstagramWebhookApi(
  dependencies: InstagramWebhookDependencies
) {
  return {
    GET(request: Request): Response {
      const url = new URL(request.url);
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");

      if (!dependencies.verificationToken) {
        return textResponse("Webhook verification is not configured.", 503);
      }
      if (
        mode !== "subscribe" ||
        !token ||
        !challenge ||
        challenge.length > 256 ||
        !constantTimeStringEqual(token, dependencies.verificationToken)
      ) {
        return textResponse("Forbidden", 403);
      }
      return textResponse(challenge, 200);
    },

    async POST(request: Request): Promise<Response> {
      if (!dependencies.appSecret) {
        return textResponse("Webhook signature validation is not configured.", 503);
      }

      let rawBody: Uint8Array;
      try {
        rawBody = await readLimitedBody(request);
      } catch (error) {
        if (error instanceof PayloadTooLargeError) {
          return textResponse("Payload too large", 413);
        }
        return textResponse("Invalid request body", 400);
      }

      if (
        !verifySignature(
          rawBody,
          request.headers.get("x-hub-signature-256"),
          dependencies.appSecret
        )
      ) {
        return textResponse("Invalid signature", 401);
      }

      let rawText: string;
      try {
        rawText = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
      } catch {
        return textResponse("Malformed payload", 400);
      }
      const events = parseWebhookPayload(rawText);
      if (!events) return textResponse("Malformed payload", 400);

      try {
        await dependencies.persistEvents(events);
      } catch {
        return textResponse("Event persistence unavailable", 503);
      }
      return textResponse("EVENT_RECEIVED", 200);
    },
  };
}
