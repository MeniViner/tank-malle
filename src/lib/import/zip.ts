/**
 * Minimal ZIP reader for .xlsx, built on the platform's DecompressionStream.
 *
 * Why no library: the alternatives are either unmaintained on npm, several
 * hundred kilobytes, or carry licence terms worth avoiding — for a job that is
 * "read four XML entries out of an archive". Every browser this app supports
 * ships raw DEFLATE natively (Chrome 80+, Firefox 113+, Safari 16.4+), so this
 * adds nothing to the bundle beyond the code below, and it is lazy-loaded with
 * the rest of the import flow.
 *
 * Only what .xlsx actually uses is implemented: stored and deflated entries,
 * read through the central directory.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

export class UnsupportedArchiveError extends Error {}

/** True when this runtime can inflate — checked before the file is read. */
export function canReadZip(): boolean {
  return typeof DecompressionStream === "function";
}

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function findEndOfCentralDirectory(view: DataView): number {
  // The EOCD sits at the end, after a comment of up to 65,535 bytes.
  const min = Math.max(0, view.byteLength - 65_557);
  for (let i = view.byteLength - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  throw new UnsupportedArchiveError("not a zip archive");
}

function readEntries(buffer: ArrayBuffer): Map<string, Entry> {
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const decoder = new TextDecoder("utf-8");
  const entries = new Map<string, Entry>();

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) break;

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
    entries.set(name, { name, method, compressedSize, localHeaderOffset });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/** Read one entry out of the archive as UTF-8 text. */
export async function readZipText(
  buffer: ArrayBuffer,
  entries: Map<string, Entry>,
  name: string,
): Promise<string | null> {
  const entry = entries.get(name);
  if (!entry) return null;

  const view = new DataView(buffer);
  // The local header repeats the name and extra fields with its OWN lengths,
  // which need not match the central directory's.
  const nameLength = view.getUint16(entry.localHeaderOffset + 26, true);
  const extraLength = view.getUint16(entry.localHeaderOffset + 28, true);
  const start = entry.localHeaderOffset + 30 + nameLength + extraLength;

  const raw = new Uint8Array(buffer, start, entry.compressedSize);

  let bytes: Uint8Array;
  if (entry.method === 0) {
    bytes = raw;
  } else if (entry.method === 8) {
    if (!canReadZip()) throw new UnsupportedArchiveError("no DecompressionStream");
    bytes = await inflateRaw(raw);
  } else {
    throw new UnsupportedArchiveError(`unsupported compression method ${entry.method}`);
  }

  return new TextDecoder("utf-8").decode(bytes as BufferSource);
}

export function openZip(buffer: ArrayBuffer): Map<string, Entry> {
  return readEntries(buffer);
}
