import { describe, expect, it, vi } from "vitest";
import { createBackController, EXIT_WINDOW_MS, registerBackLayer } from "./backNavigation";

function harness() {
  let time = 0;
  const promptExit = vi.fn();
  const clearExitPrompt = vi.fn();
  const minimize = vi.fn();
  const controller = createBackController({ promptExit, clearExitPrompt, minimize, now: () => time });
  return { controller, promptExit, clearExitPrompt, minimize, advance: (ms: number) => { time += ms; } };
}

describe("system Back", () => {
  it("closes nested overlays before screen steps and history, and drops layers closed through the UI", () => {
    const { controller, promptExit, minimize } = harness();
    const handled: string[] = [];
    const removeParent = registerBackLayer(() => { handled.push("parent"); removeParent(); });
    const removeStep = registerBackLayer(() => { handled.push("step"); removeStep(); }, "screen");
    const removeChild = registerBackLayer(() => { handled.push("child"); removeChild(); });
    const removeUiClosed = registerBackLayer(() => { handled.push("stale"); });
    const navigateBack = () => { handled.push("route"); };
    const destination = { navigateBack, canMinimize: true };

    try {
      removeUiClosed();
      controller.back(destination);
      controller.back(destination);
      controller.back(destination);
      controller.back(destination);

      expect(handled).toEqual(["child", "parent", "step", "route"]);
      expect(promptExit).not.toHaveBeenCalled();
      expect(minimize).not.toHaveBeenCalled();
    } finally {
      removeUiClosed();
      removeChild();
      removeParent();
      removeStep();
    }
  });

  it("waits for history traversal before accepting a second navigation request", () => {
    const { controller, promptExit } = harness();
    const navigateBack = vi.fn();
    controller.back({ navigateBack, canMinimize: false });
    controller.back({ navigateBack, canMinimize: false });
    controller.back({ canMinimize: true });
    expect(navigateBack).toHaveBeenCalledOnce();
    expect(promptExit).not.toHaveBeenCalled();

    controller.routeChanged();
    const returnHome = vi.fn();
    controller.back({ returnHome, canMinimize: false });
    expect(returnHome).toHaveBeenCalledOnce();
  });

  it("requires two root presses within the exit window and resets after suspension", () => {
    const { controller, promptExit, clearExitPrompt, minimize, advance } = harness();
    const root = { canMinimize: true };
    controller.back(root);
    expect(promptExit).toHaveBeenCalledOnce();
    expect(minimize).not.toHaveBeenCalled();

    advance(EXIT_WINDOW_MS);
    controller.back(root);
    expect(promptExit).toHaveBeenCalledTimes(2);
    expect(clearExitPrompt).toHaveBeenCalledOnce();
    expect(minimize).not.toHaveBeenCalled();

    controller.resetExit();
    advance(100);
    controller.back(root);
    expect(promptExit).toHaveBeenCalledTimes(3);
    expect(minimize).not.toHaveBeenCalled();

    advance(100);
    controller.back(root);
    expect(minimize).toHaveBeenCalledOnce();
    expect(clearExitPrompt).toHaveBeenCalledTimes(3);
  });

  it("allows overlays over a blocked form and leaves the form open until its guard clears", () => {
    const navigateBack = vi.fn();
    const promptExit = vi.fn();
    const minimize = vi.fn();
    let canLeave = false;
    const controller = createBackController({
      canLeave: () => canLeave, promptExit, clearExitPrompt: vi.fn(), minimize,
    });
    const closeLayer = vi.fn(() => removeLayer());
    const removeLayer = registerBackLayer(closeLayer);
    const destination = { navigateBack, canMinimize: true };
    try {
      controller.back(destination);
      expect(closeLayer).toHaveBeenCalledOnce();
      controller.back(destination);
      expect(navigateBack).not.toHaveBeenCalled();
      expect(promptExit).not.toHaveBeenCalled();
      expect(minimize).not.toHaveBeenCalled();
      canLeave = true;
      controller.back(destination);
      expect(navigateBack).toHaveBeenCalledOnce();
    } finally {
      removeLayer();
    }
  });
});
