"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deduplicateInstagramMedia,
  isValidInstagramTimestamp,
} from "./instagram-account-data-utils";

type InstagramProfile = {
  id: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
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

type ProfileState = {
  accountId: string;
  profile: InstagramProfile | null;
  error: string | null;
};

type MediaState = {
  accountId: string;
  media: InstagramMedia[];
  nextCursor: string | null;
  error: string | null;
  loading: boolean;
  loadingMore: boolean;
};

function getErrorMessage(error: string | undefined): string {
  if (error === "reconnect_required") {
    return "This connection needs to be reconnected before Instagram data can be loaded.";
  }
  if (error === "system_user_token_required") {
    return "Live profile and media access is available for Meta Unified Login connections.";
  }
  return "Instagram data could not be loaded. Please try again later.";
}

export function InstagramAccountData({
  accountId,
  username: initialUsername,
  name: initialName,
  profilePictureUrl: initialProfilePictureUrl,
}: {
  accountId: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
}) {
  const [profileState, setProfileState] = useState<ProfileState | null>(null);
  const [mediaState, setMediaState] = useState<MediaState | null>(null);
  const requestGeneration = useRef(0);
  const loadingMoreRequest = useRef(false);
  const requestController = useRef<AbortController | null>(null);
  const currentProfileState =
    profileState?.accountId === accountId ? profileState : null;
  const currentMediaState =
    mediaState?.accountId === accountId ? mediaState : null;

  useEffect(() => {
    let active = true;
    requestGeneration.current += 1;
    const controller = new AbortController();
    requestController.current = controller;
    loadingMoreRequest.current = false;

    async function loadProfile() {
      const query = new URLSearchParams({ accountId });
      try {
        const response = await fetch(`/api/instagram/profile?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => ({}))) as {
          profile?: InstagramProfile;
          error?: string;
        };
        if (!active || !response.ok) {
          if (active && !response.ok) {
            setProfileState({
              accountId,
              profile: null,
              error: getErrorMessage(body.error),
            });
          }
          return;
        }
        setProfileState({
          accountId,
          profile: body.profile ?? null,
          error: body.profile ? null : "Instagram profile data was invalid.",
        });
      } catch {
        if (active && !controller.signal.aborted) {
          setProfileState({
            accountId,
            profile: null,
            error: "Instagram profile could not be reached.",
          });
        }
      }
    }

    async function loadInitialMedia() {
      const query = new URLSearchParams({ accountId });
      try {
        const response = await fetch(`/api/instagram/media?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => ({}))) as
          | MediaResponse
          | { error?: string };
        if (!active) return;
        if (!response.ok) {
          setMediaState({
            accountId,
            media: [],
            nextCursor: null,
            error: getErrorMessage("error" in body ? body.error : undefined),
            loading: false,
            loadingMore: false,
          });
        } else if ("media" in body && Array.isArray(body.media)) {
          setMediaState({
            accountId,
            media: deduplicateInstagramMedia([], body.media),
            nextCursor: body.nextCursor ?? null,
            error: null,
            loading: false,
            loadingMore: false,
          });
        } else {
          setMediaState({
            accountId,
            media: [],
            nextCursor: null,
            error: "Instagram media data was invalid.",
            loading: false,
            loadingMore: false,
          });
        }
      } catch {
        if (active && !controller.signal.aborted) {
          setMediaState({
            accountId,
            media: [],
            nextCursor: null,
            error: "Instagram media could not be reached.",
            loading: false,
            loadingMore: false,
          });
        }
      }
    }

    void Promise.all([loadProfile(), loadInitialMedia()]);

    return () => {
      active = false;
      controller.abort();
      if (requestController.current === controller) {
        requestController.current = null;
      }
    };
  }, [accountId]);

  const loadMore = useCallback(async () => {
    const nextCursor = currentMediaState?.nextCursor;
    if (
      !nextCursor ||
      loadingMoreRequest.current ||
      !requestController.current
    ) {
      return;
    }

    loadingMoreRequest.current = true;
    const generation = requestGeneration.current;
    const controller = requestController.current;
    setMediaState((current) =>
      current?.accountId === accountId
        ? { ...current, loadingMore: true, error: null }
        : current
    );
    try {
      const query = new URLSearchParams({
        accountId,
        after: nextCursor,
      });
      const response = await fetch(`/api/instagram/media?${query}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as
        | MediaResponse
        | { error?: string };
      if (generation !== requestGeneration.current) return;
      if (!response.ok || !("media" in body) || !Array.isArray(body.media)) {
        setMediaState((current) =>
          current?.accountId === accountId
            ? {
                ...current,
                error: getErrorMessage(
                  "error" in body ? body.error : undefined
                ),
              }
            : current
        );
        return;
      }
      setMediaState((current) =>
        current?.accountId === accountId
          ? {
              ...current,
              media: deduplicateInstagramMedia(current.media, body.media),
              nextCursor: body.nextCursor ?? null,
            }
          : current
      );
    } catch {
      if (
        generation === requestGeneration.current &&
        !controller.signal.aborted
      ) {
        setMediaState((current) =>
          current?.accountId === accountId
            ? { ...current, error: "Instagram media could not be reached." }
            : current
        );
      }
    } finally {
      if (generation === requestGeneration.current) {
        loadingMoreRequest.current = false;
        setMediaState((current) =>
          current?.accountId === accountId
            ? { ...current, loadingMore: false }
            : current
        );
      }
    }
  }, [accountId, currentMediaState?.nextCursor]);

  const profile = currentProfileState?.profile ?? null;
  const username = profile ? profile.username : initialUsername;
  const name = profile ? profile.name : initialName;
  const profilePictureUrl = profile
    ? profile.profilePictureUrl
    : initialProfilePictureUrl;
  const profileError = currentProfileState?.error;
  const media = currentMediaState?.media ?? [];
  const nextCursor = currentMediaState?.nextCursor ?? null;
  const mediaError = currentMediaState?.error ?? null;
  const loadingMedia = currentMediaState?.loading ?? true;
  const loadingMore = currentMediaState?.loadingMore ?? false;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        {profilePictureUrl ? (
          // Meta returns profile images from dynamic CDN hosts.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profilePictureUrl}
            alt={`@${username} profile`}
            referrerPolicy="no-referrer"
            className="h-14 w-14 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-sm font-semibold">
            {username.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold">@{username}</p>
          {name && (
            <p className="truncate text-sm text-muted-foreground">{name}</p>
          )}
          {profileError && (
            <p
              role="status"
              className="text-xs text-amber-700 dark:text-amber-300"
            >
              {profileError}
            </p>
          )}
        </div>
      </div>

      <section aria-label={`Recent media from @${username}`}>
        <h3 className="mb-3 text-sm font-semibold">Recent posts and Reels</h3>
        {loadingMedia ? (
          <p className="text-sm text-muted-foreground">Loading media...</p>
        ) : mediaError && media.length === 0 ? (
          <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
            {mediaError}
          </p>
        ) : media.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No recent media is available for this account.
          </p>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {media.map((item) => {
                const previewUrl = item.mediaUrl ?? item.thumbnailUrl;
                const previewIsVideo =
                  item.mediaType === "VIDEO" && Boolean(item.mediaUrl);
                const preview = previewIsVideo ? (
                  <video
                    src={item.mediaUrl ?? undefined}
                    poster={item.thumbnailUrl ?? undefined}
                    controls
                    preload="none"
                    className="aspect-square w-full rounded-lg bg-muted object-cover"
                  />
                ) : previewUrl ? (
                  // Meta returns media from dynamic CDN hosts.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt={item.caption ?? `${item.mediaType} Instagram post`}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    className="aspect-square w-full rounded-lg bg-muted object-cover"
                  />
                ) : (
                  <span className="flex aspect-square items-center justify-center rounded-lg bg-muted p-3 text-center text-xs text-muted-foreground">
                    Preview unavailable
                  </span>
                );

                return (
                  <li key={item.id} className="min-w-0">
                    {item.permalink ? (
                      <a
                        href={item.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                        aria-label={`Open ${item.mediaType} Instagram post`}
                      >
                        {preview}
                      </a>
                    ) : (
                      preview
                    )}
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {item.caption || item.mediaType}
                    </p>
                    {isValidInstagramTimestamp(item.timestamp) && (
                      <time
                        dateTime={item.timestamp}
                        className="text-xs text-muted-foreground"
                      >
                        {new Date(item.timestamp).toLocaleDateString()}
                      </time>
                    )}
                  </li>
                );
              })}
            </ul>
            {mediaError && (
              <p
                role="status"
                className="mt-3 text-sm text-amber-700 dark:text-amber-300"
              >
                {mediaError}
              </p>
            )}
            {nextCursor && (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                aria-busy={loadingMore}
                className="mt-4 inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60"
              >
                <span aria-live="polite">
                  {loadingMore ? "Loading more media..." : "Load more"}
                </span>
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
