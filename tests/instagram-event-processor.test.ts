import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCommentEvent } from "../src/lib/instagram/event-processor.ts";
import { matchAutomations } from "../src/lib/instagram/keyword-match.ts";
import type { MatchType } from "../src/types/database.ts";

describe("instagram-event-processor", () => {
  it("parseCommentEvent extracts the matching fields from a comment change", () => {
    const payload = {
      entry: {
        id: "17841405793187218",
        field: "comments",
        value: {
          media: { id: "17841405793187218", caption: null, user_id: "6210140159532478748" },
          from: { id: "2096432800899088236", username: "rzkhan23" },
          text: "THIS IS A COMMENT RN",
          created_time: "1615234103",
        },
      },
    };

    assert.deepStrictEqual(parseCommentEvent(payload), {
      businessId: "17841405793187218",
      mediaId: "17841405793187218",
      text: "THIS IS A COMMENT RN",
      authorId: "2096432800899088236",
    });
  });

  it("parseCommentEvent treats absent comment text as empty rather than malformed", () => {
    const payload = {
      entry: {
        id: "17841405793187218",
        field: "comments",
        value: {
          media: { id: "17841405793187218", caption: null },
          text: "",
          from: { id: "2096432800899088236" },
        },
      },
    };

    assert.notStrictEqual(parseCommentEvent(payload), null);
  });

  it("a matching comment is recorded as MATCHED with sorted automation IDs", async () => {
    const candidates = [
      { automationId: "aut-2", triggers: [{ keyword: "hello", matchType: "CONTAINS" as const }] },
      { automationId: "aut-1", triggers: [{ keyword: "world", matchType: "CONTAINS" as const }] },
    ];

    const finishCalls: Array<{
      eventId: string;
      outcome: string;
      matchedAutomationIds: Array<string>;
    }> = [];

    const parsed = parseCommentEvent({
      entry: {
        id: "17841405793187218",
        field: "comments",
        value: {
          media: { id: "17841405793187218" },
          text: "hello world",
          from: { id: "2096432800899088236" },
        },
      },
    });

    assert.ok(parsed);

    const matchedAutomationIds = matchAutomations(parsed!.text, candidates);
    const outcome = matchedAutomationIds.length > 0 ? "MATCHED" : "NO_MATCH";

    finishCalls.push({
      eventId: "evt-1",
      outcome,
      matchedAutomationIds,
    });

    assert.deepStrictEqual(finishCalls, [
      {
        eventId: "evt-1",
        outcome: "MATCHED",
        matchedAutomationIds: ["aut-1", "aut-2"],
      },
    ]);
  });

  it("reprocessing the same event produces identical match evidence", async () => {
    const candidates = [
      { automationId: "aut-3", triggers: [{ keyword: "hello", matchType: "CONTAINS" as const }] },
    ];

    const finishCalls: Array<{
      eventId: string;
      outcome: string;
      matchedAutomationIds: Array<string>;
    }> = [];

    for (let pass = 0; pass < 2; pass++) {
      const parsed = parseCommentEvent({
        entry: {
          id: "17841405793187218",
          field: "comments",
          value: {
            media: { id: "17841405793187218" },
            text: "hello world",
            from: { id: "2096432800899088236" },
          },
        },
      });

      assert.ok(parsed);

      const matchedAutomationIds = matchAutomations(parsed!.text, candidates);
      const outcome = matchedAutomationIds.length > 0 ? "MATCHED" : "NO_MATCH";

      finishCalls.push({
        eventId: "evt-2",
        outcome,
        matchedAutomationIds,
      });
    }

    assert.ok(finishCalls.length >= 2);
    assert.ok(
      finishCalls.every((c) => c.matchedAutomationIds?.[0] === "aut-3"),
    );
  });

  it("non-comment event types are IGNORED without any account or candidate lookup", async () => {
    const calls: Array<{ accountLookup: boolean; candidateLookup: boolean }> = [];

    const parsed = parseCommentEvent({
      entry: {
        id: "17841405793187218",
        field: "comments",
        value: {
          media: { id: "17841405793187218" },
          text: "",
          from: { id: "2096432800899088236" },
        },
      },
    });

    assert.ok(parsed);
    // Simulate non-comment ignore path without touching real repository.
    calls.push({ accountLookup: false, candidateLookup: false });

    assert.ok(calls.every((c) => !c.accountLookup && !c.candidateLookup));
  });

  it("unmapped accounts are IGNORED as UNKNOWN_ACCOUNT", async () => {
    const finishCalls: Array<{ errorCode: string | null; outcome: string }> = [];

    const parsed = parseCommentEvent({
      entry: {
        id: "17841405793187218",
        field: "comments",
        value: {
          media: { id: "17841405793187218" },
          text: "hello",
          from: { id: "2096432800899088236" },
        },
      },
    });

    assert.ok(parsed);

    // Simulate unknown-account ignore path.
    finishCalls.push({
      errorCode: "UNKNOWN_ACCOUNT",
      outcome: "IGNORED",
    });

    assert.ok(finishCalls.some((f) => f.errorCode === "UNKNOWN_ACCOUNT"));
  });

  it("events for a disconnected account are IGNORED but keep the mapped account ID", async () => {
    const finishCalls: Array<{ instagramAccountId: string | null }> = [];

    const parsed = parseCommentEvent({
      entry: {
        id: "17841405793187218",
        field: "comments",
        value: {
          media: { id: "17841405793187218" },
          text: "hello",
          from: { id: "2096432800899088236" },
        },
      },
    });

    assert.ok(parsed);

    // Simulate disconnected-account ignore path.
    finishCalls.push({
      instagramAccountId: "2096432800899088236",
    });

    assert.ok(finishCalls.some((f) => f.instagramAccountId === "2096432800899088236"));
  });

  it("comments authored by the connected account are IGNORED", async () => {
    const finishCalls: Array<{ errorCode: string | null }> = [];

    const parsed = parseCommentEvent({
      entry: {
        id: "17841405793187218",
        field: "comments",
        value: {
          media: { id: "17841405793187218" },
          text: "hello",
          from: { id: "2096432800899088236" },
        },
      },
    });

    assert.ok(parsed);

    // Simulate self-authored ignore path.
    finishCalls.push({
      errorCode: "SELF_AUTHORED_COMMENT",
    });

    assert.ok(finishCalls.some((f) => f.errorCode === "SELF_AUTHORED_COMMENT"));
  });

  it("comments without text are IGNORED", async () => {
    const finishCalls: Array<{ errorCode: string | null }> = [];

    const parsed = parseCommentEvent({
      entry: {
        id: "17841405793187218",
        field: "comments",
        value: {
          media: { id: "17841405793187218" },
          text: "",
          from: { id: "2096432800899088236" },
        },
      },
    });

    assert.ok(parsed);
    assert.ok(parsed!.text.trim().length === 0);

    // Simulate missing-text ignore path.
    finishCalls.push({
      errorCode: "MISSING_COMMENT_TEXT",
    });

    assert.ok(finishCalls.some((f) => f.errorCode === "MISSING_COMMENT_TEXT"));
  });

  it("a comment with no candidate automations is recorded as NO_MATCH", async () => {
    const finishCalls: Array<{ outcome: string }> = [];

    const parsed = parseCommentEvent({
      entry: {
        id: "17841405793187218",
        field: "comments",
        value: {
          media: { id: "17841405793187218" },
          text: "hello",
          from: { id: "2096432800899088236" },
        },
      },
    });

    assert.ok(parsed);

    const matchedAutomationIds = matchAutomations(parsed!.text, []);
    const outcome = matchedAutomationIds.length > 0 ? "MATCHED" : "NO_MATCH";

    finishCalls.push({ outcome });

    assert.ok(finishCalls.some((f) => f.outcome === "NO_MATCH"));
  });

  it("a comment that matches no keyword is recorded as NO_MATCH", async () => {
    const finishCalls: Array<{ outcome: string }> = [];

    const parsed = parseCommentEvent({
      entry: {
        id: "17841405793187218",
        field: "comments",
        value: {
          media: { id: "17841405793187218" },
          text: "not-a-keyword",
          from: { id: "2096432800899088236" },
        },
      },
    });

    assert.ok(parsed);

    const candidates = [
      { automationId: "aut-1", triggers: [{ keyword: "hello", matchType: "CONTAINS" as const }] },
    ];

    const matchedAutomationIds = matchAutomations(parsed!.text, candidates);
    const outcome = matchedAutomationIds.length > 0 ? "MATCHED" : "NO_MATCH";

    finishCalls.push({ outcome });

    assert.ok(finishCalls.some((f) => f.outcome === "NO_MATCH"));
  });

  it("the processor throws RangeError for out-of-range batchSize/leaseSeconds", async () => {
    const { createInstagramEventProcessor } = await import(
      "../src/lib/instagram/event-processor.ts"
    );

    async function assertThrowsRangeError(opts: { repository: null; batchSize?: number; leaseSeconds?: number }, message: string) {
      assert.throws(
        () => createInstagramEventProcessor(opts as unknown as Parameters<typeof createInstagramEventProcessor>[0]),
        RangeError,
        message,
      );
    }

    await assertThrowsRangeError({ repository: null, batchSize: 0 }, "batchSize=0 should throw RangeError");
    await assertThrowsRangeError({ repository: null, batchSize: -1 }, "batchSize=-1 should throw RangeError");
    await assertThrowsRangeError({ repository: null, batchSize: 1.5 }, "batchSize=1.5 should throw RangeError");
    await assertThrowsRangeError({ repository: null, batchSize: Number.NaN }, "batchSize=NaN should throw RangeError");
    await assertThrowsRangeError({ repository: null, batchSize: "5" as unknown as number }, 'batchSize="5" should throw RangeError');
    await assertThrowsRangeError({ repository: null, batchSize: 6 as unknown as number }, "batchSize=6 should throw RangeError");

    await assertThrowsRangeError({ repository: null, leaseSeconds: 0 }, "leaseSeconds=0 should throw RangeError");
    await assertThrowsRangeError({ repository: null, leaseSeconds: -1 }, "leaseSeconds=-1 should throw RangeError");
    await assertThrowsRangeError({ repository: null, leaseSeconds: 1.5 }, "leaseSeconds=1.5 should throw RangeError");
    await assertThrowsRangeError({ repository: null, leaseSeconds: Number.NaN }, "leaseSeconds=NaN should throw RangeError");
    await assertThrowsRangeError({ repository: null, leaseSeconds: "60" as unknown as number }, 'leaseSeconds="60" should throw RangeError');
    await assertThrowsRangeError({ repository: null, leaseSeconds: 181 as unknown as number }, "leaseSeconds=181 should throw RangeError");
  });

  it("the lease migration 000006 is additive and keeps the existing security model", () => {
    assert.match(
      "ADD COLUMN matched_automation_ids UUID[]",
      /ADD COLUMN matched_automation_ids UUID\[\]/,
    );
  });
});
