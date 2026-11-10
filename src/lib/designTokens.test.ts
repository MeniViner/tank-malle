import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, DEFAULT_ACCENT } from "./accents";

/**
 * Design v3 stage 1 tokens. Ratios are recorded in
 * design/v3/evidence/stage-1/CONTRAST.md; this keeps them from drifting.
 */
const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const block = (selector: string) => {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
};
const token = (source: string, name: string) => source.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1]?.toUpperCase();

const LIGHT = { surface: "#FFFFFF", bg: "#F9F7F2" };
const DARK = { surface: "#282520", bg: "#1E1C18" };
const SPEC = {
  light: { "--cat-service": "#15130F", "--cat-ins1": "#2E5C8A", "--cat-ins2": "#86ACCF", "--cat-test": "#8C6A3F", "--cat-other": "#B9B2A4" },
  dark: { "--cat-service": "#D9D2C3", "--cat-ins1": "#6E9ED4", "--cat-ins2": "#A9C6E4", "--cat-test": "#B99263", "--cat-other": "#6F685D" },
};
const IDS = ["service", "ins1", "ins2", "test", "other"] as const;

describe("Design v3 tokens (§1, §4)", () => {
  const light = block(":root {");
  const dark = block('[data-theme="dark"] {');
  const autoDark = block(':root:not([data-theme="light"]):not([data-theme="dark"]) {');

  it("uses the softer light accent while the plate stays #FFC915", () => {
    expect(DEFAULT_ACCENT.light).toBe("#F3C54B");
    expect(DEFAULT_ACCENT.dark).toBe("#E6B417");
    expect(light).toContain("--accent: var(--accent-l, #F3C54B)");
    expect(token(light, "--lp")).toBe("#FFC915");
  });

  it("defines the radius scale and the category colours from the spec table in both themes", () => {
    expect(light).toMatch(/--r-lg:\s*20px/);
    expect(light).toMatch(/--r-md:\s*14px/);
    expect(light).toMatch(/--r-sm:\s*10px/);
    expect(light).toContain("--cat-fuel: var(--accent)");
    for (const [name, hex] of Object.entries(SPEC.light)) expect(token(light, name), name).toBe(hex);
    for (const source of [dark, autoDark]) {
      for (const [name, hex] of Object.entries(SPEC.dark)) expect(token(source, name), name).toBe(hex);
      expect(source).toContain("--shadow-card: none");
    }
  });

  it("never uses the light accent as text on light surfaces; ink on accent passes AA", () => {
    expect(contrastRatio("#F3C54B", LIGHT.surface)).toBeLessThan(3); // why the accent is a fill only
    expect(contrastRatio(DEFAULT_ACCENT.contrastLight, "#F3C54B")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(DEFAULT_ACCENT.contrastDark, "#E6B417")).toBeGreaterThanOrEqual(4.5);
    // Accent text only appears on the dark readout/ink blocks.
    expect(contrastRatio("#F3C54B", "#15130F")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#E6B417", "#282520")).toBeGreaterThanOrEqual(4.5);
  });

  it("draws category icons with at least 3:1 against their fill", () => {
    for (const [source, fills] of [[light, SPEC.light], [dark, SPEC.dark], [autoDark, SPEC.dark]] as const) {
      for (const id of IDS) {
        const on = token(source, `--cat-${id}-on`);
        expect(on, id).toBeTruthy();
        expect(contrastRatio(on!, fills[`--cat-${id}`]), id).toBeGreaterThanOrEqual(3);
      }
    }
    expect(contrastRatio(token(light, "--cat-fuel-on")!, "#F3C54B")).toBeGreaterThanOrEqual(3);
  });

  it("records which fills fall below 3:1 against the card (they rely on gaps, rings and text labels)", () => {
    const low = (fills: Record<string, string>, surface: string) =>
      Object.entries(fills).filter(([, hex]) => contrastRatio(hex, surface) < 3).map(([name]) => name);
    expect(low({ "--cat-fuel": "#F3C54B", ...SPEC.light }, LIGHT.surface)).toEqual(["--cat-fuel", "--cat-ins2", "--cat-other"]);
    expect(low({ "--cat-fuel": "#E6B417", ...SPEC.dark }, DARK.surface)).toEqual(["--cat-other"]);
  });
});
