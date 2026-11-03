import type { ReactNode } from "react";
import { ChevronStart, CloseIcon } from "./icons";

export interface SpotlightCardProps {
  id: string;
  tone: "info" | "warn" | "danger" | "better";
  icon: ReactNode;
  title: ReactNode;
  body: ReactNode;
  onOpen: () => void;
  onDismiss?: () => void;
  dismissLabel?: string;
  itemType?: string;
}

/** Dismiss and open are separate controls; sticky items simply omit onDismiss. */
export function SpotlightCard({ id, tone, icon, title, body, onOpen, onDismiss, dismissLabel = "הסתרת הכרטיס", itemType }: SpotlightCardProps) {
  return <article className={`tm-spotlight-card tm-spotlight-${tone}`} data-spotlight-id={id} data-spotlight-type={itemType} data-testid="spotlight-card">
    <button type="button" className="tm-spotlight-open" onClick={onOpen}>
      <span className="tm-spotlight-icon" aria-hidden="true">{icon}</span>
      <span className="tm-spotlight-copy"><span className="tm-spotlight-title">{title}</span><span className="tm-spotlight-body">{body}</span></span>
      {!onDismiss ? <ChevronStart size={20} /> : null}
    </button>
    {onDismiss ? <button type="button" className="tm-icon-button tm-spotlight-dismiss" data-testid={`spotlight-dismiss-${id}`} aria-label={dismissLabel} onClick={onDismiss}>
      <CloseIcon size={18} />
    </button> : null}
  </article>;
}
