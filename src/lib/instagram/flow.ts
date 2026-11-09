export type InstagramCallbackOutcome =
  | { kind: "invalid_state"; status: "invalid_state" }
  | { kind: "provider_error"; status: "oauth_cancelled" | "oauth_failed" }
  | { kind: "missing_code"; status: "oauth_failed" }
  | { kind: "continue"; code: string };

export function classifyInstagramCallback(
  stateValid: boolean,
  providerError: string | null,
  code: string | null
): InstagramCallbackOutcome {
  if (!stateValid) return { kind: "invalid_state", status: "invalid_state" };
  if (providerError) {
    return {
      kind: "provider_error",
      status: providerError === "access_denied" ? "oauth_cancelled" : "oauth_failed",
    };
  }
  if (!code) return { kind: "missing_code", status: "oauth_failed" };
  return { kind: "continue", code };
}

export function deduplicateInstagramAccounts<
  T extends { id: string },
>(accounts: T[]): T[] {
  return [...new Map(accounts.map((account) => [account.id, account])).values()];
}

export function hasAccountOwnershipConflict(
  existingAccounts: Array<{ owner_id: string }>,
  currentOwnerId: string
): boolean {
  return existingAccounts.some((account) => account.owner_id !== currentOwnerId);
}

export function isOwnedInstagramAccount(
  account: { owner_id: string } | null,
  currentOwnerId: string
): boolean {
  return account?.owner_id === currentOwnerId;
}

export function shouldDeleteBusinessConnection(
  remainingAccountCount: number
): boolean {
  return Number.isInteger(remainingAccountCount) && remainingAccountCount === 0;
}
