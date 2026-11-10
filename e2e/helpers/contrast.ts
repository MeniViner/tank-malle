import type { Page } from "@playwright/test";

/** WCAG contrast of every visible text node in `root` against its first opaque ancestor background. */
export async function lowContrast(page: Page, selector: string) {
  return page.locator(selector).evaluate(root => {
    const parse = (value: string) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const [r, g, b, a = 1] = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const channel = (v: number) => { const c = v / 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
      return .2126 * channel(r) + .7152 * channel(g) + .0722 * channel(b);
    };
    const background = (element: Element | null): { r: number; g: number; b: number } => {
      for (let node = element; node; node = node.parentElement) {
        const color = parse(getComputedStyle(node).backgroundColor);
        if (color && color.a >= .99) return color;
      }
      return parse(getComputedStyle(document.body).backgroundColor) ?? { r: 255, g: 255, b: 255 };
    };
    const failures: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement!;
      if (!node.textContent?.trim() || element.closest("[aria-hidden='true'], .sr-only, svg")) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none" || element.getClientRects().length === 0) continue;
      const fg = parse(style.color); if (!fg) continue;
      const bg = background(element);
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      const ratio = (hi + .05) / (lo + .05);
      if (ratio < 4.5) failures.push(`${node.textContent.trim().slice(0, 30)} ${ratio.toFixed(2)}`);
    }
    return failures;
  });
}
