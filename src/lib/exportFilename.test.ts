import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { exportFilename } from "./exportFilename";

describe("export filenames", () => {
  it.each([
    ["UTC", "2026-11-06T11:39:05.123Z", "2026-11-06_11-39-05-123_UTC+0000"],
    ["Asia/Jerusalem", "2026-11-06T11:39:05.123Z", "2026-11-06_13-39-05-123_UTC+0200"],
    ["Asia/Jerusalem", "2026-07-06T11:39:05.123Z", "2026-07-06_14-39-05-123_UTC+0300"],
    ["Asia/Kathmandu", "2026-12-31T20:00:00.007Z", "2027-01-01_01-45-00-007_UTC+0545"],
    ["America/New_York", "2026-11-01T05:30:00.000Z", "2026-11-01_01-30-00-000_UTC-0400"],
    ["America/New_York", "2026-11-01T06:30:00.000Z", "2026-11-01_01-30-00-000_UTC-0500"],
  ])("uses the device timezone %s for %s, including DST and fractional offsets", (timezone, instant, stamp) => {
    // A subprocess exercises native local Date getters without changing the
    // timezone of another concurrent test worker or depending on the CI zone.
    const source = `import { exportFilename } from ${JSON.stringify(new URL("./exportFilename.ts", import.meta.url).href)};
      process.stdout.write(exportFilename('tank-maleh-care.json', new Date(${JSON.stringify(instant)})));`;
    const filename = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], {
      encoding: "utf8", env: { ...process.env, TZ: timezone },
    });
    expect(filename).toBe(`tank-maleh-care-${stamp}.json`);
    expect(filename).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/);
  });

  it("keeps the existing basename and extension and distinguishes rapid exports", () => {
    const first = new Date(2026, 10, 6, 13, 39, 5, 123);
    const second = new Date(first.getTime() + 1);
    const filename = exportFilename("tank-maleh-מאזדה-3.backup.csv", first);
    expect(filename).toMatch(/^tank-maleh-מאזדה-3\.backup-2026-11-06_13-39-05-123_UTC[+-]\d{4}\.csv$/);
    expect(exportFilename("tank-maleh-מאזדה-3.backup.csv", second)).not.toBe(filename);
    expect(exportFilename("backup", first)).toMatch(/^backup-2026-11-06_13-39-05-123_UTC[+-]\d{4}$/);
  });

  it("rejects invalid metadata instead of emitting a misleading timestamp", () => {
    expect(() => exportFilename("backup.json", new Date(NaN))).toThrow("Invalid export timestamp");
  });
});
