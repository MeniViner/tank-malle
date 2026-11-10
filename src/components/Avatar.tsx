import { useState } from "react";
import { initials } from "../lib/format";

/** Google photo with a token-coloured initials fallback. `surface` is the v3 Home header look (initial on --surface). */
export function Avatar({
  name,
  photoURL,
  size = 38,
  surface = false,
}: {
  name?: string | null;
  photoURL?: string | null;
  size?: number;
  surface?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (photoURL && !failed) {
    return (
      <img
        src={photoURL}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={surface ? "tm-avatar-initial flex items-center justify-center rounded-full bg-surface text-ink" : "flex items-center justify-center rounded-full bg-accent-soft font-bold text-ink"}
      style={{ width: size, height: size, fontSize: Math.round(size * (surface ? 0.55 : 0.4)) }}
    >
      {initials(name)}
    </span>
  );
}
