import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createAutomationLifecycleApi,
  type AutomationLifecycleRepository,
} from "../src/lib/automations/lifecycle.ts";
import type { AutomationStatus } from "../src/types/database.ts";

const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const automationA = "11111111-1111-4111-8111-111111111111";

function lifecycleMigration(): string {
  return readFileSync(
    new URL(
      "../supabase/migrations/20261111000004_automation_lifecycle.sql",
      import.meta.url
    ),
    "utf8"
  );
}

type TestAutomation = {
  ownerId: string;
  status: AutomationStatus;
  connected: boolean;
  ready: boolean;
  events: number;
};

function pgError(code: string, message: string, details?: string): Error & {
  code: string;
  details?: string;
} {
  return Object.assign(new Error(message), { code, details });
}

function createHarness(initialUserId: string | null = ownerA) {
  let userId = initialUserId;
  const rows = new Map<string, TestAutomation>([
    [
      automationA,
      {
        ownerId: ownerA,
        status: "DRAFT",
        connected: true,
        ready: false,
        events: 0,
      },
    ],
  ]);
  const repository: AutomationLifecycleRepository = {
    async transition(id, action) {
      const row = rows.get(id);
      if (!row || row.ownerId !== userId) {
        throw pgError("P0002", "NOT_FOUND");
      }

      let nextStatus: AutomationStatus;
      if (action === "PAUSE" && row.status === "ACTIVE") {
        nextStatus = "PAUSED";
      } else if (action === "ACTIVATE" && row.status === "DRAFT") {
        nextStatus = "ACTIVE";
      } else if (action === "RESUME" && row.status === "PAUSED") {
        nextStatus = "ACTIVE";
      } else {
        throw pgError("22023", "INVALID_TRANSITION");
      }

      if (action !== "PAUSE") {
        if (!row.connected) {
          throw pgError("P0001", "ACCOUNT_NOT_CONNECTED");
        }
        if (!row.ready) {
          throw pgError(
            "P0001",
            "EXECUTION_NOT_READY",
            JSON.stringify(["WEBHOOK_NOT_VERIFIED", "MESSAGE_EXECUTOR_UNAVAILABLE"])
          );
        }
      }

      row.status = nextStatus;
      row.events += 1;
      return {
        status: nextStatus,
        updatedAt: "2026-11-11T00:00:00.000Z",
      };
    },
    async history(ownerId, id) {
      const row = rows.get(id);
      if (!row || row.ownerId !== ownerId) return null;
      return {
        currentStatus: row.status,
        createdAt: "2026-11-10T00:00:00.000Z",
        events: [],
      };
    },
    async readiness() {
      return [...rows.entries()]
        .filter(([, row]) => row.ownerId === userId)
        .map(([automationId, row]) => ({
          automationId,
          ready: row.ready,
          blockers: row.ready ? [] : ["WEBHOOK_NOT_VERIFIED"],
        }));
    },
  };
  const api = createAutomationLifecycleApi({
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

function request(body: string, origin = "https://app.example") {
  return new Request(`https://app.example/api/automations/${automationA}/lifecycle`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
    },
    body,
  });
}

test("lifecycle route rejects unauthenticated requests", async () => {
  const { api } = createHarness(null);
  assert.equal((await api.transition(request('{"action":"PAUSE"}'), automationA)).status, 401);
});

test("lifecycle route validates UUID, JSON, exact keys, and action", async () => {
  const { api } = createHarness();
  assert.equal((await api.transition(request('{"action":"PAUSE"}'), "bad-id")).status, 404);
  assert.equal((await api.transition(request("{"), automationA)).status, 400);
  assert.equal(
    (await api.transition(request('{"action":"PAUSE","ownerId":"other"}'), automationA)).status,
    400
  );
  assert.equal((await api.transition(request('{"action":"DELETE"}'), automationA)).status, 400);
});

test("lifecycle route requires same-origin mutation requests", async () => {
  const { api } = createHarness();
  assert.equal(
    (await api.transition(request('{"action":"PAUSE"}', "https://evil.example"), automationA)).status,
    403
  );
});

test("nonexistent and cross-tenant automations are hidden", async () => {
  const { api, setUserId } = createHarness();
  assert.equal(
    (await api.transition(request('{"action":"PAUSE"}'), "22222222-2222-4222-8222-222222222222"))
      .status,
    404
  );
  setUserId(ownerB);
  assert.equal((await api.transition(request('{"action":"PAUSE"}'), automationA)).status, 404);
  assert.equal((await api.history(automationA)).status, 404);
});

test("draft activation fails closed when execution readiness is not verified", async () => {
  const { api, rows } = createHarness();
  const response = await api.transition(request('{"action":"ACTIVATE"}'), automationA);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "EXECUTION_NOT_READY",
    blockers: ["WEBHOOK_NOT_VERIFIED", "MESSAGE_EXECUTOR_UNAVAILABLE"],
  });
  assert.equal(rows.get(automationA)?.status, "DRAFT");
});

