import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import type { SpotlightItem } from "../../lib/home/spotlight";
import { NumericText } from "../Fmt";
import { DesignIcon } from "../icons";
import { SpotlightCard } from "../SpotlightCard";

export function HomeSpotlight({ items, onOpen, onDismiss, onEmpty }: {
  items: SpotlightItem[]; onOpen: (item: SpotlightItem) => void; onDismiss: (id: string) => void; onEmpty: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const region = useRef<HTMLElement>(null);
  const restoreFocus = useRef(false);
  const [index, setIndex] = useState(0);
  const [interacted, setInteracted] = useState(false);
  const [visible, setVisible] = useState(true);
  const reduced = useReducedMotion();
  const ids = items.map(item => item.id).join("|");
  const count = items.length;
  const hasItems = count > 0;
  const active = Math.min(index, Math.max(0, count - 1));

  useEffect(() => {
    const element = region.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .4 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasItems]);

  useLayoutEffect(() => {
    const element = track.current;
    if (element) element.scrollTo({ left: -active * (element.clientWidth + 12), behavior: "instant" });
    if (restoreFocus.current) {
      restoreFocus.current = false;
      if (!count) onEmpty();
      else element?.querySelectorAll<HTMLButtonElement>(".tm-spotlight-open")[active]?.focus({ preventScroll: true });
    }
    // Item identity changes realign the selected card; ordinary scrolling does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  useEffect(() => {
    if (count < 2 || interacted || reduced || !visible) return;
    const timer = window.setInterval(() => {
      const element = track.current;
      if (!element || document.visibilityState !== "visible") return;
      element.scrollTo({ left: -((active + 1) % count) * (element.clientWidth + 12), behavior: "smooth" });
    }, 7000);
    return () => window.clearInterval(timer);
  }, [active, count, ids, interacted, reduced, visible]);

  if (!count) return null;
  const stop = () => setInteracted(true);
  return <section ref={region} className="home-spotlight" aria-label="מה חשוב עכשיו" aria-roledescription="קרוסלה"
    data-testid="home-spotlight" onPointerDown={stop} onFocusCapture={stop} onKeyDown={stop} onWheel={stop}>
    <div ref={track} className="home-spotlight-track" data-testid="spotlight-track" onScroll={() => {
      const element = track.current;
      if (element) setIndex(Math.min(count - 1, Math.round(Math.abs(element.scrollLeft) / (element.clientWidth + 12))));
    }}>
      {items.map((item, position) => <div key={item.id} className="home-spotlight-slide" role="group"
        aria-roledescription="שקופית" aria-label={`${position + 1} מתוך ${count}`}>
        <SpotlightCard {...item} itemType={item.id === "writes-attention" ? "write" : item.id.split(":")[0]}
          icon={<DesignIcon name={item.icon} />} title={<NumericText>{item.title}</NumericText>}
          body={<NumericText>{item.body}</NumericText>} onOpen={() => onOpen(item)}
          dismissLabel={`הסתרת הכרטיס: ${item.title}`} onDismiss={item.sticky ? undefined : () => {
            stop(); restoreFocus.current = true; onDismiss(item.id);
          }} />
      </div>)}
    </div>
    {count > 1 ? <div className="home-spotlight-dots" data-testid="spotlight-dots" aria-hidden="true">
      {items.map((item, position) => <i key={item.id} data-active={position === active} />)}
    </div> : null}
  </section>;
}
