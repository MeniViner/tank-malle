import { memo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { getModalAtmosphereHost, subscribeModalLayers } from "./modalLayers";
const TICKS = Array.from({ length: 72 }, (_, index) => {
  const angle = index * Math.PI / 36;
  const inner = index % 3 === 0 ? 168 : 176;
  return { x1: 210 + Math.sin(angle) * inner, y1: 210 - Math.cos(angle) * inner,
    x2: 210 + Math.sin(angle) * 186, y2: 210 - Math.cos(angle) * 186 };
});
function variantFor(route: string): string {
  if (route.includes("saved")) return "none";
  if (route.startsWith("/history")) return "journal";
  if (route.startsWith("/stats")) return "insights";
  if (/^\/(maintenance|vehicle|settings\/vehicles)/.test(route)) return "vehicle";
  if (/^\/(fillup|service|expense)/.test(route)) return "entry";
  if (route.startsWith("/legal")) return "legal";
  if (/^\/(account|settings|notifications|feedback|admin)/.test(route)) return "account";
  return "home";
}
const serverAtmosphereHost = () => null;
/** One static SVG: full-screen native entry dialogs can host the same atmosphere. */
export const Atmosphere = memo(function Atmosphere({ route }: { route: string }) {
  const host = useSyncExternalStore(subscribeModalLayers, getModalAtmosphereHost, serverAtmosphereHost);
  const content = <div className="tm-atmosphere" data-variant={variantFor(host?.dataset.atmosphereRoute ?? route)} aria-hidden="true" data-testid="app-atmosphere">
    <span className="tm-atmosphere-wash" />
    <span className="tm-atmosphere-glow" />
    <svg className="tm-atmosphere-dial" viewBox="0 0 420 420" fill="none">
      {[96, 140, 196].map((radius) => <circle key={radius} cx="210" cy="210" r={radius} />)}
      {TICKS.map((tick, index) => <line key={index} {...tick} strokeWidth={index % 3 === 0 ? 1.5 : 1} />)}
    </svg>
  </div>;
  return host ? createPortal(content, host) : content;
});