test("draft activation succeeds only after readiness passes", async () => {
  const { api, rows } = createHarness();
  rows.get(automationA)!.ready = true;
  const response = await api.transition(request('{"action":"ACTIVATE"}'), automationA);
  assert.equal(response.status, 200);
  assert.equal(rows.get(automationA)?.status, "ACTIVE");
});

test("active automations can be paused without execution readiness", async () => {
  const { api, rows } = createHarness();
  const row = rows.get(automationA)!;
  row.status = "ACTIVE";
  row.ready = false;
  const response = await api.transition(request('{"action":"PAUSE"}'), automationA);
  assert.equal(response.status, 200);
  assert.equal(row.status, "PAUSED");
  assert.equal(row.events, 1);
});

test("paused automation resume fails closed or succeeds when ready", async () => {
  const { api, rows } = createHarness();
  const row = rows.get(automationA)!;
  row.status = "PAUSED";
  assert.equal(
    (await api.transition(request('{"action":"RESUME"}'), automationA)).status,
    409
  );
  assert.equal(row.status, "PAUSED");
  row.ready = true;
  assert.equal(
    (await api.transition(request('{"action":"RESUME"}'), automationA)).status,
    200
  );
  assert.equal(row.status, "ACTIVE");
});

test("disconnected account blocks activation and invalid state transitions fail", async () => {
  const { api, rows } = createHarness();
  const row = rows.get(automationA)!;
  row.ready = true;
  row.connected = false;
  const disconnected = await api.transition(
    request('{"action":"ACTIVATE"}'),
    automationA
  );
  assert.equal(disconnected.status, 409);
  assert.deepEqual(await disconnected.json(), { error: "ACCOUNT_NOT_CONNECTED" });

  row.connected = true;
  assert.equal(
    (await api.transition(request('{"action":"PAUSE"}'), automationA)).status,
    409
  );
  row.status = "PAUSED";
  assert.equal(
    (await api.transition(request('{"action":"ACTIVATE"}'), automationA)).status,
    409
  );
});

test("active and paused automations cannot be converted back to drafts", async () => {
  const { api, rows } = createHarness();
  const row = rows.get(automationA)!;
  row.status = "ACTIVE";
  assert.equal(
    (await api.transition(request('{"action":"DRAFT"}'), automationA)).status,
    400
  );
  assert.equal(row.status, "ACTIVE");
  row.status = "PAUSED";
  assert.equal(
    (await api.transition(request('{"action":"DRAFT"}'), automationA)).status,
    400
  );
  assert.equal(row.status, "PAUSED");
});

test("concurrent duplicate transitions serialize to one success and one conflict", async () => {
  const { api, rows } = createHarness();
  rows.get(automationA)!.ready = true;
  const results = await Promise.all([
    api.transition(request('{"action":"ACTIVATE"}'), automationA),
    api.transition(request('{"action":"ACTIVATE"}'), automationA),
  ]);
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);
  assert.equal(rows.get(automationA)?.status, "ACTIVE");
  assert.equal(rows.get(automationA)?.events, 1);
});

