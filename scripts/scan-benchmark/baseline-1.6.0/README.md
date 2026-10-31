# Baseline reader, app version 1.6.0

Byte-for-byte copies of `src/lib/scan/automaticDisplay.ts` and
`src/lib/scan/sevenSegment.ts` at commit `4035965f8399037a82eb0c1ea53a021ab37ea87b`
(the audited baseline). They are not imported by the app; the benchmark runs
them as the "before" side of the comparison, with the 1.6.0 acceptance flow:

- still photo: read at 960 px, then 1280 px; the first `read` is accepted;
- live camera: two consecutive frames with the same reading are accepted.
