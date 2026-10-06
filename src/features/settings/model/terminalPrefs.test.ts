// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadTerminalFontFamily,
  loadTerminalCursorStyle,
  normalizeTerminalCursorStyle,
  saveTerminalCursorStyle,
  subscribeTerminalCursorStyle,
  loadTerminalFontSize,
  normalizeTerminalFontSize,
  resolveTerminalFontFamily,
  saveTerminalFontFamily,
  saveTerminalFontSize,
  subscribeTerminalFont,
  TERMINAL_FONT_FAMILY_DEFAULT,
} from "./terminalPrefs";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  // Clear the in-memory fallback too.
  saveTerminalFontFamily("");
  saveTerminalFontSize(12);
  saveTerminalCursorStyle("bar");
  localStorage.clear();
});

describe("terminal cursor style", () => {
  it("defaults to bar and rejects unsupported values", () => {
    expect(loadTerminalCursorStyle()).toBe("bar");
    for (const value of [null, "invalid", "", 1]) {
      expect(normalizeTerminalCursorStyle(value)).toBe("bar");
    }
    localStorage.setItem("monocode.terminalCursorStyle", "invalid");
    expect(loadTerminalCursorStyle()).toBe("bar");
  });

  it("persists all supported styles before notifying and unsubscribes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTerminalCursorStyle(listener);
    for (const style of ["block", "underline", "bar"] as const) {
      listener.mockImplementation(() =>
        expect(loadTerminalCursorStyle()).toBe(style),
      );
      saveTerminalCursorStyle(style);
      expect(localStorage.getItem("monocode.terminalCursorStyle")).toBe(style);
    }
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    saveTerminalCursorStyle("block");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("keeps the selection usable when storage fails", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    saveTerminalCursorStyle("underline");
    expect(loadTerminalCursorStyle()).toBe("underline");
  });

  it("follows other windows and resets to bar when storage is cleared", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTerminalCursorStyle(listener);
    localStorage.setItem("monocode.terminalCursorStyle", "block");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "monocode.terminalCursorStyle" }),
    );
    expect(loadTerminalCursorStyle()).toBe("block");
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(listener).toHaveBeenCalledTimes(1);
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(loadTerminalCursorStyle()).toBe("bar");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});

describe("terminal font preferences", () => {
  it("defaults to the existing 12px terminal font and quotes custom families", () => {
    expect(loadTerminalFontSize()).toBe(12);
    expect(loadTerminalFontFamily()).toBe("");
    expect(resolveTerminalFontFamily(" ")).toBe(TERMINAL_FONT_FAMILY_DEFAULT);
    expect(resolveTerminalFontFamily(" JetBrains Mono ")).toBe(
      `"JetBrains Mono", ${TERMINAL_FONT_FAMILY_DEFAULT}`,
    );
  });

  it("persists before notifying and preserves spaces while editing", () => {
    const listener = vi.fn(() => {
      expect(loadTerminalFontFamily()).toBe("JetBrains ");
    });
    const unsubscribe = subscribeTerminalFont(listener);
    saveTerminalFontFamily("JetBrains ");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("monocode.terminalFontFamily")).toBe(
      "JetBrains ",
    );
    unsubscribe();
    saveTerminalFontSize(16);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(loadTerminalFontSize()).toBe(16);
  });

  it("clamps, rounds and rejects invalid sizes", () => {
    expect(normalizeTerminalFontSize(9)).toBe(10);
    expect(normalizeTerminalFontSize(100)).toBe(24);
    expect(normalizeTerminalFontSize(15.6)).toBe(16);
    expect(normalizeTerminalFontSize(NaN)).toBe(12);
    expect(normalizeTerminalFontSize(Infinity)).toBe(12);
    localStorage.setItem("monocode.terminalFontSize", "invalid");
    expect(loadTerminalFontSize()).toBe(12);
    saveTerminalFontSize(100);
    expect(loadTerminalFontSize()).toBe(24);
  });

  it("keeps changes usable when storage fails", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    saveTerminalFontFamily("Fira Code");
    saveTerminalFontSize(18);
    expect(loadTerminalFontFamily()).toBe("Fira Code");
    expect(loadTerminalFontSize()).toBe(18);
  });

  it("notifies on other-window changes and storage clear, ignoring unrelated keys", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTerminalFont(listener);
    localStorage.setItem("monocode.terminalFontSize", "20");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "monocode.terminalFontSize" }),
    );
    expect(loadTerminalFontSize()).toBe(20);
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(listener).toHaveBeenCalledTimes(1);
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(loadTerminalFontSize()).toBe(12);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
