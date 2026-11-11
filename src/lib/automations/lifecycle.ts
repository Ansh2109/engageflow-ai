import type {
  AutomationLifecycleAction,
  AutomationLifecycleEventAction,
  AutomationStatus,
} from "@/types/database";

export type AutomationLifecycleEvent = {
  id: string;
  action: AutomationLifecycleEventAction;
  previousStatus: AutomationStatus | null;
  newStatus: AutomationStatus;
  createdAt: string;
};

export type AutomationLifecycleHistory = {
  currentStatus: AutomationStatus;
  createdAt: string;
  events: AutomationLifecycleEvent[];
};

export type AutomationExecutionReadiness = {
  automationId: string;
  ready: boolean;
  blockers: string[];
};

export type AutomationLifecycleResult = {
  status: AutomationStatus;
  updatedAt: string;
};

export type AutomationLifecycleRequest = {
  action: AutomationLifecycleAction;
};

export type AutomationLifecycleTransitionResponse = {
  result: AutomationLifecycleResult;
};

export type AutomationExecutionReadinessResponse = {
  readiness: AutomationExecutionReadiness[];
};

export type AutomationLifecycleHistoryResponse = {
  history: AutomationLifecycleHistory;
};

export type AutomationLifecycleErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "INVALID_TRANSITION"
  | "EXECUTION_NOT_READY"
  | "ACCOUNT_NOT_CONNECTED"
  | "LIFECYCLE_UNAVAILABLE";

export type AutomationLifecycleErrorResponse = {
  error: AutomationLifecycleErrorCode;
  blockers?: string[];
};

type AutomationLifecycleRepository = {
  transition: (
    automationId: string,
    action: AutomationLifecycleAction
  ) => Promise<AutomationLifecycleResult>;
  history: (
    ownerId: string,
    automationId: string
  ) => Promise<AutomationLifecycleHistory | null>;
  readiness: () => Promise<AutomationExecutionReadiness[]>;
};

type AutomationLifecycleApiDependencies = {
  getUserId: () => Promise<string | null>;
  repository: AutomationLifecycleRepository;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set<AutomationLifecycleAction>([
  "ACTIVATE",
  "PAUSE",
  "RESUME",
]);
const BLOCKERS = new Set([
  "ACCOUNT_NOT_CONNECTED",
  "MISSING_META_PERMISSIONS",
  "INVALID_CONFIGURATION",
  "UNSUPPORTED_AUTOMATION_TYPE",
  "TARGET_MEDIA_NOT_VERIFIED",
  "WEBHOOK_NOT_VERIFIED",
  "EVENT_INGESTION_UNAVAILABLE",
  "EVENT_PROCESSOR_UNAVAILABLE",
  "MESSAGE_EXECUTOR_UNAVAILABLE",
  "RETRY_POLICY_UNVERIFIED",
  "IDEMPOTENCY_UNVERIFIED",
  "READINESS_NOT_VERIFIED",
  "RUNTIME_READINESS_UNAVAILABLE",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLifecycleRequest(value: unknown): value is AutomationLifecycleRequest {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    typeof value.action === "string" &&
    ACTIONS.has(value.action as AutomationLifecycleAction)
  );
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function pgErrorCode(error: unknown): string | null {
  if (!isRecord(error) || typeof error.code !== "string") return null;
  return error.code;
}

function pgErrorMessage(error: unknown): string | null {
  if (!isRecord(error) || typeof error.message !== "string") return null;
  return error.message;
}

function pgErrorDetails(error: unknown): string | null {
  if (!isRecord(error) || typeof error.details !== "string") return null;
  return error.details;
}

function safeBlockers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && BLOCKERS.has(item)
  );
}

function readinessBlockersFromError(error: unknown): string[] {
  const details = pgErrorDetails(error);
  if (!details) return [];
  try {
    return safeBlockers(JSON.parse(details));
  } catch {
    return [];
  }
}

async function authenticatedUser(
  getUserId: AutomationLifecycleApiDependencies["getUserId"]
): Promise<string | Response> {
  try {
    const userId = await getUserId();
    return userId || json({ error: "UNAUTHORIZED" }, 401);
  } catch {
    console.error("[Automations] Lifecycle authentication lookup failed.");
    return json({ error: "LIFECYCLE_UNAVAILABLE" }, 500);
  }
}

export function createAutomationLifecycleApi({
  getUserId,
  repository,
}: AutomationLifecycleApiDependencies) {
  return {
    async readiness(): Promise<Response> {
      const ownerId = await authenticatedUser(getUserId);
      if (ownerId instanceof Response) return ownerId;
      try {
        return json({ readiness: await repository.readiness() });
      } catch {
        console.error("[Automations] Lifecycle readiness lookup failed.");
        return json({ error: "LIFECYCLE_UNAVAILABLE" }, 503);
      }
    },

    async history(automationId: string): Promise<Response> {
      const ownerId = await authenticatedUser(getUserId);
      if (ownerId instanceof Response) return ownerId;
      if (!UUID_PATTERN.test(automationId)) {
        return json({ error: "NOT_FOUND" }, 404);
      }
      try {
        const history = await repository.history(ownerId, automationId);
        return history
          ? json({ history })
          : json({ error: "NOT_FOUND" }, 404);
      } catch {
        console.error("[Automations] Lifecycle history lookup failed.");
        return json({ error: "LIFECYCLE_UNAVAILABLE" }, 500);
      }
    },

    async transition(
      request: Request,
      automationId: string
    ): Promise<Response> {
      const ownerId = await authenticatedUser(getUserId);
      if (ownerId instanceof Response) return ownerId;
      if (!isSameOrigin(request)) return json({ error: "FORBIDDEN" }, 403);
      if (!UUID_PATTERN.test(automationId)) {
        return json({ error: "NOT_FOUND" }, 404);
      }

      let payload: unknown;
      try {
        const body = await request.text();
        if (body.length > 4_096) {
          return json({ error: "INVALID_REQUEST" }, 400);
        }
        payload = JSON.parse(body);
      } catch {
        return json({ error: "INVALID_REQUEST" }, 400);
      }

      if (!isLifecycleRequest(payload)) {
        return json({ error: "INVALID_REQUEST" }, 400);
      }

      const action = payload.action;
      try {
        const result = await repository.transition(automationId, action);
        return json({ result });
      } catch (error) {
        const code = pgErrorCode(error);
        const message = pgErrorMessage(error);
        if (code === "P0002") return json({ error: "NOT_FOUND" }, 404);
        if (code === "22023" && message === "INVALID_TRANSITION") {
          return json({ error: "INVALID_TRANSITION" }, 409);
        }
        if (code === "P0001" && message === "ACCOUNT_NOT_CONNECTED") {
          return json({ error: "ACCOUNT_NOT_CONNECTED" }, 409);
        }
        if (code === "P0001" && message === "EXECUTION_NOT_READY") {
          return json(
            {
              error: "EXECUTION_NOT_READY",
              blockers: readinessBlockersFromError(error),
            },
            409
          );
        }
        if (code === "42501") return json({ error: "UNAUTHORIZED" }, 401);
        console.error("[Automations] Lifecycle transition failed.");
        return json({ error: "LIFECYCLE_UNAVAILABLE" }, 500);
      }
    },
  };
}

export type { AutomationLifecycleRepository };
