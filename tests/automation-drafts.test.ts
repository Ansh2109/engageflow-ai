import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createAutomationDraftApi,
  type AutomationDraft,
  type AutomationDraftRepository,
  type AutomationListItem,
  type CommentToDmDraftInput,
} from "../src/lib/automations/drafts.ts";

const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const accountA = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";

const validInput: CommentToDmDraftInput = {
  name: "Comment-to-DM launch",
  accountId: accountA,
  mediaId: "17900000000000000",
  mediaType: "VIDEO",
  matchMode: "CONTAINS",
  keywords: ["GITHUB", "FREEBIE"],
  privateMessage: "Hey {{username}}, thanks!",
  publicReplyEnabled: true,
  publicReply: "I sent you a message.",
};

function createTestApi(initialUserId: string | null = ownerA) {
  let userId = initialUserId;
  const rows = new Map<string, { ownerId: string; draft: AutomationDraft }>();
  const connectedAccounts = new Map([[ownerA, new Set([accountA])]]);
  const nextId = draftId;
  const repository: AutomationDraftRepository = {
    async list(ownerId): Promise<AutomationListItem[]> {
      return [...rows.values()]
        .filter(({ ownerId: rowOwnerId }) => rowOwnerId === ownerId)
        .map(({ draft }) => ({
          id: draft.id,
          name: draft.name,
          automationType: draft.automationType,
          accountName: "Creator",
          accountUsername: "creator",
          status: draft.status,
          updatedAt: draft.updatedAt,
        }));
    },
    async get(ownerId, id) {
      const row = rows.get(id);
      return row?.ownerId === ownerId ? row.draft : null;
    },
    async save(ownerId, id, input) {
      if (!connectedAccounts.get(ownerId)?.has(input.accountId)) {
        throw Object.assign(new Error("not found"), { code: "P0002" });
      }
      const existing = id ? rows.get(id) : undefined;
      if (id && (!existing || existing.ownerId !== ownerId)) {
        throw Object.assign(new Error("not found"), { code: "P0002" });
      }
      const savedId = id ?? nextId;
      const now = new Date().toISOString();
      const draft: AutomationDraft = {
        ...input,
        id: savedId,
        automationType: "COMMENT_TO_DM",
        status: "DRAFT",
        createdAt: existing?.draft.createdAt ?? now,
        updatedAt: now,
      };
      rows.set(savedId, {
        ownerId: existing?.ownerId ?? ownerId,
        draft,
      });
      return savedId;
    },
    async delete(ownerId, id) {
      const row = rows.get(id);
      if (!row || row.ownerId !== ownerId || row.draft.status !== "DRAFT") {
        return false;
      }
      rows.delete(id);
      return true;
    },
  };
  const api = createAutomationDraftApi({
    getUserId: async () => userId,
    repository,
  });
  return {
    api,
    rows,
    setUserId(value: string | null) {
      userId = value;
    },
  };
}

