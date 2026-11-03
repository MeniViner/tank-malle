/** The six curated Plate accents. Licence plates always use --lp. */
export interface Accent {
  id: string;
  label: string;
  light: string;
  dark: string;
  softLight: string;
  softDark: string;
  contrastLight: string;
  contrastDark: string;
}
const PALETTE = [
  ["plate", "צהוב לוחית", "#FFC915", "#E6B417"],
  ["mint", "מנטה", "#4FD1A5", "#46BD95"],
  ["sky", "תכלת", "#78C2F3", "#6FB2DF"],
  ["peach", "אפרסק", "#FF9F6E", "#E8906A"],
  ["lilac", "לילך", "#C8A8F0", "#B59AD8"],
  ["lime", "ליים", "#CFE24E", "#BACB48"],
] as const;
export const ACCENTS: Accent[] = PALETTE.map(([id, label, light, dark]) => ({
  id, label, light, dark,
  softLight: `color-mix(in srgb, ${light} 17%, #F9F7F2)`,
  softDark: `color-mix(in srgb, ${dark} 14%, #1E1C18)`,
  contrastLight: "#111111", contrastDark: "#111111",
}));
export const DEFAULT_ACCENT = ACCENTS[0];
export function findAccent(id: string | undefined | null): Accent | null {
  return ACCENTS.find((accent) => accent.id === id) ?? null;
}
/** Legacy palette IDs and custom colours intentionally resolve to plate. */
export function resolveAccent(id: string | undefined | null): Accent {
  return findAccent(id) ?? DEFAULT_ACCENT;
}
export function luminance(hex: string): number {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join("") : raw;
  const channel = (offset: number) => {
    const value = Number.parseInt(full.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}
export function contrastRatio(a: string, b: string): number {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
export function applyAccent(accent: Accent): void {
  const style = document.documentElement.style;
  style.setProperty("--accent-l", accent.light);
  style.setProperty("--accent-d", accent.dark);
  style.setProperty("--accent-soft-l", accent.softLight);
  style.setProperty("--accent-soft-d", accent.softDark);
  style.setProperty("--accent-contrast-l", "#111111");
  style.setProperty("--accent-contrast-d", "#111111");
}