test("readiness and lifecycle history are authenticated and owner-scoped", async () => {
  const { api, setUserId } = createHarness();
  const readiness = await api.readiness();
  assert.equal(readiness.status, 200);
  assert.deepEqual(await readiness.json(), {
    readiness: [
      {
        automationId: automationA,
        ready: false,
        blockers: ["WEBHOOK_NOT_VERIFIED"],
      },
    ],
  });
  assert.equal((await api.history(automationA)).status, 200);
  setUserId(null);
  assert.equal((await api.readiness()).status, 401);
  assert.equal((await api.history(automationA)).status, 401);
});

test("migration locks transitions, checks ownership and readiness, and keeps audit append-only", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261111000004_automation_lifecycle.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /FOR SHARE/);
  assert.match(migration, /automation\.owner_id = v_owner_id/);
  assert.match(migration, /p_action = 'ACTIVATE' AND v_current_status = 'DRAFT'/);
  assert.match(migration, /p_action = 'PAUSE' AND v_current_status = 'ACTIVE'/);
  assert.match(migration, /p_action = 'RESUME' AND v_current_status = 'PAUSED'/);
  assert.match(migration, /webhook_verified BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /message_executor_operational BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /retry_policy_verified BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /idempotency_verified BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /validation\.media_id = v_automation\.target_post_id/);
  assert.match(migration, /validation\.media_type = v_automation\.target_media_type/);
  assert.match(migration, /validation\.valid_until > pg_catalog\.clock_timestamp\(\)/);
  assert.match(migration, /MISSING_META_PERMISSIONS/);
  assert.match(migration, /v_blockers @> ARRAY\['ACCOUNT_NOT_CONNECTED'\]/);
  assert.match(migration, /MESSAGE = 'EXECUTION_NOT_READY'/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.transition_automation_lifecycle/);
  assert.match(migration, /FROM PUBLIC, anon/);
  assert.match(migration, /automation_lifecycle_created_event/);
  assert.match(migration, /automation_lifecycle_status_event/);
  assert.match(migration, /'BASELINE'/);
  assert.match(migration, /automation_status_trigger/);
  assert.match(migration, /automation\.automation_type/);
  assert.doesNotMatch(migration, /automation\.type\b/);
  assert.match(migration, /v_action_message IS NULL/);
  assert.match(migration, /pg_catalog\.btrim\(v_action_message\) = ''/);
  assert.match(migration, /v_public_reply IS NOT NULL/);
  assert.match(migration, /pg_catalog\.btrim\(v_public_reply\) = ''/);
  assert.match(migration, /instagram_business_basic/);
  assert.match(migration, /instagram_business_manage_messages/);
  assert.match(migration, /instagram_business_manage_comments/);
  assert.match(migration, /instagram_basic/);
  assert.match(migration, /instagram_manage_messages/);
  assert.match(migration, /instagram_manage_comments/);
  assert.match(migration, /automation_status_transition_guard/);
  assert.match(migration, /LIFECYCLE_TRANSITION_REQUIRED/);
  assert.match(migration, /automation_lifecycle_transition_permits/);
  assert.match(migration, /INSERT INTO public\.automation_lifecycle_transition_permits/);
  assert.match(migration, /OLD\.status IS DISTINCT FROM NEW\.status/);
  assert.match(migration, /permit\.previous_status = OLD\.status/);
  assert.match(migration, /permit\.target_status = NEW\.status/);
  assert.match(migration, /permit\.action = 'ACTIVATE' AND OLD\.status = 'DRAFT' AND NEW\.status = 'ACTIVE'/);
  assert.match(migration, /permit\.action = 'PAUSE' AND OLD\.status = 'ACTIVE' AND NEW\.status = 'PAUSED'/);
  assert.match(migration, /permit\.action = 'RESUME' AND OLD\.status = 'PAUSED' AND NEW\.status = 'ACTIVE'/);
  assert.match(migration, /DELETE FROM public\.automation_lifecycle_transition_permits/);
  assert.match(migration, /LIFECYCLE_TRANSITION_PERMIT_NOT_CONSUMED/);
  assert.match(migration, /IF NEW\.status <> 'DRAFT' THEN/);
  assert.match(migration, /target_status TEXT NOT NULL[\s\S]*CHECK \(target_status IN \('ACTIVE', 'PAUSED'\)\)/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.automation_lifecycle_transition_permits[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /BEFORE INSERT OR UPDATE ON public\.automations/);
  assert.match(migration, /pause_automations_after_account_disconnect/);
  assert.match(migration, /transition_automation_lifecycle\(v_automation_id, 'PAUSE'\)/);
  assert.match(migration, /p_action <> 'PAUSE'/);
  assert.match(migration, /account\.connection_status = 'CONNECTED'/);
  assert.match(migration, /SELECT account\.id[\s\S]*FOR SHARE/);
  assert.match(migration, /AUTOMATION_ACCOUNT_CHANGED/);
  assert.match(migration, /SET search_path = ''\s+SET row_security = off/);
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.automation_lifecycle_events[\s\S]*FROM PUBLIC, anon, authenticated, service_role;/
  );
  assert.match(
    migration,
    /GRANT SELECT ON TABLE public\.automation_lifecycle_events TO authenticated;/
  );
  assert.match(
    migration,
    /CREATE POLICY automation_lifecycle_events_select_own[\s\S]*auth\.uid\(\).*owner_id/
  );
  assert.doesNotMatch(
    migration,
    /GRANT\s+(?:ALL|INSERT|UPDATE|DELETE)[\s\S]*ON TABLE public\.automation_lifecycle_events TO authenticated/i
  );

  const initialSchema = readFileSync(
    new URL("../supabase/migrations/20261109000001_initial_schema.sql", import.meta.url),
    "utf8"
  );
  const databaseTypes = readFileSync(
    new URL("../src/types/database.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    initialSchema,
    /CREATE TABLE IF NOT EXISTS public\.automations[\s\S]*?automation_type TEXT NOT NULL/
  );
  assert.match(databaseTypes, /automation_type: AutomationType/);
  assert.match(initialSchema, /public\.instagram_account_tokens/);
  assert.match(initialSchema, /public\.instagram_accounts/);
  assert.match(initialSchema, /public\.automation_triggers/);
  assert.match(initialSchema, /public\.automation_actions/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.automation_runtime_readiness[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.doesNotMatch(
    migration,
    /GRANT\s+(?:ALL|INSERT|UPDATE|DELETE)[\s\S]*ON TABLE public\.automation_runtime_readiness TO service_role/i
  );

  const draftMigration = readFileSync(
    new URL("../supabase/migrations/20261111000002_comment_to_dm_drafts.sql", import.meta.url),
    "utf8"
  );
  assert.match(draftMigration, /status = 'DRAFT'/);
  assert.match(draftMigration, /DELETE FROM public\.automation_triggers/);
  assert.match(draftMigration, /DELETE FROM public\.automation_actions/);
  assert.match(draftMigration, /WHERE id = p_automation_id[\s\S]*AND status = 'DRAFT'/);
});

test("the database guard denies every direct status change regardless of caller role", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261111000004_automation_lifecycle.sql",
      import.meta.url
    ),
    "utf8"
  );
  const guardStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.guard_automation_status_transition"
  );
  const guard = migration.slice(
    guardStart,
    migration.indexOf(
      "REVOKE ALL ON FUNCTION public.guard_automation_status_transition",
      guardStart
    )
  );
  assert.match(guard, /IF OLD\.status IS DISTINCT FROM NEW\.status THEN/);
  assert.match(guard, /DELETE FROM public\.automation_lifecycle_transition_permits/);
  assert.match(guard, /IF NOT COALESCE\(v_permitted, FALSE\) THEN/);
  assert.match(guard, /MESSAGE = 'LIFECYCLE_TRANSITION_REQUIRED'/);
  assert.doesNotMatch(guard, /auth\.role\(\)|service_role/);
  assert.doesNotMatch(guard, /session_replication_role|DISABLE TRIGGER/);
  assert.match(
    migration,
    /CREATE TRIGGER automation_status_transition_guard[\s\S]*BEFORE INSERT OR UPDATE ON public\.automations/
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.transition_automation_lifecycle\(UUID, TEXT\)[\s\S]*TO authenticated, service_role/
  );
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.automation_lifecycle_transition_permits[\s\S]*FROM PUBLIC, anon, authenticated, service_role/
  );
});

