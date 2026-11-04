import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ACCENTS, applyAccent, resolveAccent, type Accent } from "../lib/accents";
import type { ThemeSetting } from "../lib/types";
interface ThemeContextValue {
  theme: ThemeSetting;
  accent: Accent;
  accentId: string;
  customAccent: string | null;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: ThemeSetting) => void;
  setAccent: (id: string, legacyCustomHex?: string | null) => void;
  accents: Accent[];
}
const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_KEY = "tm.theme";
const ACCENT_KEY = "tm.accent";
function readStoredTheme(): ThemeSetting {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch { /* storage unavailable */ }
  return "system";
}
function readStoredAccent(): string {
  try {
    const raw = localStorage.getItem(ACCENT_KEY);
    if (raw) return resolveAccent((JSON.parse(raw) as { id?: string }).id).id;
  } catch { /* storage unavailable */ }
  return "plate";
}
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeSetting>(readStoredTheme);
  const [accentId, setAccentId] = useState(readStoredAccent);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const accent = resolveAccent(accentId);
  const setAccent = useCallback((id: string) => setAccentId(resolveAccent(id).id), []);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable */ }
  }, [theme]);
  useEffect(() => {
    applyAccent(accent);
    try { localStorage.setItem(ACCENT_KEY, JSON.stringify({ ...accent, custom: null })); }
    catch { /* storage unavailable */ }
  }, [accent]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const resolvedTheme: "light" | "dark" = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  useEffect(() => {
    document.querySelectorAll('meta[name="theme-color"]').forEach((tag) =>
      tag.setAttribute("content", resolvedTheme === "dark" ? "#1E1C18" : "#F9F7F2"));
  }, [resolvedTheme]);
  const value = useMemo<ThemeContextValue>(() => ({
    theme, accent, accentId, customAccent: null, resolvedTheme,
    accents: ACCENTS, setTheme, setAccent,
  }), [theme, accent, accentId, resolvedTheme, setAccent]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
