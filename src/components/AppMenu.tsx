import { useEffect, useRef } from "react";
import { useT } from "../i18n.ts";

const icons: Record<string, string> = {
  "New workspace": "M3 4h18v16H3z M3 9h18 M8 14h8 M12 10v8",
  "Open…": "M3 6h7l2 2h9l-2 10H3z",
  File: "M5 3h9l5 5v13H5z M14 3v5h5",
  Edit: "M4 20l4-1L20 7l-3-3L5 16z",
  View: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z",
  Structure: "M12 4v5 M5 20v-6h14v6 M12 9v11 M5 14h14",
  Save: "M4 3h14l2 2v16H4z M7 3v6h9V3 M7 21v-8h10v8",
  "Save As…": "M4 3h14l2 2v16H4z M7 3v6h9V3 M8 17h8 M12 13v8",
  Export: "M12 3v12 M8 11l4 4 4-4 M4 17v4h16v-4",
  "Import XMind…": "M5 3h9l5 5v13H5z M14 3v5h5 M12 10v8 M9 15l3 3 3-3",
  "Export XMind…": "M5 3h9l5 5v13H5z M14 3v5h5 M12 18v-8 M9 13l3-3 3 3",
  Undo: "M9 7 4 12l5 5 M4 12h10a5 5 0 0 1 5 5",
  Redo: "M15 7l5 5-5 5 M20 12H10a5 5 0 0 0-5 5",
  Rename: "M4 20l4-1L20 7l-3-3L5 16z M14 7l3 3",
  Delete: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v5 M14 11v5",
  "Add Child Topic": "M5 4v16 M5 12h8 M17 8v8 M13 12h8",
  "Zoom In": "M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z M16 16l4 4 M11 8v6 M8 11h6",
  "Zoom Out": "M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z M16 16l4 4 M8 11h6",
  "Fit Canvas": "M9 4H4v5 M15 4h5v5 M4 15v5h5 M20 15v5h-5",
  "Reset Zoom": "M4 12a8 8 0 1 0 3-6 M4 4v5h5",
  "Expand All": "M4 8h16 M8 13l4 4 4-4",
  "Collapse All": "M4 16h16 M8 11l4-4 4 4",
  Layout: "M3 4h7v7H3z M14 4h7v7h-7z M3 15h7v5H3z M14 15h7v5h-7z",
  Outline: "M4 6h2 M9 6h11 M4 12h2 M9 12h11 M4 18h2 M9 18h11",
};
Object.assign(icons, {
  "Add Sibling Topic": "M5 4v16 M5 8h7 M5 16h7 M17 12v8 M13 16h8",
  "Add independent topic": "M4 5h10v10H4z M18 12v8 M14 16h8",
  "Add floating note": "M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5",
  "Add summary": "M4 4h4v16H4 M8 12h5 M13 8h7v8h-7z",
  "Copy PNG to clipboard":
    "M8 5h8 M9 3h6v4H9z M7 5H5v16h14V5h-2 M8 17l3-3 2 2 2-2 2 3",
  "View outline": "M4 6h2 M9 6h11 M4 12h2 M9 12h11 M4 18h2 M9 18h11",
  "Logic Chart (Right)":
    "M3 10h4v4H3z M7 12h5 M12 5v14 M12 5h8 M12 12h8 M12 19h8",
  "Logic Chart (Left)":
    "M17 10h4v4h-4z M17 12h-5 M12 5v14 M12 5H4 M12 12H4 M12 19H4",
  Settings:
    "M12 2a2 2 0 0 1 2 2v.4a8 8 0 0 1 2 .8l.3-.3a2 2 0 0 1 2.8 2.8l-.3.3a8 8 0 0 1 .8 2h.4a2 2 0 0 1 0 4h-.4a8 8 0 0 1-.8 2l.3.3a2 2 0 0 1-2.8 2.8l-.3-.3a8 8 0 0 1-2 .8v.4a2 2 0 0 1-4 0v-.4a8 8 0 0 1-2-.8l-.3.3a2 2 0 0 1-2.8-2.8l.3-.3a8 8 0 0 1-.8-2H4a2 2 0 0 1 0-4h.4a8 8 0 0 1 .8-2l-.3-.3a2 2 0 0 1 2.8-2.8l.3.3a8 8 0 0 1 2-.8V4a2 2 0 0 1 2-2z M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z",
  "Mind map":
    "M10 10h4v4h-4z M10 12H6 M6 6v12 M6 6H2 M6 18H2 M14 12h4 M18 6v12 M18 6h4 M18 18h4",
  "Org Chart":
    "M10 3h4v4h-4z M12 7v5 M4 19v-7h16v7 M12 12v7 M2 19h4 M10 19h4 M18 19h4",
  "Fishbone (Right)": "M3 12h17 M7 12l3-5 M12 12l3 5 M16 12l3-5 M20 9v6",
  "Fishbone (Left)": "M4 12h17 M17 12l-3-5 M12 12l-3 5 M8 12 5 7 M4 9v6",
});
export function SettingsIcon() {
  return (
    <svg
      className="menu-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={icons.Settings} />
    </svg>
  );
}
export function MenuLabel({ label }: { label: string }) {
  const t = useT(),
    clean = label.replace(/^✓ /, ""),
    path = icons[clean];
  return (
    <span className="menu-label">
      {path && (
        <svg
          className="menu-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={path} />
        </svg>
      )}
      <span>
        {label.startsWith("✓ ") ? "✓ " : ""}
        {t(clean)}
      </span>
    </span>
  );
}

