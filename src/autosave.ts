export const AUTO_SAVE_KEY = "mini-mindmap-auto-save";

export function readAutoSave(storage: Pick<Storage, "getItem">) {
  try {
    return storage.getItem(AUTO_SAVE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function shouldAutoSave({
  enabled,
  path,
  composing,
  busy,
  paused,
  dirty,
}: {
  enabled: boolean;
  path: string;
  composing: boolean;
  busy: boolean;
  paused: boolean;
  dirty: boolean;
}) {
  return Boolean(enabled && path && !composing && !busy && !paused && dirty);
}
