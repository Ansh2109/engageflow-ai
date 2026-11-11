import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createInstagramWebhookApi,
  type InstagramWebhookEvent,
} from "../src/lib/instagram/webhook.ts";

const appSecret = "test-meta-app-secret";
const verificationToken = "test-verify-token";
const payload = JSON.stringify({
  object: "instagram",
  entry: [
    {
      id: "17841400000000000",
      time: 1_793_319_200,
      changes: [
        {
          field: "comments",
          value: {
            id: "18000000000000001",
            text: "hello",
            media: { id: "17900000000000000" },
          },
        },
      ],
    },
  ],
});

function signature(body: string, secret = appSecret) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function postRequest(
  body = payload,
  signed = true,
  signedWith = appSecret
): Request {
  return new Request("https://engage.example/api/webhooks/instagram", {
    method: "POST",
    headers: signed ? { "x-hub-signature-256": signature(body, signedWith) } : {},
    body,
  });
}

function createHarness(
  persistEvents: (events: InstagramWebhookEvent[]) => Promise<void> = async () => {}
) {
  return createInstagramWebhookApi({
    verificationToken,
    appSecret,
    persistEvents,
  });
}

test("GET returns the challenge only for a valid subscription verification", async () => {
  const api = createHarness();
  const response = api.GET(
    new Request(
      "https://engage.example/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge-123"
    )
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await response.text(), "challenge-123");

  const invalid = api.GET(
    new Request(
      "https://engage.example/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=secret"
    )
  );
  assert.equal(invalid.status, 403);
  assert.notEqual(await invalid.text(), "secret");
});

test("GET rejects missing configuration and non-subscription verification", async () => {
  const unconfigured = createInstagramWebhookApi({
    verificationToken: undefined,
    appSecret,
    persistEvents: async () => {},
  });
  assert.equal(
    unconfigured.GET(
      new Request(
        "https://engage.example/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=anything&hub.challenge=test"
      )
    ).status,
    503
  );
  assert.equal(
    createHarness()
      .GET(
        new Request(
          "https://engage.example/api/webhooks/instagram?hub.mode=unsubscribe&hub.verify_token=test-verify-token&hub.challenge=test"
        )
      )
      .status,
    403
  );
});

test("POST rejects missing, malformed, and invalid signatures", async () => {
  const api = createHarness();
  assert.equal((await api.POST(postRequest(payload, false))).status, 401);

  const malformedSignature = new Request(
    "https://engage.example/api/webhooks/instagram",
    {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=not-a-signature" },
      body: payload,
    }
  );
  assert.equal((await api.POST(malformedSignature)).status, 401);
  assert.equal(
    (await api.POST(postRequest(payload, true, "wrong-secret"))).status,
    401
  );
});

test("POST validates the signed payload and persists each event without an internal account ID", async () => {
  const persisted: InstagramWebhookEvent[][] = [];
  const api = createHarness(async (events) => {
    persisted.push(events);
  });
  const response = await api.POST(postRequest());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "EVENT_RECEIVED");
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].length, 1);
  assert.equal(persisted[0][0].event_type, "change:comments");
  assert.equal(
    persisted[0][0].external_event_id,
    "17841400000000000:18000000000000001"
  );
  assert.equal(
    Object.hasOwn(persisted[0][0], "instagram_account_id"),
    false
  );
  assert.deepEqual(persisted[0][0].event_payload, {
    object: "instagram",
    entry: {
      id: "17841400000000000",
      time: 1_793_319_200,
      change: {
        field: "comments",
        value: {
          id: "18000000000000001",
          text: "hello",
          media: { id: "17900000000000000" },
        },
      },
    },
  });
});

test("POST rejects malformed or structurally invalid payloads", async () => {
  const api = createHarness();
  assert.equal(
    (await api.POST(postRequest("{not-json"))).status,
    400
  );
  const invalidStructure = JSON.stringify({
    object: "instagram",
    entry: [{ id: "not-an-instagram-id", time: 1, changes: [] }],
  });
  assert.equal((await api.POST(postRequest(invalidStructure))).status, 400);
  const emptyEvent = JSON.stringify({
    object: "instagram",
    entry: [{ id: "17841400000000000", time: 1 }],
  });
  assert.equal((await api.POST(postRequest(emptyEvent))).status, 400);
});

test("duplicate deliveries are accepted while persistence suppresses duplicate keys", async () => {
  const seen = new Set<string>();
  const inserted: InstagramWebhookEvent[] = [];
  const api = createHarness(async (events) => {
    for (const event of events) {
      const key = `${event.external_event_id}\0${event.event_type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      inserted.push(event);
    }
  });

  assert.equal((await api.POST(postRequest())).status, 200);
  assert.equal((await api.POST(postRequest())).status, 200);
  assert.equal(inserted.length, 1);
});

test("POST returns a retryable response when persistence fails", async () => {
  const api = createHarness(async () => {
    throw new Error("database unavailable");
  });
  assert.equal((await api.POST(postRequest()).then((response) => response.status)), 503);
});

test("oversized webhook payloads are rejected before persistence", async () => {
  let persistenceCalls = 0;
  const api = createHarness(async () => {
    persistenceCalls += 1;
  });
  const body = "x".repeat(1_048_577);
  assert.equal((await api.POST(postRequest(body))).status, 413);
  assert.equal(persistenceCalls, 0);
});

test("receiver exposes no message-sending dependency", async () => {
  const calls: string[] = [];
  const api = createHarness(async () => {
    calls.push("persist");
  });
  assert.equal((await api.POST(postRequest())).status, 200);
  assert.deepEqual(calls, ["persist"]);
});
