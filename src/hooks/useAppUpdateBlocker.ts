import { useEffect } from 'react';
import { BEFORE_APP_UPDATE } from '../lib/appUpdates';

/** Refuse an app update while an editor's local save is incomplete. */
export function useAppUpdateBlocker(blocked: boolean): void {
  useEffect(() => {
    if (!blocked) return;
    const prevent = (event: Event) => event.preventDefault();
    window.addEventListener(BEFORE_APP_UPDATE, prevent);
    return () => window.removeEventListener(BEFORE_APP_UPDATE, prevent);
  }, [blocked]);
}
