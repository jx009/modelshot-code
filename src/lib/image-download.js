import { resolveAssetImage, forgetAssetDelivery } from "./studio/asset-delivery.js";

export async function fetchImageBlob(url) {
  try {
    const response = await fetch(resolveAssetImage(url));
    if (!response.ok) throw new Error("Image download failed");
    return response.blob();
  } catch {
    forgetAssetDelivery(url);
    const response = await fetch(resolveAssetImage(url));
    if (!response.ok) throw new Error("Image download failed");
    return response.blob();
  }
}
export async function downloadImage(url, filename) {
  downloadBlob(await fetchImageBlob(url), filename);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