function mutationRequest(body: unknown): Request {
  return new Request("https://engageflow.test/api/automations", {
    method: "POST",
    headers: {
      origin: "https://engageflow.test",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function responseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

test("saving creates a DRAFT without accepting a client-supplied owner", async () => {
  const { api, rows } = createTestApi();
  const response = await api.save(
    mutationRequest({ ...validInput, owner_id: ownerB })
  );
  assert.equal(response.status, 400);
  assert.equal(rows.size, 0);

  const saved = await api.save(mutationRequest(validInput));
  assert.equal(saved.status, 201);
  const { draft } = await responseJson<{ draft: AutomationDraft }>(saved);
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.id, draftId);
  assert.equal(rows.get(draftId)?.ownerId, ownerA);
});

test("loading returns only the authenticated user's draft", async () => {
  const { api, setUserId } = createTestApi();
  await api.save(mutationRequest(validInput));

  const ownDraft = await api.get(draftId);
  assert.equal(ownDraft.status, 200);
  assert.equal((await responseJson<{ draft: AutomationDraft }>(ownDraft)).draft.id, draftId);

  setUserId(ownerB);
  assert.equal((await api.get(draftId)).status, 404);
});

test("the automation list is scoped to the current user", async () => {
  const { api, rows, setUserId } = createTestApi();
  await api.save(mutationRequest(validInput));
  const otherDraft: AutomationDraft = {
    ...validInput,
    id: "44444444-4444-4444-8444-444444444444",
    automationType: "COMMENT_TO_DM",
    status: "DRAFT",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  rows.set(otherDraft.id, { ownerId: ownerB, draft: otherDraft });

  const ownList = await responseJson<{ automations: AutomationListItem[] }>(
    await api.list()
  );
  assert.deepEqual(ownList.automations.map(({ id }) => id), [draftId]);

  setUserId(ownerB);
  const otherList = await responseJson<{ automations: AutomationListItem[] }>(
    await api.list()
  );
  assert.deepEqual(otherList.automations.map(({ id }) => id), [otherDraft.id]);
});

test("editing updates an owned draft while preserving its ID and owner", async () => {
  const { api, rows } = createTestApi();
  await api.save(mutationRequest(validInput));
  const updated = await api.save(
    mutationRequest({ ...validInput, name: "Updated draft" }),
    draftId
  );
  assert.equal(updated.status, 200);
  const { draft } = await responseJson<{ draft: AutomationDraft }>(updated);
  assert.equal(draft.id, draftId);
  assert.equal(draft.name, "Updated draft");
  assert.equal(rows.get(draftId)?.ownerId, ownerA);
});

test("deleting is restricted to the authenticated owner's draft", async () => {
  const { api, setUserId, rows } = createTestApi();
  await api.save(mutationRequest(validInput));

  setUserId(ownerB);
  assert.equal(
    (
      await api.delete(
        new Request(`https://engageflow.test/api/automations/${draftId}`, {
          method: "DELETE",
          headers: { origin: "https://engageflow.test" },
        }),
        draftId
      )
    ).status,
    404
  );
  assert.equal(rows.size, 1);

  setUserId(ownerA);
  const deleted = await api.delete(
    new Request(`https://engageflow.test/api/automations/${draftId}`, {
      method: "DELETE",
      headers: { origin: "https://engageflow.test" },
    }),
    draftId
  );
  assert.equal(deleted.status, 200);
  assert.equal(rows.size, 0);
});

test("unauthenticated requests cannot list, load, save, edit, or delete drafts", async () => {
  const { api } = createTestApi(null);
  assert.equal((await api.list()).status, 401);
  assert.equal((await api.get(draftId)).status, 401);
  assert.equal((await api.save(mutationRequest(validInput))).status, 401);
  assert.equal((await api.save(mutationRequest(validInput), draftId)).status, 401);
  assert.equal(
    (
      await api.delete(
        new Request(`https://engageflow.test/api/automations/${draftId}`, {
          method: "DELETE",
          headers: { origin: "https://engageflow.test" },
        }),
        draftId
      )
    ).status,
    401
  );
});

test("invalid draft fields and unowned Instagram accounts are rejected", async () => {
  const { api } = createTestApi();
  assert.equal(
    (await api.save(mutationRequest({ ...validInput, mediaId: "../other" }))).status,
    400
  );
  assert.equal(
    (await api.save(mutationRequest({ ...validInput, keywords: [] }))).status,
    400
  );
  assert.equal(
    (
      await api.save(
        mutationRequest({
          ...validInput,
          accountId: "33333333-3333-4333-8333-333333333333",
        })
      )
    ).status,
    404
  );
});

test("draft migration enforces DRAFT-only writes and account ownership in RLS and RPC", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261111000002_comment_to_dm_drafts.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(migration, /status = 'DRAFT'/);
  assert.match(migration, /account\.owner_id = v_owner_id/);
  assert.match(migration, /SECURITY INVOKER/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO authenticated/);
});

test("child-table mutation policies require owner-owned DRAFT automations", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261111000003_automation_child_draft_only.sql",
      import.meta.url
    ),
    "utf8"
  );

  for (const table of ["automation_triggers", "automation_actions"]) {
    for (const operation of ["insert", "update", "delete"]) {
      const policy = migration.match(
        new RegExp(
          `CREATE POLICY "${table}_${operation}_own"[\\s\\S]*?;`
        )
      )?.[0];
      assert.ok(policy, `missing ${table} ${operation} policy`);
      assert.match(policy, /automation\.owner_id = \(SELECT auth\.uid\(\)\)/);
      assert.match(policy, /automation\.status = 'DRAFT'/);

      if (operation === "insert") {
        assert.match(policy, /WITH CHECK/);
      } else {
        assert.match(policy, /USING/);
      }
      if (operation === "update") {
        assert.match(policy, /USING[\s\S]*WITH CHECK/);
      }
    }
  }

  assert.doesNotMatch(
    migration,
    /DROP POLICY IF EXISTS "automation_(triggers|actions)_select_own"/
  );
});

test("Supabase draft repository uses the session client and owner-scoped account checks", () => {
  const repository = readFileSync(
    new URL("../src/lib/automations/supabase-drafts.ts", import.meta.url),
    "utf8"
  );
  const routes = readFileSync(
    new URL("../src/app/api/automations/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(repository, /\.eq\("owner_id", ownerId\)/);
  assert.match(repository, /\.eq\("connection_status", "CONNECTED"\)/);
  assert.match(repository, /save_comment_to_dm_draft/);
  assert.match(repository, /\.eq\("status", "DRAFT"\)/);
  assert.doesNotMatch(repository, /createAdminClient/);
  assert.match(routes, /supabase\.auth\.getUser\(\)/);
  assert.match(routes, /createClient\(\)/);
});
