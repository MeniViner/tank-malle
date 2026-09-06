import { useEffect, useState } from "react";

/**
 * Whether the user has asked for reduced motion.
 *
 * `index.css` already neutralises CSS transitions under the media query, but a
 * component that decides in JS whether to animate needs to ask directly — and
 * the preference can change while the app is open, so the listener stays
 * attached rather than reading the value once at mount.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
