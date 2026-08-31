import { useState } from "react";
import { initials } from "../lib/format";

/** Google photo with a token-coloured initials fallback. */
export function Avatar({
  name,
  photoURL,
  size = 38,
}: {
  name?: string | null;
  photoURL?: string | null;
  size?: number;
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
      className="flex items-center justify-center rounded-full bg-accent-soft font-bold text-accent"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initials(name)}
    </span>
  );
}
