// Native dialogs occupy a browser top layer. Toasts must be hosted there too.
const modalLayers: { dialog: HTMLDialogElement; toastHost: HTMLDivElement; atmosphereHost: HTMLElement | null }[] = [];
const subscribers = new Set<() => void>();
let originalBodyOverflow = "";
const notify = () => subscribers.forEach((subscriber) => subscriber());

export const getModalToastHost = () => modalLayers.at(-1)?.toastHost ?? null;
export const getTopModalDialog = () => modalLayers.at(-1)?.dialog ?? null;
/** A nested ordinary sheet leaves the single atmosphere in its full-screen parent. */
export const getModalAtmosphereHost = () => modalLayers.filter(layer => layer.atmosphereHost).at(-1)?.atmosphereHost ?? null;
export function subscribeModalLayers(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => { subscribers.delete(subscriber); };
}

/** Nested dialogs retain scroll locking until the final modal closes. */
export function registerModalLayer(dialog: HTMLDialogElement, toastHost: HTMLDivElement) {
  if (modalLayers.length === 0) originalBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  modalLayers.push({ dialog, toastHost, atmosphereHost: dialog.querySelector<HTMLElement>("[data-app-atmosphere-host]") });
  notify();
  return () => {
    const index = modalLayers.findIndex((layer) => layer.dialog === dialog);
    if (index >= 0) modalLayers.splice(index, 1);
    if (modalLayers.length === 0) document.body.style.overflow = originalBodyOverflow;
    notify();
  };
}
