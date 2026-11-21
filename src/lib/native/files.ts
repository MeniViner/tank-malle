import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const EXPORTS = 'tank-malle-exports';

export async function clearNativeExports() {
  try {
    await Filesystem.rmdir({ path: EXPORTS, directory: Directory.Cache, recursive: true });
  } catch (error) {
    if ((error as { code?: string })?.code !== 'OS-PLUG-FILE-0008') throw error;
  }
}

export async function shareNativeFile(content: string, filename: string, current: () => boolean) {
  const folder = EXPORTS + '/' + Date.now() + '-' + crypto.randomUUID();
  // Let receivers finish reading the content URI after the sheet closes.
  // Old exports are removed before the next share and on logout.
  const old = await Filesystem.readdir({ path: EXPORTS, directory: Directory.Cache }).catch(() => null);
  await Promise.all((old?.files ?? []).filter(file => file.type === 'directory' &&
    Date.now() - Number(file.name.split('-')[0]) > 60 * 60_000)
    .map(file => Filesystem.rmdir({ path: EXPORTS + '/' + file.name, directory: Directory.Cache, recursive: true }).catch(() => {})));
  if (!current()) return false;

  const { uri } = await Filesystem.writeFile({
    path: folder + '/' + filename, data: content, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true,
  });
  let shared = false;
  try {
    if (!current()) return false;
    await Share.share({ title: filename, files: [uri], dialogTitle: 'שיתוף קובץ' });
    shared = true;
    return true;
  } catch (error) {
    if (error instanceof Error && /^Share canceled$/i.test(error.message)) return false;
    throw error;
  } finally {
    if (!shared) await Filesystem.rmdir({ path: folder, directory: Directory.Cache, recursive: true }).catch(() => {});
  }
}
