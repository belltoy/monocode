import { useSyncExternalStore } from "react";

const FAMILY_KEY = "monocode.terminalFontFamily";
const SIZE_KEY = "monocode.terminalFontSize";
const CHANGE_EVENT = "monocode:terminal-font-change";
const CURSOR_STYLE_KEY = "monocode.terminalCursorStyle";
const CURSOR_STYLE_CHANGE_EVENT = "monocode:terminal-cursor-style-change";

export type TerminalCursorStyle = "bar" | "block" | "underline";
export const TERMINAL_CURSOR_STYLE_DEFAULT: TerminalCursorStyle = "bar";

export const TERMINAL_FONT_SIZE_DEFAULT = 12;
export const TERMINAL_FONT_SIZE_MIN = 10;
export const TERMINAL_FONT_SIZE_MAX = 24;
export const TERMINAL_FONT_FAMILY_DEFAULT =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function normalizeTerminalFontSize(value: number): number {
  return Number.isFinite(value)
    ? Math.round(
        Math.min(
          TERMINAL_FONT_SIZE_MAX,
          Math.max(TERMINAL_FONT_SIZE_MIN, value),
        ),
      )
    : TERMINAL_FONT_SIZE_DEFAULT;
}

let unsavedFamily: string | null = null;
let unsavedSize: number | null = null;

export function loadTerminalFontFamily(): string {
  return unsavedFamily ?? read(FAMILY_KEY) ?? "";
}

export function loadTerminalFontSize(): number {
  const raw = read(SIZE_KEY);
  return (
    unsavedSize ??
    normalizeTerminalFontSize(
      raw == null || raw.trim() === ""
        ? TERMINAL_FONT_SIZE_DEFAULT
        : Number(raw),
    )
  );
}

export function resolveTerminalFontFamily(value: string): string {
  const family = value.trim();
  return family
    ? `${JSON.stringify(family)}, ${TERMINAL_FONT_FAMILY_DEFAULT}`
    : TERMINAL_FONT_FAMILY_DEFAULT;
}

function notify() {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function saveTerminalFontFamily(value: string) {
  // Preserve spaces while the controlled input is being edited; trim on use.
  const next = value;
  try {
    localStorage.setItem(FAMILY_KEY, next);
  } catch {
    // Keep the preference usable even if storage is unavailable.
  }
  unsavedFamily = read(FAMILY_KEY) === next ? null : next;
  notify();
}

export function saveTerminalFontSize(value: number) {
  const next = normalizeTerminalFontSize(value);
  try {
    localStorage.setItem(SIZE_KEY, String(next));
  } catch {
    // Keep the preference usable even if storage is unavailable.
  }
  unsavedSize = read(SIZE_KEY) === String(next) ? null : next;
  notify();
}

export function subscribeTerminalFont(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (
      event.key !== null &&
      event.key !== FAMILY_KEY &&
      event.key !== SIZE_KEY
    )
      return;
    if (event.key === null || event.key === FAMILY_KEY) unsavedFamily = null;
    if (event.key === null || event.key === SIZE_KEY) unsavedSize = null;
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTerminalFontFamily() {
  return useSyncExternalStore(
    subscribeTerminalFont,
    loadTerminalFontFamily,
    () => "",
  );
}

export function useTerminalFontSize() {
  return useSyncExternalStore(
    subscribeTerminalFont,
    loadTerminalFontSize,
    () => TERMINAL_FONT_SIZE_DEFAULT,
  );
}

let unsavedCursorStyle: TerminalCursorStyle | null = null;

export function normalizeTerminalCursorStyle(
  value: unknown,
): TerminalCursorStyle {
  return value === "block" || value === "underline" || value === "bar"
    ? value
    : TERMINAL_CURSOR_STYLE_DEFAULT;
}

export function loadTerminalCursorStyle(): TerminalCursorStyle {
  return (
    unsavedCursorStyle ?? normalizeTerminalCursorStyle(read(CURSOR_STYLE_KEY))
  );
}

export function saveTerminalCursorStyle(value: TerminalCursorStyle) {
  const next = normalizeTerminalCursorStyle(value);
  try {
    localStorage.setItem(CURSOR_STYLE_KEY, next);
  } catch {
    // Keep the preference usable even if storage is unavailable.
  }
  unsavedCursorStyle = read(CURSOR_STYLE_KEY) === next ? null : next;
  window.dispatchEvent(new CustomEvent(CURSOR_STYLE_CHANGE_EVENT));
}

export function subscribeTerminalCursorStyle(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== CURSOR_STYLE_KEY) return;
    unsavedCursorStyle = null;
    onChange();
  };
  window.addEventListener(CURSOR_STYLE_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CURSOR_STYLE_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTerminalCursorStyle() {
  return useSyncExternalStore(
    subscribeTerminalCursorStyle,
    loadTerminalCursorStyle,
    () => TERMINAL_CURSOR_STYLE_DEFAULT,
  );
}
