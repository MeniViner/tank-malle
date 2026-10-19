export function careDeviceOrigin(value: string, actual: string): boolean {
  try {
    const url=new URL(value), host=url.hostname;
    const privateHost=host==='localhost' || host==='127.0.0.1' || /^10\.\d+\.\d+\.\d+$/.test(host) || /^192\.168\.\d+\.\d+$/.test(host) || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host);
    return privateHost && url.protocol==='https:' && !url.username && !url.password && value===url.origin && actual===value;
  } catch { return false; }
}
export function assertCareEnvironment(project: string, emulator: string, deviceOrigin: string, actualOrigin: string): void {
  const local=new URL(actualOrigin);
  if(project!=='demo-tankmaleh' || emulator!=='1' || (deviceOrigin ? !careDeviceOrigin(deviceOrigin,actualOrigin) : !['localhost','127.0.0.1'].includes(local.hostname))) {
    throw new Error('Care preview requires demo-tankmaleh emulators and an approved local origin');
  }
}
