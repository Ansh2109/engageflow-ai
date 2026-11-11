"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Clock3,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Zap,
} from "lucide-react";
import type {
  AutomationLifecycleAction,
} from "@/types/database";
import type { AutomationListItem } from "@/lib/automations/drafts";
import type {
  AutomationExecutionReadiness,
  AutomationLifecycleErrorResponse,
  AutomationLifecycleHistory,
  AutomationLifecycleRequest,
  AutomationLifecycleTransitionResponse,
} from "@/lib/automations/lifecycle";

function automationTypeLabel(type: AutomationListItem["automationType"]): string {
  return type === "COMMENT_TO_DM" ? "Comment-to-DM" : "DM keyword reply";
}

function statusLabel(status: AutomationListItem["status"]): string {
  if (status === "DRAFT") return "Draft";
  if (status === "PAUSED") return "Paused";
  return "Active";
}

function lifecycleActionLabel(action: string, newStatus: string): string {
  if (action === "CREATED") {
    return newStatus === "DRAFT" ? "Created as draft" : "Created";
  }
  if (action === "BASELINE") return "Status recorded when tracking began";
  if (action === "ACTIVATED") return "Activated";
  if (action === "PAUSED") return "Paused";
  if (action === "RESUMED") return "Resumed";
  return "Status changed";
}

function blockerMessage(blockers: string[]): string {
  const messages: Record<string, string> = {
    ACCOUNT_NOT_CONNECTED: "The Instagram account is no longer connected.",
    MISSING_META_PERMISSIONS: "Required Instagram permissions are unavailable.",
    INVALID_CONFIGURATION: "The automation configuration needs attention.",
    UNSUPPORTED_AUTOMATION_TYPE: "This automation type is not supported yet.",
    TARGET_MEDIA_NOT_VERIFIED: "The selected Instagram media has not been verified recently.",
    WEBHOOK_NOT_VERIFIED: "Instagram webhook subscription is not verified.",
    EVENT_INGESTION_UNAVAILABLE: "Webhook event ingestion is not operational.",
    EVENT_PROCESSOR_UNAVAILABLE: "The automation event processor is not operational.",
    MESSAGE_EXECUTOR_UNAVAILABLE: "The message execution service is not operational.",
    RETRY_POLICY_UNVERIFIED: "Safe message retry behavior is not verified.",
    IDEMPOTENCY_UNVERIFIED: "Duplicate-event protection is not verified.",
    READINESS_NOT_VERIFIED: "Execution readiness has not been recently verified.",
    RUNTIME_READINESS_UNAVAILABLE: "Execution readiness could not be verified.",
  };
  const details = blockers.map((blocker) => messages[blocker]).filter(Boolean);
  return details.length
    ? details.join(" ")
    : "Execution is not ready. No messages will be sent.";
}

function updatedLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

