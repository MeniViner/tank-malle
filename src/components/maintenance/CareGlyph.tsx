import type { ReactNode } from 'react';
/** Small outline symbols shared by the entry menu and the activity picker. */
export function CareGlyph({kind,size=24}:{kind:string;size?:number}) {
  const icons:Record<string,ReactNode>={
    tires:<><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="m8 5 1 3m7-3-1 3m4 7-3-1m-1 5-1-3m-6 3 1-3m-4-1 3-1"/></>,
    brakes:<><circle cx="11" cy="12" r="8"/><circle cx="11" cy="12" r="2"/><path d="M17 6h3v12h-3M8 7h.01M6 11h.01M7 16h.01M12 18h.01"/></>,
    battery:<><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M7 6V3h3v3m4 0V3h3v3M6 13h4m-2-2v4m6-2h4"/></>,
    oil:<><path d="M12 3c-2 4-7 7-7 12a7 7 0 0 0 14 0c0-5-5-8-7-12Z"/><path d="M8 15a4 4 0 0 0 4 4"/></>,
    insurance:<><path d="m12 3 8 3v6c0 5-5 8-8 10-3-2-8-5-8-10V6Z"/><path d="m8 12 3 3 5-6"/></>,
    registration:<><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8m-8 4h5m-5 4h3m4 0 1 1 2-3"/></>,
    parking:<><rect x="4" y="3" width="16" height="18" rx="4"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/></>,
    toll:<><path d="m8 3-4 18m12-18 4 18M12 4v3m0 4v3m0 4v3"/></>,
    wash:<><path d="m6 12 2-5h8l2 5m-13 0h14v7H5Zm2 7v2m10-2v2M8 15h.01M16 15h.01M4 3v2m8-4v2m8 0v2"/></>,
    refund:<><path d="M7 7H3V3m0 4a9 9 0 1 1-1 10"/><path d="M12 7v10m3-8h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9"/></>,
    expense:<><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18m-6 6h3"/></>,
    reminder:<><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16m-11 5 2 2 4-4"/></>,
    custom:<path d="M12 5v14M5 12h14"/>,
    periodic:<><path d="m15 3-3 3 3 3 3-3a6 6 0 0 1-7 8l-6 6-3-3 6-6a6 6 0 0 1 7-8Z"/></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{icons[kind]??icons.periodic}</svg>;
}
