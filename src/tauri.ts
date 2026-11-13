export const invoke = <K extends keyof TauriResults>(
  command: K,
  args?: Record<string, unknown>,
): Promise<TauriResults[K]> =>
  window.__TAURI__?.core?.invoke(command, args) ??
  Promise.reject(new Error("Run this from the Tauri window"));
