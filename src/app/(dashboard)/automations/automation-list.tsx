"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoaderCircle, Pencil, Plus, Trash2, Zap } from "lucide-react";
import type { AutomationListItem } from "@/lib/automations/drafts";

function automationTypeLabel(type: AutomationListItem["automationType"]): string {
  return type === "COMMENT_TO_DM" ? "Comment-to-DM" : "DM keyword reply";
}

function statusLabel(status: AutomationListItem["status"]): string {
  if (status === "DRAFT") return "Draft";
  if (status === "PAUSED") return "Paused - not executing";
  return "Not active - legacy status";
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
        Drafts are stored for editing only. Automation execution and activation are not implemented.
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
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
              const canEdit =
                isDraft && automation.automationType === "COMMENT_TO_DM";
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
                    <p className="mt-1 text-xs text-muted-foreground">
                      {statusLabel(automation.status)} · Updated{" "}
                      {updatedLabel(automation.updatedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
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
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
