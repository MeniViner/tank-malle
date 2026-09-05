import { useState } from "react";

/**
 * Brand marks for the station list.
 *
 * Israel's register is dominated by a handful of chains, and a row of
 * identical grey pins made a list of 1,250 stations read as one block.
 *
 * Each brand resolves to a file in `public/brands/<slug>.svg` (a `.png` also
 * works — see `SOURCES` below). Those files are the companies' own logos and
 * are NOT in this repository: they are third-party trademarks, and drawing an
 * imitation from memory would ship a wrong logo under a real company's name.
 * Drop the official file in with the slug below and it appears everywhere the
 * brand does; until then the row shows the coloured monogram, which is
 * legible and honest about being ours.
 *
 * The register spells a company both in the `c` field and at the start of the
 * station name ("סונול אלמיג"), so either one identifies the brand.
 */

interface Brand {
  /** File name under public/brands, without the extension. */
  slug: string;
  match: RegExp;
  /** Fallback monogram: two or three Hebrew letters. */
  short: string;
  /** Fallback badge background. */
  background: string;
  /** Text on that background — checked for contrast, not guessed. */
  color: string;
}

const BRANDS: Brand[] = [
  { slug: "paz", match: /^פז/, short: "פז", background: "#F2A413", color: "#241703" },
  { slug: "delek", match: /^דלק/, short: "דלק", background: "#D8232A", color: "#FFFFFF" },
  { slug: "sonol", match: /^סונול/, short: "סונ", background: "#0B5FA5", color: "#FFFFFF" },
  {
    slug: "dor-alon",
    match: /^דור[\s-]?אלון|^אלונית/,
    short: "דור",
    background: "#17795E",
    color: "#FFFFFF",
  },
  { slug: "ten", match: /^טן/, short: "טן", background: "#1F93C6", color: "#FFFFFF" },
  { slug: "mika", match: /^מיקה/, short: "מיקה", background: "#6D4AA8", color: "#FFFFFF" },
  { slug: "tapuz", match: /^תפוז/, short: "תפוז", background: "#E4711C", color: "#FFFFFF" },
  { slug: "sadash", match: /^סד/, short: "סד״ש", background: "#45566B", color: "#FFFFFF" },
  { slug: "yaad", match: /^יעד/, short: "יעד", background: "#8A6A2F", color: "#FFFFFF" },
];

/** Where to get each logo, for whoever fills `public/brands/` in. */
export const BRAND_SOURCES = BRANDS.map((brand) => brand.slug);

/** The brand for a station, from its company field or its name. */
function brandFor(brand?: string | null, name?: string | null): Brand | null {
  const candidates = [brand?.trim(), name?.trim()].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const found = BRANDS.find((entry) => entry.match.test(candidate));
    if (found) return found;
  }
  return null;
}

/**
 * A station's brand badge: the official logo when the file is present, the
 * monogram otherwise, and a neutral tile for the independents — of which the
 * register holds a couple of hundred, so "no brand" is a normal state.
 */
export function StationBrandMark({
  brand,
  name,
  size = 34,
}: {
  brand?: string | null;
  name?: string | null;
  size?: number;
}) {
  const entry = brandFor(brand, name);
  // A missing file is the expected case until the logos are added, so the
  // fallback is a state change rather than a broken-image icon.
  const [logoFailed, setLogoFailed] = useState(false);
  const fallback = (brand?.trim() || name?.trim() || "").slice(0, 2) || "—";

  if (entry && !logoFailed) {
    return (
      <span
        style={{ width: size, height: size }}
        className="flex flex-none items-center justify-center overflow-hidden rounded-tile border border-line bg-surface"
      >
        <img
          src={`/brands/${entry.slug}.svg`}
          alt=""
          aria-hidden="true"
          onError={() => setLogoFailed(true)}
          className="size-full object-contain p-[3px]"
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.34),
        ...(entry ? { background: entry.background, color: entry.color } : {}),
      }}
      className={`flex flex-none items-center justify-center rounded-tile font-bold leading-none ${
        entry ? "" : "bg-surface-2 text-muted"
      }`}
    >
      {entry ? entry.short : fallback}
    </span>
  );
}
