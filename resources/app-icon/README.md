# Native app identity

Display name: **טנק מלא - ניהול הוצאות הרכב**. Publisher credit: **menis 10tec**.

`foreground.svg` is the production vector rendering of the approved car-wallet,
receipt and detailed gauge integrated with the left wheel. Its negative spaces
are real transparent cutouts. The presentation frame and paper background are
not part of the app icon.

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
