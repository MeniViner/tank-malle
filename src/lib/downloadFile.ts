import { exportFilename } from './exportFilename';
import { nativeBuild } from './native/platform';

export async function downloadTextFile(
  content: string, filename: string, type: string, now = new Date(), current = () => true,
): Promise<boolean> {
  if (!current()) return false;
  const name = exportFilename(filename, now);
  if (nativeBuild) {
    const { shareNativeFile } = await import('./native/files');
    return shareNativeFile(content, name, current);
  }
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
