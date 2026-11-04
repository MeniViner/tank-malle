import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

type RouteAddress = { pathname: string; search: string; hash: string };
function isDocumentSheetChange(before: RouteAddress | null, after: RouteAddress): boolean {
  if (!before || before.pathname !== after.pathname || after.pathname.replace(/\/+$/, "") !== "/vehicle"
    || before.hash !== after.hash || before.search === after.search) return false;
  // A combined deep link can reveal a different Vehicle subpage on close.
  if (["costs", "details", "prefs"].includes(new URLSearchParams(before.search).get("tab") ?? "")) return false;
  const pageParams = (search: string) => {
    const params = new URLSearchParams(search);
    params.delete("doc"); params.delete("vehicle"); params.sort();
    return params.toString();
  };
  return pageParams(before.search) === pageParams(after.search);
}

/** Start pushed screens at their heading; retain scroll when returning Back. */
export function RouteScroll() {
  const location = useLocation();
  const action = useNavigationType();
  const positions = useRef(new Map<string, number>());
  const previousLocation = useRef<RouteAddress | null>(null);
  useLayoutEffect(() => {
    const documentSheetChange = isDocumentSheetChange(previousLocation.current, location);
    previousLocation.current = location;
    const savedPositions = positions.current;
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    // These query parameters open a modal on the current Vehicle screen.
    // Its native dialog owns focus; a route reset would steal its restored opener.
    if (documentSheetChange) return () => {
      savedPositions.set(location.key, window.scrollY);
      history.scrollRestoration = previous;
    };
    const top = action === "POP" ? savedPositions.get(location.key) ?? 0 : 0;
    let focusedHeading: HTMLElement | null = null;
    const placeScreen = () => {
      if(location.hash && (action!=="POP" || !savedPositions.has(location.key))) {
        let target:HTMLElement|null=null;try{target=document.getElementById(decodeURIComponent(location.hash.slice(1)));}catch{return false;}
        if(!target)return false;
        target.scrollIntoView({block:"start",behavior:"instant"});
        if(!target.hasAttribute("tabindex")){target.tabIndex=-1;focusedHeading=target;}
        target.focus({preventScroll:true});return true;
      }
      window.scrollTo({ top, behavior: "instant" });
      const heading = document.querySelector<HTMLElement>("main h1");
      if (heading && action !== "POP") {
        if (!heading.hasAttribute("tabindex")) { heading.tabIndex = -1; focusedHeading = heading; }
        heading.focus({ preventScroll: true });
      }
      return Boolean(heading);
    };
    const hasHeading = placeScreen();
    // Lazy routes can render after this component's layout effect.
    const observer = new MutationObserver(() => {
      if (placeScreen()) observer.disconnect();
    });
    if (!hasHeading) observer.observe(document.body, { childList: true, subtree: true });
    const timeout = setTimeout(() => observer.disconnect(), 5000);
    return () => {
      savedPositions.set(location.key, window.scrollY);
      focusedHeading?.removeAttribute("tabindex");
      observer.disconnect(); clearTimeout(timeout); history.scrollRestoration = previous;
    };
  }, [location, action]);
  return null;
}
