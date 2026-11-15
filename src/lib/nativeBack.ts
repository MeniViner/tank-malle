import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

export function listenForNativeBack(
  onBack: (canGoBack: boolean) => void,
  onSuspend: () => void,
): () => void {
  if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('App')) {
    return () => {}
  }

  let disposed = false
  const listeners = [
    App.addListener('backButton', ({ canGoBack }) => {
      if (!disposed) onBack(canGoBack)
    }),
    App.addListener('appStateChange', ({ isActive }) => {
      if (!disposed && !isActive) onSuspend()
    }),
  ]

  // The installed shell disabled this callback. Enable it after the listener
  // is registered, including when this web bundle is copied into that shell.
  void listeners[0].then(() => {
    if (!disposed) return App.toggleBackButtonHandler({ enabled: true })
  }).catch(() => undefined)

  // Attach rejection handlers even when a listener is not available on the
  // current bridge. Cleanup must also work if a registration is still pending.
  const handles = listeners.map(listener => listener.catch(() => undefined))
  return () => {
    disposed = true
    for (const handle of handles) {
      void handle.then(listener => listener?.remove()).catch(() => undefined)
    }
  }
}

export function minimizeNativeApp(): void {
  if (Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('App')) {
    void App.minimizeApp().catch(() => undefined)
  }
}
