/**
 * Accent palette.
 *
 * Each accent ships an explicit dark variant rather than a computed one: the
 * dark palette sits on a very dark surface, so the light accent would fail AA
 * contrast for text. `softLight`/`softDark` are the tinted chip backgrounds.
 */

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

export const ACCENTS: Accent[] = [
  {
    id: "teal",
    label: "טורקיז נפט",
    light: "#0E7A6B",
    dark: "#3FBFA8",
    softLight: "#E3F0ED",
    softDark: "#123A34",
    contrastLight: "#FFFFFF",
    contrastDark: "#0B1613",
  },
  {
    id: "blue",
    label: "כחול ים",
    light: "#1D5FA8",
    dark: "#6BA6E8",
    softLight: "#E4EDF8",
    softDark: "#152C44",
    contrastLight: "#FFFFFF",
    contrastDark: "#0A1520",
  },
  {
    id: "violet",
    label: "סגול",
    light: "#6D4AA8",
    dark: "#A98BE6",
    softLight: "#EDE8F7",
    softDark: "#2A2140",
    contrastLight: "#FFFFFF",
    contrastDark: "#140F1F",
  },
  {
    id: "pink",
    label: "ורוד",
    light: "#B03A72",
    dark: "#E886B4",
    softLight: "#F8E6EF",
    softDark: "#3D1C2C",
    contrastLight: "#FFFFFF",
    contrastDark: "#1D0D15",
  },
  {
    id: "clay",
    label: "אדום חמרה",
    light: "#B33A2B",
    dark: "#E8887A",
    softLight: "#F8E7E4",
    softDark: "#3D1D18",
    contrastLight: "#FFFFFF",
    contrastDark: "#1D0C09",
  },
  {
    id: "orange",
    label: "כתום",
    light: "#B4620E",
    dark: "#E8A45C",
    softLight: "#F9EDE0",
    softDark: "#3D2A11",
    contrastLight: "#FFFFFF",
    contrastDark: "#1D1305",
  },
  {
    id: "olive",
    label: "ירוק זית",
    light: "#4A7A22",
    dark: "#8FC45C",
    softLight: "#EAF2E1",
    softDark: "#22350F",
    contrastLight: "#FFFFFF",
    contrastDark: "#0D1706",
  },
  {
    id: "charcoal",
    label: "אפור פחם",
    light: "#44544C",
    dark: "#A3B8AD",
    softLight: "#E9EDEB",
    softDark: "#28332E",
    contrastLight: "#FFFFFF",
    contrastDark: "#101815",
  },
];

export const DEFAULT_ACCENT = ACCENTS[0];

export function findAccent(id: string | undefined | null): Accent | null {
  if (!id) return null;
  return ACCENTS.find((a) => a.id === id) ?? null;
}

/* ---------- custom accent derivation ---------- */

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

/** Relative luminance per WCAG 2.1. */
export function luminance(hex: string): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

function mix(hex: string, target: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(hex);
  const [r2, g2, b2] = hexToRgb(target);
  return rgbToHex(
    r1 + (r2 - r1) * amount,
    g1 + (g2 - g1) * amount,
    b1 + (b2 - b1) * amount,
  );
}

/** Pick whichever of white/near-black clears AA against the accent fill. */
function bestContrast(hex: string): string {
  return contrastRatio(hex, "#FFFFFF") >= contrastRatio(hex, "#0B1613")
    ? "#FFFFFF"
    : "#0B1613";
}

/**
 * Derive a full accent from a single user-picked colour: lighten it for dark
 * mode until it clears AA (4.5:1) against the dark surface, and build the two
 * soft tints from the same hue.
 */
export function deriveAccent(hex: string, label = "מותאם אישית"): Accent {
  const light = hex.toUpperCase();

  let dark = light;
  let steps = 0;
  while (contrastRatio(dark, "#182019") < 4.5 && steps < 20) {
    dark = mix(dark, "#FFFFFF", 0.12);
    steps += 1;
  }

  return {
    id: "custom",
    label,
    light,
    dark,
    softLight: mix(light, "#FFFFFF", 0.88),
    softDark: mix(dark, "#0E1512", 0.78),
    contrastLight: bestContrast(light),
    contrastDark: bestContrast(dark),
  };
}

/** Write an accent onto <html> as the theme-independent seed variables. */
export function applyAccent(accent: Accent): void {
  const style = document.documentElement.style;
  style.setProperty("--accent-l", accent.light);
  style.setProperty("--accent-d", accent.dark);
  style.setProperty("--accent-soft-l", accent.softLight);
  style.setProperty("--accent-soft-d", accent.softDark);
  style.setProperty("--accent-contrast-l", accent.contrastLight);
  style.setProperty("--accent-contrast-d", accent.contrastDark);
}