export function AutomationList() {
  const [automations, setAutomations] = useState<AutomationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [readinessById, setReadinessById] = useState<
    Record<string, AutomationExecutionReadiness>
  >({});
  const [readinessError, setReadinessError] = useState(false);
  const [pendingTransition, setPendingTransition] = useState<{
    id: string;
    action: AutomationLifecycleAction;
  } | null>(null);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<AutomationLifecycleHistory | null>(null);
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const executionReadyForAll =
    automations.length > 0 &&
    automations.every((automation) => readinessById[automation.id]?.ready === true);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/automations", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          automations?: AutomationListItem[];
        };
        if (!response.ok || !Array.isArray(body.automations)) {
          setError("Automations could not be loaded. Please try again.");
          return;
        }
        setAutomations(body.automations);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("Automations could not be reached. Please try again.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/automations/readiness", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          readiness?: AutomationExecutionReadiness[];
        };
        if (
          !response.ok ||
          !Array.isArray(body.readiness) ||
          controller.signal.aborted
        ) {
          setReadinessError(true);
          return;
        }
        setReadinessById(
          Object.fromEntries(
            body.readiness.map((item) => [item.automationId, item])
          )
        );
        setReadinessError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setReadinessError(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (pendingTransition && dialog && !dialog.open) {
      dialog.showModal();
    } else if (!pendingTransition && dialog?.open) {
      dialog.close();
    }
  }, [pendingTransition]);

  const refreshAutomations = async () => {
    const response = await fetch("/api/automations", { cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as {
      automations?: AutomationListItem[];
    };
    if (!response.ok || !Array.isArray(body.automations)) {
      throw new Error("Automations could not be refreshed.");
    }
    setAutomations(body.automations);
  };

  const refreshReadiness = async () => {
    const response = await fetch("/api/automations/readiness", {
      cache: "no-store",
    });
    const body = (await response.json().catch(() => ({}))) as {
      readiness?: AutomationExecutionReadiness[];
    };
    if (!response.ok || !Array.isArray(body.readiness)) {
      setReadinessError(true);
      return;
    }
    setReadinessById(
      Object.fromEntries(
        body.readiness.map((item) => [item.automationId, item])
      )
    );
    setReadinessError(false);
  };

  const deleteDraft = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      const response = await fetch(`/api/automations/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(
          response.status === 404
            ? "This draft is no longer available."
            : "Draft could not be deleted. Please try again."
        );
        return;
      }
      setAutomations((current) => current.filter((automation) => automation.id !== id));
      setPendingDeleteId(null);
    } catch {
      setError("Draft could not be reached. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  const transitionAutomation = async () => {
    if (!pendingTransition) return;
    const { id, action } = pendingTransition;
    setTransitioningId(id);
    setTransitionError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/automations/${id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action } satisfies AutomationLifecycleRequest),
      });
      const body = (await response.json().catch(() => ({}))) as
        Partial<AutomationLifecycleErrorResponse> &
          Partial<AutomationLifecycleTransitionResponse>;
      if (!response.ok) {
        setTransitionError(
          body.error === "EXECUTION_NOT_READY"
            ? blockerMessage(body.blockers ?? [])
            : body.error === "ACCOUNT_NOT_CONNECTED"
              ? "Reconnect the Instagram account before activating or resuming."
              : body.error === "INVALID_TRANSITION"
                ? "This automation changed state. Refresh and try again."
                : "The lifecycle change could not be completed."
        );
        return;
      }

      setPendingTransition(null);
      setSuccess(
        action === "PAUSE"
          ? "Automation paused."
          : "Status changed after the server verified execution readiness."
      );
      try {
        await refreshAutomations();
      } catch {
        setError("The status changed, but the automation list could not be refreshed.");
      }
      try {
        await refreshReadiness();
      } catch {
        setReadinessError(true);
      }
    } catch {
      setTransitionError("The lifecycle service could not be reached.");
    } finally {
      setTransitioningId(null);
    }
  };

  const toggleHistory = async (id: string) => {
    if (historyId === id) {
      setHistoryId(null);
      setHistory(null);
      return;
    }
    setHistoryId(id);
    setHistory(null);
    setHistoryError(null);
    setHistoryLoadingId(id);
    try {
      const response = await fetch(`/api/automations/${id}/lifecycle`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as {
        history?: AutomationLifecycleHistory;
      };
      if (!response.ok || !body.history) {
        setHistoryError("Lifecycle history could not be loaded.");
        return;
      }
      setHistory(body.history);
    } catch {
      setHistoryError("Lifecycle history could not be reached.");
    } finally {
      setHistoryLoadingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold">Automations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your Instagram automation drafts.
          </p>
        </div>
        <Link
          href="/automations/new"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <Plus className="h-4 w-4" />
          New automation
        </Link>
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-900 dark:text-amber-100">
        {executionReadyForAll
          ? "Readiness checks pass for the displayed automations. An Active status alone does not confirm that any message was delivered."
          : "Activation and resume are blocked until the server verifies the connected account, permissions, configuration, webhook, processor, message service, retry policy, and idempotency safeguards. Pausing an existing active status remains available."}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="rounded-lg bg-primary/10 p-3 text-sm text-primary">
          {success}
        </p>
      )}
      {transitionError && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {transitionError}
        </p>
      )}
      {readinessError && (
        <p role="status" className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-900 dark:text-amber-100">
          Execution readiness could not be verified. Activate and resume actions are blocked.
        </p>
      )}

      {loading ? (
        <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Loading automations...
        </div>
      ) : automations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-4 py-20 text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Zap className="h-7 w-7 text-muted-foreground" />
          </div>
          <h2 className="mb-2 text-lg font-semibold">No automations yet</h2>
          <p className="mb-6 max-w-sm text-sm text-muted-foreground">
            Create a Comment-to-DM draft. It will not run or send messages.
          </p>
          <Link
            href="/automations/new"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Create draft
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="divide-y divide-border">
            {automations.map((automation) => {
              const isDraft = automation.status === "DRAFT";
              const isActive = automation.status === "ACTIVE";
              const isPaused = automation.status === "PAUSED";
              const canEdit =
                isDraft && automation.automationType === "COMMENT_TO_DM";
              const readiness = readinessById[automation.id];
              const readinessBlocked =
                readinessError || readiness?.ready !== true;
              return (
                <article
                  key={automation.id}
                  className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
                >
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{automation.name}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {automationTypeLabel(automation.automationType)} ·{" "}
                      {automation.accountUsername
                        ? `@${automation.accountUsername}`
                        : automation.accountName}
                    </p>
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={
                          automation.status === "DRAFT"
                            ? "rounded-full border border-slate-400/30 bg-slate-500/10 px-2 py-0.5 font-medium text-slate-700 dark:text-slate-200"
                            : automation.status === "ACTIVE"
                              ? "rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300"
                              : "rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-800 dark:text-amber-200"
                        }
                      >
                        {statusLabel(automation.status)}
                      </span>
                      <span className="text-muted-foreground">
                        Updated {updatedLabel(automation.updatedAt)}
                      </span>
                    </p>
                    {isActive && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        Stored as Active; do not assume messages are executing.
                      </p>
                    )}
                    {(isDraft || isPaused) && readinessBlocked && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        {readinessError
                          ? "Activation/resume blocked: readiness could not be verified."
                          : `Activation/resume blocked: ${blockerMessage(readiness?.blockers ?? [])}`}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {canEdit && (
                      <Link
                        href={`/automations/new?type=comment_to_dm&draftId=${encodeURIComponent(automation.id)}`}
                        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <Pencil className="h-4 w-4" />
                        Edit
                      </Link>
                    )}
                    {isDraft &&
                      (pendingDeleteId === automation.id ? (
                        <>
                          <button
                            type="button"
                            disabled={deletingId === automation.id}
                            onClick={() => void deleteDraft(automation.id)}
                            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-destructive px-3 text-sm font-medium text-destructive-foreground disabled:opacity-60"
                          >
                            {deletingId === automation.id ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                            Confirm delete
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === automation.id}
                            onClick={() => setPendingDeleteId(null)}
                            className="inline-flex min-h-10 items-center rounded-lg border border-border px-3 text-sm hover:bg-muted"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(automation.id)}
                          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:border-destructive/50 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </button>
                      ))}
                    {(isDraft || isActive || isPaused) && (
                      <button
                        type="button"
                        disabled={
                          transitioningId !== null ||
                          ((isDraft || isPaused) && readinessBlocked)
                        }
                        title={
                          (isDraft || isPaused) && readinessBlocked
                            ? readinessError
                              ? "Execution readiness could not be verified"
                              : blockerMessage(readiness?.blockers ?? [])
                            : undefined
                        }
                        onClick={() => {
                          const action: AutomationLifecycleAction = isActive
                            ? "PAUSE"
                            : isPaused
                              ? "RESUME"
                              : "ACTIVATE";
                          setTransitionError(null);
                          setPendingTransition({ id: automation.id, action });
                        }}
                        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {transitioningId === automation.id ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : isActive ? (
                          <Pause className="h-4 w-4" />
                        ) : isPaused ? (
                          <RotateCcw className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                        {isActive ? "Pause" : isPaused ? "Resume" : "Activate"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void toggleHistory(automation.id)}
                      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      aria-expanded={historyId === automation.id}
                    >
                      {historyLoadingId === automation.id ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <Clock3 className="h-4 w-4" />
                      )}
                      History
                    </button>
                  </div>
                  {historyId === automation.id && (
                    <div className="basis-full rounded-lg border border-border bg-muted/30 p-4 text-sm">
                      <h3 className="font-semibold">Lifecycle history</h3>
                      {historyError ? (
                        <p role="alert" className="mt-2 text-destructive">
                          {historyError}
                        </p>
                      ) : historyLoadingId === automation.id ? (
                        <p role="status" className="mt-2 text-muted-foreground">
                          Loading history...
                        </p>
                      ) : history?.events.length ? (
                        <ol className="mt-3 space-y-2">
                          {history.events.map((event) => (
                            <li key={event.id} className="flex flex-wrap justify-between gap-2">
                              <span>
                                {lifecycleActionLabel(event.action, event.newStatus)}:{" "}
                                {event.previousStatus
                                  ? `${event.previousStatus} → ${event.newStatus}`
                                  : event.newStatus}
                              </span>
                              <time dateTime={event.createdAt} className="text-muted-foreground">
                                {updatedLabel(event.createdAt)}
                              </time>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="mt-2 text-muted-foreground">
                          No lifecycle events were recorded for this automation.
                        </p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}
      {pendingTransition && (
        <dialog
          ref={dialogRef}
          aria-labelledby="lifecycle-dialog-title"
          aria-describedby="lifecycle-dialog-description"
          onCancel={() => setPendingTransition(null)}
          onClose={() => {
            if (pendingTransition) setPendingTransition(null);
          }}
          className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/60"
        >
          <div className="space-y-4 p-6">
            <h2 id="lifecycle-dialog-title" className="text-lg font-semibold">
              Confirm {pendingTransition.action.toLowerCase()}
            </h2>
            <p id="lifecycle-dialog-description" className="text-sm text-muted-foreground">
              {pendingTransition.action === "PAUSE"
                ? "Pause this automation? The status will change to Paused."
                : "Activation and resume require verified execution readiness. No status change occurs unless the server confirms every prerequisite."}
            </p>
            {transitionError && (
              <p role="alert" className="text-sm text-destructive">
                {transitionError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={transitioningId !== null}
                onClick={() => setPendingTransition(null)}
                className="inline-flex min-h-10 items-center rounded-lg border border-border px-4 text-sm hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={transitioningId !== null}
                onClick={() => void transitionAutomation()}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {transitioningId && <LoaderCircle className="h-4 w-4 animate-spin" />}
                Confirm
              </button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}
