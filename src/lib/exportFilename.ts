/**
 * Keep the device's wall clock readable without losing which instant it means.
 * ASCII digits and a colon-free UTC offset are safe on every download platform;
 * milliseconds distinguish quick successive exports and the offset handles DST.
 */
export function exportFilename(filename: string, at = new Date()): string {
  if (!Number.isFinite(at.getTime())) throw new Error("Invalid export timestamp");
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const offset = -at.getTimezoneOffset();
  const zone = `UTC${offset >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`;
  const date = `${pad(at.getFullYear(), 4)}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}-${pad(at.getMilliseconds(), 3)}`;
  const stamp = `${date}_${time}_${zone}`;
  const extension = filename.lastIndexOf(".");
  return extension > 0
    ? `${filename.slice(0, extension)}-${stamp}${filename.slice(extension)}`
    : `${filename}-${stamp}`;
}
