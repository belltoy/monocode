// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TerminalView } from "./TerminalView";
import { killPty, resizePty, spawnPty } from "../../../platform/tauri/pty";
import { fitTerminal } from "../model/terminalLayout";
import {
  saveTerminalFontFamily,
  saveTerminalCursorStyle,
  saveTerminalFontSize,
  TERMINAL_FONT_FAMILY_DEFAULT,
} from "../../settings/model/terminalPrefs";

const terminals = vi.hoisted(
  () =>
    [] as Array<{
      options: Record<string, unknown>;
      dispose: ReturnType<typeof vi.fn>;
    }>,
);

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: Record<string, unknown>;
    cols = 80;
    rows = 24;
    dispose = vi.fn();
    buffer = {
      active: { type: "normal" },
      onBufferChange: () => ({ dispose: vi.fn() }),
    };
    parser = { registerOscHandler: () => ({ dispose: vi.fn() }) };
    constructor(options: Record<string, unknown>) {
      this.options = options;
      terminals.push(this);
    }
    open() {}
    focus() {}
    attachCustomKeyEventHandler() {}
    attachCustomWheelEventHandler() {}
    onData() {
      return { dispose: vi.fn() };
    }
    onRender() {
      return { dispose: vi.fn() };
    }
  },
}));
vi.mock("../../../platform/tauri/pty", () => ({
  spawnPty: vi.fn(async () => {}),
  killPty: vi.fn(async () => {}),
  resizePty: vi.fn(async () => {}),
  subscribePty: vi.fn(() => vi.fn()),
  writePty: vi.fn(async () => {}),
  getPtyStatus: vi.fn(async () => ({})),
}));
vi.mock("../model/terminalLayout", () => ({
  fitTerminal: vi.fn((term: { options: { fontSize: number } }) => ({
    cols: Math.floor(960 / term.options.fontSize),
    rows: Math.floor(288 / term.options.fontSize),
  })),
  resetGridStretch: vi.fn(),
  applyTerminalChrome: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;

async function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  await act(async () => pending.forEach((callback) => callback(0)));
}

beforeEach(() => {
  vi.clearAllMocks();
  terminals.length = 0;
  localStorage.clear();
  frames = new Map();
  let frameId = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("updates open terminals and PTY size without restarting their processes", async () => {
  await act(async () =>
    root.render(
      createElement(TerminalView, {
        id: "font-test",
        cwd: "/repo",
        active: true,
      }),
    ),
  );
  await flushFrames();
  expect(terminals).toHaveLength(1);
  expect(terminals[0].options.fontSize).toBe(12);
  expect(terminals[0].options.cursorStyle).toBe("bar");
  expect(terminals[0].options.fontFamily).toBe(TERMINAL_FONT_FAMILY_DEFAULT);
  expect(spawnPty).toHaveBeenCalledTimes(1);

  await act(async () => {
    saveTerminalFontFamily("JetBrains Mono");
    saveTerminalFontSize(18);
  });
  await flushFrames();
  expect(terminals[0].options.fontFamily).toBe(
    `"JetBrains Mono", ${TERMINAL_FONT_FAMILY_DEFAULT}`,
  );
  expect(terminals[0].options.fontSize).toBe(18);
  expect(fitTerminal).toHaveBeenCalled();
  expect(resizePty).toHaveBeenLastCalledWith("font-test", 53, 16);
  expect(terminals).toHaveLength(1);
  expect(spawnPty).toHaveBeenCalledTimes(1);
  expect(killPty).not.toHaveBeenCalled();
  expect(terminals[0].dispose).not.toHaveBeenCalled();

  await act(async () => root.unmount());
  await act(async () => saveTerminalFontSize(20));
  expect(terminals[0].options.fontSize).toBe(18);
});

it("loads saved fonts when creating a new terminal", async () => {
  saveTerminalCursorStyle("underline");
  saveTerminalFontFamily("Fira Code");
  saveTerminalFontSize(16);
  await act(async () =>
    root.render(
      createElement(TerminalView, {
        id: "saved-font-test",
        cwd: "/repo",
        active: true,
      }),
    ),
  );
  expect(terminals[0].options.fontSize).toBe(16);
  expect(terminals[0].options.cursorStyle).toBe("underline");
  expect(terminals[0].options.fontFamily).toBe(
    `"Fira Code", ${TERMINAL_FONT_FAMILY_DEFAULT}`,
  );
});

it("updates cursor shape without restarting or resizing the terminal", async () => {
  await act(async () =>
    root.render(
      createElement(TerminalView, {
        id: "cursor-test",
        cwd: "/repo",
        active: true,
      }),
    ),
  );
  await flushFrames();
  vi.mocked(fitTerminal).mockClear();
  vi.mocked(resizePty).mockClear();
  await act(async () => saveTerminalCursorStyle("block"));
  expect(terminals[0].options.cursorStyle).toBe("block");
  await act(async () => saveTerminalCursorStyle("underline"));
  expect(terminals[0].options.cursorStyle).toBe("underline");
  expect(terminals).toHaveLength(1);
  expect(spawnPty).toHaveBeenCalledTimes(1);
  expect(killPty).not.toHaveBeenCalled();
  expect(fitTerminal).not.toHaveBeenCalled();
  expect(resizePty).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  await act(async () => saveTerminalCursorStyle("bar"));
  expect(terminals[0].options.cursorStyle).toBe("underline");
});
