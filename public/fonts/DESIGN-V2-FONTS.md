# Design v2 fonts

The WOFF2 files listed in `design-v2-fonts.json` are unmodified downloads from
Google Fonts’ official delivery service. The manifest records every source URL,
SHA256 digest, and byte length. CSS declarations live in `src/fonts-v2.css`;
production loads only the locally hosted files.

- Karantina 700: Hebrew and Latin. License: `Karantina-OFL.txt`.
- IBM Plex Sans Hebrew 400, 500, 600, 700: Hebrew and Latin. License: `IBM-Plex-Sans-Hebrew-OFL.txt`.
- IBM Plex Mono 500, 600: Latin and extended Latin, including the shekel sign.
  This family has no Hebrew alphabet; Hebrew labels use the UI family.
  License: `IBM-Plex-Mono-OFL.txt`.

The original fonts and licenses are from https://github.com/google/fonts at
commit `2fe1e8c6b137fb13041a7cfca6fdcd8a910ea4dc`, under `ofl/karantina`,
`ofl/ibmplexsanshebrew`, and `ofl/ibmplexmono`.

All three families use SIL Open Font License 1.1. IBM reserves the name “Plex”;
the supplied webfont binaries are unmodified. Fonts are precached through the
existing `woff2` glob in `vite.config.ts`.