test("readiness accepts connected Unified Login scopes with NULL expiry", () => {
  const migration = lifecycleMigration();
  const unifiedLoginBranch = migration.slice(
    migration.indexOf(
      "FROM public.instagram_unified_login_connections AS connection"
    ),
    migration.indexOf("UNION", migration.indexOf(
      "FROM public.instagram_unified_login_connections AS connection"
    ))
  );

  assert.match(unifiedLoginBranch, /connection\.id = v_account\.unified_connection_id/);
  assert.match(unifiedLoginBranch, /connection\.owner_id = v_owner_id/);
  assert.match(unifiedLoginBranch, /connection\.connection_status = 'CONNECTED'/);
  assert.match(
    unifiedLoginBranch,
    /connection\.token_expires_at IS NULL\s+OR connection\.token_expires_at > pg_catalog\.clock_timestamp\(\)/
  );
});

test("readiness excludes expired tokens but allows only NULL or future expiry", () => {
  const migration = lifecycleMigration();
  for (const predicate of [
    /connection\.token_expires_at IS NULL\s+OR connection\.token_expires_at > pg_catalog\.clock_timestamp\(\)/g,
    /token\.token_expires_at IS NULL\s+OR token\.token_expires_at > pg_catalog\.clock_timestamp\(\)/g,
  ]) {
    const matches = migration.match(predicate) ?? [];
    assert.ok(matches.length > 0);
  }
  assert.doesNotMatch(
    migration,
    /(?:connection|token)\.token_expires_at > pg_catalog\.clock_timestamp\(\)\s+UNION/
  );
});

