import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ACCENTS,
  DEFAULT_ACCENT,
  applyAccent,
  deriveAccent,
  findAccent,
  type Accent,
} from "../lib/accents";
import type { ThemeSetting } from "../lib/types";

interface ThemeContextValue {
  theme: ThemeSetting;
  accent: Accent;
  accentId: string;
  customAccent: string | null;
  /** The palette actually in effect right now. */
  resolvedTheme: "light" | "dark";
  setTheme: (theme: ThemeSetting) => void;
  setAccent: (id: string, customHex?: string | null) => void;
  accents: Accent[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_KEY = "tm.theme";
const ACCENT_KEY = "tm.accent";

function readStoredTheme(): ThemeSetting {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

function readStoredAccent(): { id: string; custom: string | null } {
  try {
    const raw = localStorage.getItem(ACCENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { id?: string; custom?: string | null };
      return { id: parsed.id ?? DEFAULT_ACCENT.id, custom: parsed.custom ?? null };
    }
  } catch {
    /* storage unavailable */
  }
  return { id: DEFAULT_ACCENT.id, custom: null };
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeSetting>(readStoredTheme);
  const stored = readStoredAccent();
  const [accentId, setAccentId] = useState(stored.id);
  const [customAccent, setCustomAccent] = useState<string | null>(stored.custom);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  const accent = useMemo<Accent>(() => {
    if (accentId === "custom" && customAccent) return deriveAccent(customAccent);
    return findAccent(accentId) ?? DEFAULT_ACCENT;
  }, [accentId, customAccent]);

  // "system" deliberately stamps no attribute, so the prefers-color-scheme
  // block in index.css stays in charge and follows the OS live.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);

    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  useEffect(() => {
    applyAccent(accent);
    try {
      localStorage.setItem(
        ACCENT_KEY,
        JSON.stringify({
          id: accentId,
          custom: customAccent,
          light: accent.light,
          dark: accent.dark,
          softLight: accent.softLight,
          softDark: accent.softDark,
          contrastLight: accent.contrastLight,
          contrastDark: accent.contrastDark,
        }),
      );
    } catch {
      /* storage unavailable */
    }
  }, [accent, accentId, customAccent]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme: "light" | "dark" =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;

  // Keep the browser chrome (iOS status bar, Android address bar) in step.
  useEffect(() => {
    const color = resolvedTheme === "dark" ? "#0E1512" : "#F3F6F4";
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((tag) => tag.setAttribute("content", color));
  }, [resolvedTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      accent,
      accentId,
      customAccent,
      resolvedTheme,
      accents: ACCENTS,
      setTheme: setThemeState,
      setAccent: (id, hex) => {
        setAccentId(id);
        if (id === "custom") setCustomAccent(hex ?? customAccent ?? DEFAULT_ACCENT.light);
      },
    }),
    [theme, accent, accentId, customAccent, resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
