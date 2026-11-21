import type { MatchType } from "../../types/database";

/** Pure keyword matching for Instagram webhook events.

 * This module never touches a database, a network or automation state. It maps
 * already-loaded trigger rows and comment text to a deterministic list of
 * automation IDs, so replaying the same event always produces the same result.
 */

/** Mirrors the 1..64 character keyword bound enforced by the draft RPC. */
export const MAX_KEYWORD_LENGTH = 64;

const WHITESPACE = /\s+/g;

export type KeywordTrigger = {
  keyword: string;
  matchType: MatchType;
};

export type AutomationCandidate = {
  automationId: string;
  triggers: readonly KeywordTrigger[];
};

/**
 * Case-insensitive, whitespace-stable, Unicode-normalized comparison text.
 * NFKC folds compatibility forms (for example full-width characters) so the
 * same comment cannot match differently on replay.
 */
export function normalizeMatchText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(WHITESPACE, " ")
    .toLowerCase();
}

/**
 * Returns the normalized keyword, or null when the stored row is unusable.
 * Rows are validated defensively because the table has no length/charset
 * constraint for direct writes; an unusable keyword is skipped, never fatal.
 */
export function sanitizeKeyword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeMatchText(value);
  if (normalized.length === 0) return null;
  if (normalized.length > MAX_KEYWORD_LENGTH) return null;
  return normalized;
}

export function matchesKeyword(
  normalizedText: string,
  keyword: string,
  matchType: MatchType
): boolean {
  const normalizedKeyword = sanitizeKeyword(keyword);
  if (normalizedKeyword === null) return false;

  // Unknown runtime match types are unsupported and must not match.
  if (matchType !== "EXACT" && matchType !== "CONTAINS") {
    return false;
  }

  if (matchType === "EXACT") {
    return normalizedText === normalizedKeyword;
  }

  return normalizedText.includes(normalizedKeyword);
}

/**
 * Returns matched automation IDs sorted ascending and de-duplicated.
 * A single trigger match is enough for an automation to match.
 */
export function matchAutomations(
  commentText: string,
  candidates: readonly AutomationCandidate[]
): string[] {
  const text = normalizeMatchText(commentText);
  if (text.length === 0) return [];

  const matched = new Set<string>();
  for (const candidate of candidates) {
    if (typeof candidate.automationId !== "string") continue;
    for (const trigger of candidate.triggers) {
      if (matchesKeyword(text, trigger.keyword, trigger.matchType)) {
        matched.add(candidate.automationId);
        break;
      }
    }
  }

  return [...matched].sort();
}
