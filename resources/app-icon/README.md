# Native app identity

Display name: **טנק מלא**. Tagline: **ניהול הוצאות הרכב**. Publisher credit: **menis 10tec**.

Keep the installed launcher label and store title short. The tagline belongs in
marketing artwork, the short description and the full description, not the
launcher label (where the longer form was truncated).

`foreground.png` is the owner-approved transparent car-wallet and receipt
artwork. Its SHA-256 is
`81c5fcbd6eda1822e4975db7dfefa10c4a9fd734378063dfa8c478b37e19cb27`.
The generator only trims transparent margins, scales and centers the approved
art, and derives its monochrome alpha silhouette. It does not redraw the icon.

Run `npm run native:icons` to regenerate native Android and iOS app icons.
`native:prepare` also runs the generator. Pass an output directory directly to
`node scripts/generate-app-icons.mjs /absolute/output/directory` to export the
Play icon and preview assets.

- Android: separate foreground/background, night background, API 33 monochrome
  layer and legacy density/round icons. All foreground pixels fit within the
  central 66dp safe circle of the 108dp adaptive layer.
- iOS: opaque default/dark icons and a grayscale tinted variant in the asset
  catalog. The platform applies the corner mask.
- PWA icons, in-app marks and splash images are deliberately untouched.
- Native release smoke validation checks the installed label, plugin-reported
  name, adaptive icon loading, default/night backgrounds and monochrome layer.
  Rendered native icon samples are written to the dedicated emulator's app
  external files directory under `icon-validation`.

References: [Android adaptive icons](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive),
[Google Play icon assets](https://developer.android.com/distribute/google-play/resources/icon-design-specifications),
[Apple app icons](https://developer.apple.com/design/human-interface-guidelines/app-icons).
