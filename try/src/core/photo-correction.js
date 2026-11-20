import { levelCorrectedDimensions, renderLevelCorrectedCanvas } from "./level-render.js";
import { normalizePhotoCorrection } from "./level-straighten.js";

export function correctedPhotoDimensions(width, height, correction = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("사진 크기는 양의 정수여야 해요.");
  }
  return levelCorrectedDimensions(width, height, normalizePhotoCorrection(correction));
}

async function decodePhoto(photo) {
  const type = photo.format === "png" ? "image/png" : "image/jpeg";
  const blob = new Blob([photo.bytes], { type });
  if (globalThis.createImageBitmap) return createImageBitmap(blob, { imageOrientation: "from-image" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** EXIF-normalized pixels are turned clockwise first, then the turned result is mirrored left-to-right. */
export async function correctedPhotoCanvas(photo) {
  const image = await decodePhoto(photo);
  try {
    return renderLevelCorrectedCanvas(image, photo.correction);
  } finally {
    if (typeof image.close === "function") image.close();
  }
}

/** A canvas keeps its pixel memory until collection; 0×0 releases it immediately. */
export function releaseCanvas(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}