type Action = () => void | Promise<void>;
type Choice = [string, Action, boolean?];
type MenuItem = [string, Action | null, (string | Choice[])?];
interface Props {
  open: boolean;
  setOpen: (value: boolean) => void;
  menu: string;
  setMenu: (value: string) => void;
  sections: [string, Action | MenuItem[]][];
  busy: boolean;
}

export default function AppMenu({
  open,
  setOpen,
  menu,
  setMenu,
  sections,
  busy,
}: Props) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  function close() {
    setMenu("");
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !ref.current?.contains(event.target))
        close();
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div className="app-menu-wrapper" ref={ref}>
      <button
        type="button"
        className="app-menu-btn"
        aria-label={t("Menu")}
        aria-expanded={open}
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      {open && (
        <nav className="app-menu-list" aria-label={t("Application menu")}>
          {sections.map(([name, items]) => (
            <div
              className={
                "menu" + (name === "Structure" ? " structure-control" : "")
              }
              key={name}
            >
              {typeof items === "function" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    close();
                    void items();
                  }}
                >
                  <MenuLabel label={name} />
                </button>
              ) : (
                <button
                  type="button"
                  aria-expanded={menu === name}
                  onClick={() => setMenu(menu === name ? "" : name)}
                >
                  <MenuLabel label={name} />
                  <span className="menu-arrow" aria-hidden="true">
                    ›
                  </span>
                </button>
              )}
              {Array.isArray(items) && menu === name && (
                <div className="dropdown">
                  {items.map(([label, action, detail]) =>
                    Array.isArray(detail) ? (
                      <details
                        key={label}
                        className="export-options"
                        onToggle={(event) => {
                          const current = event.currentTarget;
                          if (current.open)
                            current.parentElement
                              ?.querySelectorAll<HTMLDetailsElement>(
                                ":scope > details[open]",
                              )
                              .forEach((other) => {
                                if (other !== current) other.open = false;
                              });
                        }}
                      >
                        <summary>
                          <MenuLabel label={label} />
                        </summary>
                        <div className="export-submenu">
                          {detail.map(([title, run, checked]) => (
                            <button
                              key={title}
                              disabled={busy}
                              aria-pressed={
                                typeof checked === "boolean"
                                  ? checked
                                  : undefined
                              }
                              onClick={() => {
                                close();
                                void run();
                              }}
                            >
                              <MenuLabel label={title} />
                              {checked && (
                                <span className="menu-check" aria-hidden="true">
                                  ✓
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </details>
                    ) : (
                      <button
                        key={label}
                        disabled={busy || !action}
                        onClick={() => {
                          close();
                          void action?.();
                        }}
                      >
                        <MenuLabel label={label} />
                        {typeof detail === "string" && (
                          <span className="menu-shortcut">{detail}</span>
                        )}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          ))}
        </nav>
      )}
    </div>
  );
}