test("disconnected or revoked connection records cannot supply readiness scopes", () => {
  const migration = lifecycleMigration();
  const unifiedLoginBranch = migration.slice(
    migration.indexOf(
      "FROM public.instagram_unified_login_connections AS connection"
    ),
    migration.indexOf("UNION", migration.indexOf(
      "FROM public.instagram_unified_login_connections AS connection"
    ))
  );
  assert.match(unifiedLoginBranch, /connection\.connection_status = 'CONNECTED'/);
  assert.match(
    migration,
    /ELSIF v_account\.connection_status <> 'CONNECTED' THEN[\s\S]*'ACCOUNT_NOT_CONNECTED'/
  );
  assert.doesNotMatch(unifiedLoginBranch, /connection_status <> 'CONNECTED'/);
});

test("missing required Instagram scopes continue to block readiness", () => {
  const migration = lifecycleMigration();
  assert.match(migration, /v_scopes @> ARRAY\['instagram_basic'\]/);
  assert.match(migration, /v_scopes @> ARRAY\['instagram_manage_messages'\]/);
  assert.match(migration, /v_scopes @> ARRAY\['instagram_manage_comments'\]/);
  assert.match(migration, /MISSING_META_PERMISSIONS/);
});

test("media verification route persists evidence only after server-side Meta verification", () => {
  const route = readFileSync(
    new URL(
    "../src/app/api/automations/[id]/media-validation/route.ts",
    import.meta.url
    ),
    "utf8"
  );
  const verification = route.indexOf("verifyInstagramMedia(");
  const persistence = route.indexOf(".upsert(");
  assert.ok(verification >= 0);
  assert.ok(persistence > verification);
  assert.match(route, /\.eq\("owner_id", ownerId\)/);
  assert.match(route, /\.eq\("status", "DRAFT"\)/);
  assert.match(route, /\.eq\("automation_type", "COMMENT_TO_DM"\)/);
  assert.match(route, /createAdminClient\(\)/);
});

test("lifecycle UI blocks unready activation, confirms transitions, and exposes history", () => {
  const component = readFileSync(
    new URL(
      "../src/app/(dashboard)/automations/automation-list.tsx",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(component, /readinessBlocked/);
  assert.match(component, /disabled=\{[\s\S]*readinessBlocked/);
  assert.match(component, /showModal\(\)/);
  assert.match(component, /Activate/);
  assert.match(component, /Pause/);
  assert.match(component, /Resume/);
  assert.match(component, /History/);
  assert.match(component, /No lifecycle events were recorded/);
  assert.match(component, /do not assume messages are executing/);
});
