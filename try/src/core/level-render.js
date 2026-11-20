import { minimumLevelScale, normalizePhotoCorrection } from "./level-straighten.js";

function positiveDimension(value) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError("INVALID_RENDER_DIMENSION");
  return value;
}

export function levelCorrectedDimensions(width, height, correction = {}) {
  positiveDimension(width);
  positiveDimension(height);
  const { turns } = normalizePhotoCorrection(correction);
  return turns % 2 === 1 ? { width: height, height: width } : { width, height };
}

/**
 * Draws EXIF-normalized pixels in order: quarter turn, level rotation with
 * exact minimum-scale center crop, then horizontal flip. Frame/resize callers draw this result afterwards.
 */
export function drawLevelCorrectedImage(context, image, correction = {}, {
  x = 0,
  y = 0,
  width = levelCorrectedDimensions(image.width, image.height, correction).width,
  height = levelCorrectedDimensions(image.width, image.height, correction).height,
} = {}) {
  positiveDimension(image.width);
  positiveDimension(image.height);
  positiveDimension(width);
  positiveDimension(height);
  const normalized = normalizePhotoCorrection(correction);
  const oriented = levelCorrectedDimensions(image.width, image.height, normalized);
  const minimumScale = minimumLevelScale(oriented.width, oriented.height, normalized.levelAngle);

  context.save();
  context.imageSmoothingEnabled = true;
  context.translate(x + width / 2, y + height / 2);
  context.scale(width / oriented.width, height / oriented.height);
  context.scale(normalized.flipped ? -1 : 1, 1);
  context.rotate(normalized.levelAngle * Math.PI / 1800);
  context.scale(minimumScale, minimumScale);
  context.rotate(normalized.turns * Math.PI / 2);
  context.drawImage(image, -image.width / 2, -image.height / 2);
  context.restore();
  return { width, height, minimumScale, correction: normalized };
}

export function renderLevelCorrectedCanvas(image, correction = {}, {
  createCanvas = () => document.createElement("canvas"),
} = {}) {
  const normalized = normalizePhotoCorrection(correction);
  const dimensions = levelCorrectedDimensions(image.width, image.height, normalized);
  const canvas = createCanvas(dimensions.width, dimensions.height);
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  try {
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawLevelCorrectedImage(context, image, normalized, dimensions);
    return canvas;
  } catch (error) {
    canvas.width = 0;
    canvas.height = 0;
    throw error;
  }
}
