import { useCallback, useLayoutEffect, useRef } from "react";

/** Capture an account mount, so a late A → B → A completion remains stale. */
export function useAccountScope(uid: string | null | undefined) {
  const scope = useRef({ uid, mounted: false });
  useLayoutEffect(() => {
    const current = { uid, mounted: true };
    scope.current = current;
    return () => { current.mounted = false; };
  }, [uid]);
  return useCallback(() => {
    const current = scope.current;
    return () => current.mounted && scope.current === current;
  }, []);
}
