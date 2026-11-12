import { Camera } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';

export async function captureScanPhoto(): Promise<File | undefined> {
  let uri: string | undefined;
  try {
    const image = await Camera.takePhoto({ correctOrientation: true, quality: 95, saveToGallery: false });
    uri = image.uri;
    const path = image.webPath ?? (uri && Capacitor.convertFileSrc(uri));
    if (!path) throw new Error('Camera did not return a file.');
    const response = await fetch(path);
    if (!response.ok) throw new Error('Camera file could not be opened.');
    return new File([await response.blob()], 'scan.jpg', { type: 'image/jpeg' });
  } catch (error) {
    if (error instanceof Error && /cancel/i.test(error.message)) return undefined;
    throw error;
  } finally {
    if (uri && /^(file:\/\/|\/)/.test(uri)) await Filesystem.deleteFile({ path: uri }).catch(() => {});
  }
}
