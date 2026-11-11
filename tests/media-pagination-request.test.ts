import assert from "node:assert/strict";
import test from "node:test";
import { MediaPaginationRequestGuard } from "../src/lib/instagram/media-pagination-request.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("switching accounts aborts pending Load More and allows the new account request", () => {
  const guard = new MediaPaginationRequestGuard();
  const firstAccountRequest = guard.begin();
  assert.ok(firstAccountRequest);

  guard.reset();

  assert.equal(firstAccountRequest.controller.signal.aborted, true);
  const secondAccountRequest = guard.begin();
  assert.ok(secondAccountRequest);
  assert.equal(guard.isCurrent(secondAccountRequest), true);
});

test("a Load More response resolving after account switch cannot add cross-account media", async () => {
  const guard = new MediaPaginationRequestGuard();
  const firstAccountRequest = guard.begin();
  assert.ok(firstAccountRequest);
  const delayedResponse = deferred<string[]>();
  const media: string[] = [];

  guard.reset();
  const secondAccountRequest = guard.begin();
  assert.ok(secondAccountRequest);
  delayedResponse.resolve(["first-account-media"]);

  const oldMedia = await delayedResponse.promise;
  if (guard.isCurrent(firstAccountRequest)) media.push(...oldMedia);

  assert.deepEqual(media, []);
  assert.equal(guard.isCurrent(secondAccountRequest), true);
});

test("a Load More request rejecting after account switch cannot set current-account error state", async () => {
  const guard = new MediaPaginationRequestGuard();
  const firstAccountRequest = guard.begin();
  assert.ok(firstAccountRequest);
  const delayedResponse = deferred<void>();
  let error: string | null = null;

  guard.reset();
  const secondAccountRequest = guard.begin();
  assert.ok(secondAccountRequest);
  delayedResponse.reject(new Error("aborted"));

  try {
    await delayedResponse.promise;
  } catch {
    if (guard.isCurrent(firstAccountRequest)) {
      error = "More Instagram posts could not be reached.";
    }
  }

  assert.equal(error, null);
  assert.equal(guard.isCurrent(secondAccountRequest), true);
});

test("a stale Load More finally block cannot release the new account pagination lock", () => {
  const guard = new MediaPaginationRequestGuard();
  const firstAccountRequest = guard.begin();
  assert.ok(firstAccountRequest);
  guard.reset();
  const secondAccountRequest = guard.begin();
  assert.ok(secondAccountRequest);

  assert.equal(guard.finish(firstAccountRequest), false);
  assert.equal(guard.isCurrent(secondAccountRequest), true);
  assert.equal(guard.finish(secondAccountRequest), true);
  assert.equal(guard.begin() !== null, true);
});
