/// <reference types="vite/client" />
interface SaveResult {
  path: string;
  warning: string | null;
}
interface TauriResults {
  open_copy: { name: string; contents: string } | null;
  import_xmind: { name: string; contents: string } | null;
  open_launched:
    | { Ok: { name: string; contents: string } }
    | { Err: string }
    | null;
  accept_open: string;
  clear_target: void;
  save_as: SaveResult | null;
  save_current: SaveResult;
  read_recovery: string | null;
  write_recovery: void;
  clear_recovery: void;
  export_file: boolean;
  copy_png: void;
  open_link: void;
}
interface TauriWindow {
  setTitle(title: string): Promise<void>;
  destroy(): Promise<void>;
  onCloseRequested(
    handler: (event: { preventDefault(): void }) => void,
  ): Promise<() => void>;
}
interface Window {
  __TAURI__?: {
    core: {
      invoke<K extends keyof TauriResults>(
        command: K,
        args?: Record<string, unknown>,
      ): Promise<TauriResults[K]>;
    };
    event?: {
      listen(event: string, handler: () => void): Promise<() => void>;
    };
    window: { getCurrentWindow(): TauriWindow };
  };
}
