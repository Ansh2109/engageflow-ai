"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleHelp,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Save,
  Send,
  Sparkles,
  WandSparkles,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { MediaPaginationRequestGuard } from "@/lib/instagram/media-pagination-request";

type ConnectedInstagramAccount = {
  id: string;
  username: string;
  name: string | null;
  profile_picture_url: string | null;
};

type InstagramMedia = {
  id: string;
  caption: string | null;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  mediaUrl: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  timestamp: string;
};

type MediaResponse = {
  media: InstagramMedia[];
  nextCursor: string | null;
};

type CommentToDmBuilderProps = {
  accounts: ConnectedInstagramAccount[];
};

type MatchMode = "exact" | "contains";

const INITIAL_DM =
  "Hey {{username}}! Thanks for commenting. Here's the info you asked for.";
const INITIAL_PUBLIC_REPLY = "Just sent you a message!";

function messageWithSampleValues(message: string): string {
  return message
    .replaceAll("{{username}}", "@jordan")
    .replaceAll("{{first_name}}", "Jordan")
    .replaceAll("{{account_name}}", "EngageFlow");
}

function MediaThumbnail({
  media,
  className,
}: {
  media: InstagramMedia;
  className: string;
}) {
  const src = media.thumbnailUrl ?? media.mediaUrl;
  if (!src) {
    return (
      <div
        className={`${className} flex items-center justify-center bg-slate-800 text-slate-500`}
        aria-hidden="true"
      >
        {media.mediaType === "IMAGE" ? (
          <ImageIcon className="h-5 w-5" />
        ) : (
          <Film className="h-5 w-5" />
        )}
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <Image
        src={src}
        alt="Preview of the selected Instagram media"
        fill
        unoptimized
        sizes="(max-width: 640px) 45vw, 180px"
        className="object-cover"
      />
      {media.mediaType !== "IMAGE" && (
        <span className="absolute right-2 top-2 rounded-full bg-black/65 p-1.5 text-white">
          <Film className="h-3.5 w-3.5" aria-label="Video or Reel" />
        </span>
      )}
    </div>
  );
}

export function CommentToDmBuilder({
  accounts,
}: CommentToDmBuilderProps) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [media, setMedia] = useState<InstagramMedia[]>([]);
  const [selectedMediaId, setSelectedMediaId] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMedia, setLoadingMedia] = useState(Boolean(accounts[0]?.id));
  const [loadingMore, setLoadingMore] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [automationName, setAutomationName] = useState(
    "Comment-to-DM | New automation"
  );
  const [matchMode, setMatchMode] = useState<MatchMode>("contains");
  const [keywords, setKeywords] = useState("");
  const [dmMessage, setDmMessage] = useState(INITIAL_DM);
  const [publicReplyEnabled, setPublicReplyEnabled] = useState(false);
  const [publicReply, setPublicReply] = useState(INITIAL_PUBLIC_REPLY);
  const [notice, setNotice] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const requestId = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const paginationGuard = useRef(new MediaPaginationRequestGuard());

  const selectedAccount = accounts.find(({ id }) => id === accountId);
  const selectedMedia = media.find(({ id }) => id === selectedMediaId);
  const keywordList = useMemo(
    () =>
      keywords
        .split(/[,\n]/)
        .map((keyword) => keyword.trim())
        .filter(Boolean),
    [keywords]
  );

  useEffect(() => {
    requestId.current += 1;
    const request = requestId.current;
    const controller = new AbortController();
    requestController.current = controller;

    if (!accountId) {
      return () => controller.abort();
    }

    const query = new URLSearchParams({ accountId });
    void fetch(`/api/instagram/media?${query}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as
          | MediaResponse
          | { error?: string };
        if (request !== requestId.current) return;
        if (!response.ok || !("media" in body) || !Array.isArray(body.media)) {
          setMediaError(
            "Instagram media could not be loaded. Confirm this account is connected with Unified Login and try again."
          );
          return;
        }
        setMedia(body.media);
        setSelectedMediaId(body.media[0]?.id ?? "");
        setNextCursor(body.nextCursor ?? null);
      })
      .catch(() => {
        if (request === requestId.current && !controller.signal.aborted) {
          setMediaError("Instagram media could not be reached. Please try again.");
        }
      })
      .finally(() => {
        if (request === requestId.current) setLoadingMedia(false);
      });

    return () => {
      controller.abort();
      if (requestController.current === controller) {
        requestController.current = null;
      }
    };
  }, [accountId]);

  useEffect(
    () => () => {
      paginationGuard.current.reset();
    },
    []
  );

  const loadMore = useCallback(async () => {
    if (!accountId || !nextCursor || !requestController.current) {
      return;
    }

    const request = paginationGuard.current.begin();
    if (!request) return;
    const accountRequestId = requestId.current;
    setLoadingMore(true);
    setMediaError(null);
    try {
      const query = new URLSearchParams({ accountId, after: nextCursor });
      const response = await fetch(`/api/instagram/media?${query}`, {
        cache: "no-store",
        signal: request.controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as
        | MediaResponse
        | { error?: string };
      if (
        accountRequestId !== requestId.current ||
        !paginationGuard.current.isCurrent(request)
      ) {
        return;
      }
      if (!response.ok || !("media" in body) || !Array.isArray(body.media)) {
        setMediaError("More Instagram posts could not be loaded.");
        return;
      }
      setMedia((current) => {
        const seen = new Set(current.map(({ id }) => id));
        return [
          ...current,
          ...body.media.filter((item) => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          }),
        ];
      });
      setNextCursor(body.nextCursor ?? null);
    } catch {
      if (
        accountRequestId === requestId.current &&
        paginationGuard.current.isCurrent(request)
      ) {
        setMediaError("More Instagram posts could not be reached.");
      }
    } finally {
      if (paginationGuard.current.finish(request)) setLoadingMore(false);
    }
  }, [accountId, nextCursor]);

  const insertPlaceholder = (placeholder: string) => {
    setDmMessage((current) => `${current}${placeholder}`);
  };

  const handleAccountChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextAccountId = event.target.value;
    requestId.current += 1;
    requestController.current?.abort();
    requestController.current = null;
    paginationGuard.current.reset();
    setLoadingMore(false);
    setMedia([]);
    setSelectedMediaId("");
    setNextCursor(null);
    setMediaError(null);
    setLoadingMedia(Boolean(nextAccountId));
    setAccountId(nextAccountId);
  };

  const previewMessage = messageWithSampleValues(dmMessage);
  const previewReply = messageWithSampleValues(publicReply);

  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b0d19] text-slate-100 shadow-2xl shadow-slate-950/20">
      <header className="flex flex-col gap-4 border-b border-white/10 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/automations/new"
            aria-label="Back to automation types"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 text-slate-300 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <label htmlFor="automation-name" className="sr-only">
              Automation name
            </label>
            <input
              id="automation-name"
              value={automationName}
              onChange={(event) => setAutomationName(event.target.value)}
              className="w-full max-w-[340px] truncate rounded-md border border-transparent bg-transparent px-1 py-1 text-base font-semibold text-white outline-none transition focus:border-violet-400/50 focus:bg-white/5 sm:text-lg"
            />
            <p className="px-1 text-xs text-slate-400">Visual builder - Draft preview</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 px-3 text-sm font-medium text-slate-200 transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <WandSparkles className="h-4 w-4 text-violet-300" />
            Advanced Editor
          </button>
          <button
            type="button"
            onClick={() =>
              setNotice("Backend integration pending. This draft was not saved.")
            }
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 px-3 text-sm font-medium text-slate-200 transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <Save className="h-4 w-4" />
            Save Draft
          </button>
          <button
            type="button"
            onClick={() =>
              setNotice(
                "Backend integration pending. This automation was not activated."
              )
            }
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white transition hover:bg-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0d19]"
          >
            <Zap className="h-4 w-4" />
            Go Live
          </button>
        </div>
      </header>

      <div className="border-b border-violet-400/15 bg-violet-400/[0.06] px-4 py-2.5 text-xs text-violet-100 sm:px-6">
        <span className="font-semibold">Preview only.</span> Saving and
        activation are not connected to a backend.
      </div>

      {notice && (
        <div
          role="status"
          className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-xl border border-violet-300/20 bg-violet-400/10 px-4 py-3 text-sm text-violet-100 sm:mx-6"
        >
          <span>{notice}</span>
          <button
            type="button"
            aria-label="Dismiss notice"
            onClick={() => setNotice(null)}
            className="rounded p-1 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
          >
            <span aria-hidden="true">x</span>
          </button>
        </div>
      )}

      {advancedOpen && (
        <div
          role="status"
          className="mx-4 mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300 sm:mx-6"
        >
          Advanced editor is not included in this visual-builder phase.
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_390px]">
        <main className="flex min-h-[720px] flex-col items-center justify-center gap-5 bg-[radial-gradient(ellipse_at_50%_35%,rgba(124,58,237,0.12),transparent_58%)] px-4 py-8 sm:px-8">
          <div className="flex w-full max-w-[520px] items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">Live preview</p>
              <p className="mt-1 text-xs text-slate-400">
                Messages update as you edit the configuration.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/15 bg-emerald-300/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              Preview mode
            </span>
          </div>

          <div className="w-full max-w-[330px] rounded-[2.5rem] border-[7px] border-[#272a38] bg-[#080910] p-2 shadow-2xl shadow-black/50">
            <div className="overflow-hidden rounded-[1.9rem] bg-white text-slate-900">
              <div className="flex h-8 items-center justify-center bg-white">
                <div className="h-1.5 w-16 rounded-full bg-slate-300" />
              </div>
              <div className="flex items-center gap-2.5 border-b border-slate-100 px-3 py-2.5">
                <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-fuchsia-500 via-violet-500 to-amber-400 text-xs font-bold text-white">
                  {selectedAccount?.profile_picture_url ? (
                    <Image
                      src={selectedAccount.profile_picture_url}
                      alt=""
                      width={32}
                      height={32}
                      unoptimized
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    selectedAccount?.username.slice(0, 1).toUpperCase() ?? "I"
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">
                    {selectedAccount ? `@${selectedAccount.username}` : "Instagram account"}
                  </p>
                  <p className="truncate text-[10px] text-slate-500">
                    {selectedAccount?.name || "Post preview"}
                  </p>
                </div>
                <MoreHorizontal className="h-4 w-4 text-slate-700" aria-hidden="true" />
              </div>

              <div className="relative aspect-square bg-slate-100">
                {selectedMedia ? (
                  <MediaThumbnail media={selectedMedia} className="h-full w-full" />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
                    <ImageIcon className="h-8 w-8" />
                    <span className="text-xs">Choose a post to preview</span>
                  </div>
                )}
              </div>

              <div className="space-y-3 px-3 py-3">
                <div className="flex items-center gap-2 text-rose-500">
                  <MessageCircle className="h-4 w-4" />
                  <span className="text-[11px] font-medium">Comment trigger preview</span>
                </div>
                <div className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">
                  <span className="font-semibold">@jordan </span>
                  {keywordList[0] ?? "Your keyword"} - could you send me the details?
                </div>
                <div className="ml-auto max-w-[90%] rounded-2xl rounded-br-sm bg-violet-600 px-3 py-2.5 text-xs leading-relaxed text-white">
                  {previewMessage || "Your private reply will appear here."}
                </div>
                {publicReplyEnabled && (
                  <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-violet-600">
                      Public comment reply
                    </p>
                    {previewReply || "Your public reply will appear here."}
                  </div>
                )}
              </div>
              <div className="h-7 border-t border-slate-100 px-3 pt-2 text-center text-[10px] text-slate-400">
                Instagram preview - not sent
              </div>
            </div>
          </div>

          <div className="max-w-[360px] text-center text-xs leading-relaxed text-slate-400">
            This is a visual preview only. Nothing is sent to Instagram from
            this editor.
          </div>
        </main>

        <aside
          aria-label="Automation configuration"
          className="border-t border-white/10 bg-[#111321] p-4 sm:p-6 xl:border-l xl:border-t-0"
        >
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Configuration</p>
              <p className="mt-1 text-xs text-slate-400">Comment-to-DM automation</p>
            </div>
            <button
              type="button"
              aria-label="Configuration help"
              title="Settings are a local preview only"
              className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              <CircleHelp className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-5">
            <section aria-labelledby="account-label">
              <label
                id="account-label"
                htmlFor="instagram-account"
                className="mb-2 block text-xs font-semibold text-slate-200"
              >
                Instagram account
              </label>
              {accounts.length > 0 ? (
                <div className="relative">
                  <select
                    id="instagram-account"
                    value={accountId}
                    onChange={handleAccountChange}
                    className="min-h-11 w-full appearance-none rounded-xl border border-white/10 bg-[#191c2c] px-3 pr-9 text-sm text-white outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20"
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name
                          ? `${account.name} (@${account.username})`
                          : `@${account.username}`}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/15 p-4 text-sm text-slate-400">
                  <p>No connected Instagram accounts found.</p>
                  <Link
                    href="/instagram"
                    className="mt-2 inline-flex min-h-9 items-center rounded-lg px-2 text-violet-300 underline underline-offset-4 hover:text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                  >
                    Connect an account
                  </Link>
                </div>
              )}
            </section>

            <section aria-labelledby="post-label">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 id="post-label" className="text-xs font-semibold text-slate-200">
                  Select a post or Reel
                </h2>
                <span className="text-[11px] text-slate-500">
                  {media.length ? `${media.length} loaded` : ""}
                </span>
              </div>
              {loadingMedia ? (
                <div
                  role="status"
                  className="flex min-h-24 items-center justify-center gap-2 text-xs text-slate-400"
                >
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Loading Instagram media...
                </div>
              ) : mediaError ? (
                <p role="alert" className="rounded-xl bg-rose-400/10 p-3 text-xs text-rose-200">
                  {mediaError}
                </p>
              ) : media.length === 0 ? (
                <p className="rounded-xl border border-dashed border-white/10 p-4 text-xs text-slate-400">
                  No recent posts or Reels were returned for this account.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
                  {media.map((item) => {
                    const selected = item.id === selectedMediaId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={selected}
                        aria-label={`Select ${item.mediaType === "IMAGE" ? "post" : "Reel or video"}${item.caption ? `: ${item.caption.slice(0, 100)}` : ""}`}
                        onClick={() => setSelectedMediaId(item.id)}
                        className={`group overflow-hidden rounded-xl border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                          selected
                            ? "border-violet-400 ring-2 ring-violet-400/25"
                            : "border-white/10 hover:border-white/30"
                        }`}
                      >
                        <MediaThumbnail media={item} className="aspect-square w-full" />
                        <span className="block truncate px-2 py-1.5 text-[10px] text-slate-300">
                          {item.caption || (item.mediaType === "IMAGE" ? "Post" : "Reel or video")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {nextCursor && (
                <button
                  type="button"
                  disabled={loadingMore}
                  aria-busy={loadingMore}
                  onClick={() => void loadMore()}
                  className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/10 text-xs font-medium text-slate-200 transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingMore ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  {loadingMore ? "Loading..." : "Load more posts"}
                </button>
              )}
            </section>

            <section aria-labelledby="trigger-label">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-400/10 text-violet-300">
                  <MessageCircle className="h-3.5 w-3.5" />
                </span>
                <h2 id="trigger-label" className="text-xs font-semibold text-slate-200">
                  Comment trigger
                </h2>
              </div>
              <p className="mb-2 text-[11px] text-slate-400">
                Match when a comment contains:
              </p>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Keyword match type">
                {(["exact", "contains"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={matchMode === mode}
                    onClick={() => setMatchMode(mode)}
                    className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-medium capitalize transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                      matchMode === mode
                        ? "border-violet-400/50 bg-violet-400/10 text-violet-100"
                        : "border-white/10 text-slate-400 hover:bg-white/5"
                    }`}
                  >
                    {matchMode === mode && <Check className="h-3.5 w-3.5" />}
                    {mode === "exact" ? "Exact match" : "Contains"}
                  </button>
                ))}
              </div>
              <label htmlFor="trigger-keywords" className="sr-only">
                Trigger keywords
              </label>
              <textarea
                id="trigger-keywords"
                value={keywords}
                onChange={(event) => setKeywords(event.target.value)}
                rows={2}
                placeholder="GITHUB, FREEBIE"
                aria-describedby="keyword-help"
                className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-[#191c2c] px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20"
              />
              <p id="keyword-help" className="mt-1.5 text-[11px] text-slate-500">
                Enter multiple keywords separated by commas or new lines. Matching
                behavior is a preview and is not executed.
              </p>
              {keywordList.length > 0 && (
                <ul aria-label="Configured keywords" className="mt-2 flex flex-wrap gap-1.5">
                  {keywordList.map((keyword, index) => (
                    <li
                      key={`${keyword}-${index}`}
                      className="rounded-full border border-violet-300/15 bg-violet-300/10 px-2.5 py-1 text-[11px] text-violet-100"
                    >
                      {keyword}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="dm-label">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-400/10 text-violet-300">
                    <Send className="h-3.5 w-3.5" />
                  </span>
                  <h2 id="dm-label" className="text-xs font-semibold text-slate-200">
                    Private DM
                  </h2>
                </div>
                <span className="rounded-full bg-slate-700/70 px-2 py-1 text-[10px] text-slate-300">
                  Required
                </span>
              </div>
              <label htmlFor="dm-message" className="sr-only">
                Private direct message
              </label>
              <textarea
                id="dm-message"
                value={dmMessage}
                onChange={(event) => setDmMessage(event.target.value)}
                rows={4}
                className="w-full resize-y rounded-xl border border-white/10 bg-[#191c2c] px-3 py-2.5 text-sm leading-relaxed text-white outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20"
              />
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[10px] text-slate-500">Personalize:</span>
                {["{{username}}", "{{first_name}}", "{{account_name}}"].map((token) => (
                  <button
                    key={token}
                    type="button"
                    onClick={() => insertPlaceholder(token)}
                    className="min-h-8 rounded-lg border border-white/10 px-2 text-[10px] text-violet-200 transition hover:bg-violet-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                  >
                    {token}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-white/[0.025] p-3.5">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={publicReplyEnabled}
                  onChange={(event) => setPublicReplyEnabled(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111321]"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-slate-200">
                    Also reply publicly
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">
                    Optional public comment response. Preview only.
                  </span>
                </span>
              </label>
              {publicReplyEnabled && (
                <div className="mt-3">
                  <label htmlFor="public-reply" className="sr-only">
                    Public comment reply
                  </label>
                  <textarea
                    id="public-reply"
                    value={publicReply}
                    onChange={(event) => setPublicReply(event.target.value)}
                    rows={2}
                    className="w-full resize-y rounded-xl border border-white/10 bg-[#191c2c] px-3 py-2.5 text-sm leading-relaxed text-white outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20"
                  />
                </div>
              )}
            </section>

            <div className="rounded-xl border border-amber-200/10 bg-amber-200/[0.06] p-3 text-xs leading-relaxed text-amber-100/80">
              <div className="mb-1 flex items-center gap-2 font-semibold text-amber-100">
                <Sparkles className="h-3.5 w-3.5" />
                Not connected to automation backend
              </div>
              Your edits are temporary and will be lost when you leave this page.
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
