import assert from "node:assert/strict";
import test from "node:test";
import {
  createAutomationMediaValidationApi,
  type AutomationMediaValidationDraft,
  type AutomationMediaValidationRepository,
} from "../src/lib/automations/media-validation.ts";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const automationId = "11111111-1111-4111-8111-111111111111";

function request(origin = "https://app.example") {
  return new Request(
    `https://app.example/api/automations/${automationId}/media-validation`,
    {
      method: "POST",
      headers: { origin },
    }
  );
}

function createHarness(
  draft: AutomationMediaValidationDraft | null = {
    instagramAccountId: "22222222-2222-4222-8222-222222222222",
    mediaId: "18000000000000001",
    mediaType: "VIDEO",
  },
  verifiedMediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" = "VIDEO",
  userId: string | null = ownerId,
  verificationError: Error | null = null
) {
  const calls: string[] = [];
  const repository: AutomationMediaValidationRepository = {
    async getDraft(requestedOwnerId, requestedAutomationId) {
      calls.push("getDraft");
      assert.equal(requestedOwnerId, userId);
      assert.equal(requestedAutomationId, automationId);
      return draft;
    },
    async verifyMedia(accountId, mediaId) {
      calls.push("verifyMedia");
      assert.equal(accountId, draft?.instagramAccountId);
      assert.equal(mediaId, draft?.mediaId);
      if (verificationError) throw verificationError;
      return verifiedMediaType;
    },
    async recordVerifiedMedia(input) {
      calls.push("recordVerifiedMedia");
      assert.equal(input.ownerId, userId);
      assert.equal(input.automationId, automationId);
      assert.equal(input.instagramAccountId, draft?.instagramAccountId);
      assert.equal(input.mediaId, draft?.mediaId);
      assert.equal(input.mediaType, verifiedMediaType);
      assert.ok(Date.parse(input.validUntil) > Date.parse(input.verifiedAt));
    },
  };
  return {
    calls,
    api: createAutomationMediaValidationApi({
      getUserId: async () => userId,
      repository,
    }),
  };
}

test("media validation rejects unauthenticated and cross-tenant access", async () => {
  const unauthenticated = createHarness(undefined, "VIDEO", null);
  assert.equal(
    (await unauthenticated.api.validate(request(), automationId)).status,
    401
  );
  assert.deepEqual(unauthenticated.calls, []);

  const crossTenant = createHarness(null);
  assert.equal((await crossTenant.api.validate(request(), automationId)).status, 404);
  assert.deepEqual(crossTenant.calls, ["getDraft"]);
});

test("media validation requires same-origin POST and valid automation ID", async () => {
  const { api, calls } = createHarness();
  assert.equal(
    (await api.validate(request("https://attacker.example"), automationId)).status,
    403
  );
  assert.equal((await api.validate(request(), "bad-id")).status, 404);
  assert.deepEqual(calls, []);
});

test("missing and invalid media configuration cannot create verification evidence", async () => {
  for (const draft of [
    { instagramAccountId: "account", mediaId: null, mediaType: "VIDEO" },
    { instagramAccountId: "account", mediaId: "not-an-id", mediaType: "VIDEO" },
    { instagramAccountId: "account", mediaId: "18000000000000001", mediaType: null },
    { instagramAccountId: "account", mediaId: "18000000000000001", mediaType: "AUDIO" },
  ]) {
    const harness = createHarness(draft);
    assert.equal(
      (await harness.api.validate(request(), automationId)).status,
      409
    );
    assert.deepEqual(harness.calls, ["getDraft"]);
  }
});

test("evidence is written only after Meta confirms matching owned media", async () => {
  const mismatch = createHarness(undefined, "IMAGE");
  assert.equal(
    (await mismatch.api.validate(request(), automationId)).status,
    409
  );
  assert.deepEqual(mismatch.calls, ["getDraft", "verifyMedia"]);

  const verified = createHarness();
  const response = await verified.api.validate(request(), automationId);
  assert.equal(response.status, 200);
  assert.deepEqual(verified.calls, [
    "getDraft",
    "verifyMedia",
    "recordVerifiedMedia",
  ]);
  const body = await response.json();
  assert.equal(body.verified, true);
  assert.match(body.validUntil, /^\d{4}-\d\d-\d\dT/);

  const failedVerification = createHarness(
    undefined,
    "VIDEO",
    ownerId,
    new Error("Meta denied media access")
  );
  await assert.rejects(
    failedVerification.api.validate(request(), automationId),
    /Meta denied media access/
  );
  assert.deepEqual(failedVerification.calls, ["getDraft", "verifyMedia"]);
});
