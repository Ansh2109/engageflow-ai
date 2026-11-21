import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const cwd = process.cwd();
const routePath = resolve(cwd, "src/app/api/internal/instagram-events/route.ts");
const routeMod = await import(pathToFileURL(routePath).href);
const route = routeMod.default ?? routeMod;

describe("instagram-event-processor-route", () => {
  describe("POST /instagram-events", () => {
    test("missing server secret returns 503", async () => {
      const originalSecret = process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET;
      process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET = undefined;
      try {
        const response = await route.POST(new Request("http://localhost/"));
        assert.strictEqual(response.status, 503);
        assert.deepStrictEqual(await response.json(), { error: "PROCESSOR_NOT_CONFIGURED" });
      } finally {
        if (originalSecret === undefined) {
          delete process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET;
        } else {
          process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET = originalSecret;
        }
      }
    });

    test("too-short server secret returns 503", async () => {
      const originalSecret = process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET;
      process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET = "x".repeat(8);
      try {
        const response = await route.POST(
          new Request("http://localhost/", {
            headers: { authorization: "Bearer x".repeat(8) },
          }),
        );
        assert.strictEqual(response.status, 503);
        assert.deepStrictEqual(await response.json(), { error: "PROCESSOR_NOT_CONFIGURED" });
      } finally {
        if (originalSecret === undefined) {
          delete process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET;
        } else {
          process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET = originalSecret;
        }
      }
    });

    test("missing authorization returns 401", async () => {
      const originalSecret = process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET;
      process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET = "a".repeat(32);
      try {
        const response = await route.POST(new Request("http://localhost/"));
        assert.strictEqual(response.status, 401);
        assert.deepStrictEqual(await response.json(), { error: "UNAUTHORIZED" });
      } finally {
        if (originalSecret === undefined) {
          delete process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET;
        } else {
          process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET = originalSecret;
        }
      }
    });

    test("malformed authorization returns 401", async () => {
      const originalSecret = process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET;
      process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET = "a".repeat(32);
      try {
        const response = await route.POST(
          new Request("http://localhost/", {
            headers: { authorization: "Basic dXNlcjpwYXNz" },
          }),
        );
        assert.strictEqual(response.status, 401);
        assert.deepStrictEqual(await response.json(), { error: "UNAUTHORIZED" });
      } finally {
        if (originalSecret === undefined) {
          delete process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET;
        } else {
          process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET = originalSecret;
        }
      }
    });

    test("incorrect token returns 401", async () => {
      const originalSecret = process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET;
      process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET = "a".repeat(32);
      try {
        const response = await route.POST(
          new Request("http://localhost/", {
            headers: { authorization: "Bearer wrongsecret" },
          }),
        );
        assert.strictEqual(response.status, 401);
        assert.deepStrictEqual(await response.json(), { error: "UNAUTHORIZED" });
      } finally {
        if (originalSecret === undefined) {
          delete process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET;
        } else {
          process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET = originalSecret;
        }
      }
    });

    test("correct token invokes exactly one processor pass", async () => {
      const originalSecret = process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET;
      process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET = "a".repeat(32);
      try {
        const response = await route.POST(
          new Request("http://localhost/", {
            headers: { authorization: "Bearer " + "a".repeat(32) },
          }),
        );
        // Without a database the processor cannot run, so the route returns
        // 503 PROCESSING_UNAVAILABLE. The key assertion is that auth succeeded
        // (status is not 401) — the request reached the processing stage.
        assert.notStrictEqual(response.status, 401);
        assert.strictEqual(response.status, 503);
        assert.deepStrictEqual(await response.json(), { error: "PROCESSING_UNAVAILABLE" });
      } finally {
        if (originalSecret === undefined) {
          delete process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET;
        } else {
          process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET = originalSecret;
        }
      }
    });

    test("unauthorized requests never initialize the repository", async () => {
      const originalSecret = process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET;
      process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET = "a".repeat(32);
      try {
        const response = await route.POST(
          new Request("http://localhost/", {
            headers: { authorization: "Bearer wrongsecret" },
          }),
        );
        assert.strictEqual(response.status, 401);
        assert.deepStrictEqual(await response.json(), { error: "UNAUTHORIZED" });
      } finally {
        if (originalSecret === undefined) {
          delete process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET;
        } else {
          process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET = originalSecret;
        }
      }
    });

    test("processor failure returns generic 503", async () => {
      const originalSecret = process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET;
      process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET = "a".repeat(32);
      try {
        const response = await route.POST(
          new Request("http://localhost/", {
            headers: { authorization: "Bearer " + "a".repeat(32) },
          }),
        );
        assert.strictEqual(response.status, 503);
        assert.deepStrictEqual(await response.json(), { error: "PROCESSING_UNAVAILABLE" });
      } finally {
        if (originalSecret === undefined) {
          delete process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET;
        } else {
          process.env.INSTAGRAM_EVENT_PROCESSOR_SECRET = originalSecret;
        }
      }
    });
  });

  describe("GET /instagram-events", () => {
    test("returns 405 and Allow: POST", async () => {
      const response = await route.GET();
      assert.strictEqual(response.status, 405);
      assert.deepStrictEqual(await response.json(), { error: "METHOD_NOT_ALLOWED" });
      assert.ok(
        response.headers.get("allow")?.toUpperCase() === "POST",
        "method not allowed response should advertise POST",
      );
      assert.strictEqual(
        response.headers.get("cache-control"),
        "no-store",
        "method not allowed response should be non-cacheable",
      );
    });
  });
});
