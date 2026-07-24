export function getUndoPresentation(undo, now = Date.now()) {
  const remainingMs = undo?.expiresAt - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return { active: false, remainingMs: 0, remainingSeconds: 0 };
  }
  return {
    active: true,
    remainingMs,
    remainingSeconds: Math.ceil(remainingMs / 1000),
  };
}
