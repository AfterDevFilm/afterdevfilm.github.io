function normalizedCorrection(correction = {}) {
  const rawTurns = Number.isInteger(correction.turns) ? correction.turns : 0;
  return { turns: ((rawTurns % 4) + 4) % 4, flipped: correction.flipped === true };
}

export function correctedPhotoDimensions(width, height, correction = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("사진 크기는 양의 정수여야 해요.");
  }
  const { turns } = normalizedCorrection(correction);
  return turns % 2 === 1 ? { width: height, height: width } : { width, height };
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
  const canvas = document.createElement("canvas");
  try {
    const correction = normalizedCorrection(photo.correction);
    const dimensions = correctedPhotoDimensions(image.width, image.height, correction);
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2);
    // Canvas composes these matrices so pixels are rotated first and the rotated result is mirrored.
    context.scale(correction.flipped ? -1 : 1, 1);
    context.rotate(correction.turns * Math.PI / 2);
    context.drawImage(image, -image.width / 2, -image.height / 2);
    return canvas;
  } catch (error) {
    releaseCanvas(canvas);
    throw error;
  } finally {
    if (typeof image.close === "function") image.close();
  }
}

/** A canvas keeps its pixel memory until collection; 0×0 releases it immediately. */
export function releaseCanvas(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}
