export function markSideTask(ids: Set<string>, sessionId: string): Set<string> {
  const next = new Set(ids);
  next.add(sessionId);
  return next;
}

export function unmarkSideTask(
  ids: Set<string>,
  sessionId: string,
): Set<string> {
  const next = new Set(ids);
  next.delete(sessionId);
  return next;
}
