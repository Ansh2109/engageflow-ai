export type InstagramMediaItem = {
  id: string;
};

export function deduplicateInstagramMedia<T extends InstagramMediaItem>(
  existing: T[],
  incoming: T[]
): T[] {
  const seenIds = new Set(existing.map((item) => item.id));
  const uniqueIncoming = incoming.filter((item) => {
    if (seenIds.has(item.id)) return false;
    seenIds.add(item.id);
    return true;
  });
  return [...existing, ...uniqueIncoming];
}

export function isValidInstagramTimestamp(timestamp: string): boolean {
  return timestamp.trim().length > 0 && Number.isFinite(Date.parse(timestamp));
}
