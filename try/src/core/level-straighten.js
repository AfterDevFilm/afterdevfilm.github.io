export const LEVEL_ANGLE_MINIMUM = -150;
export const LEVEL_ANGLE_MAXIMUM = 150;

export const LEVEL_ANGLE_REASONS = Object.freeze({
  notANumber: "NOT_A_NUMBER",
  notInteger: "NOT_INTEGER",
  outOfRange: "OUT_OF_RANGE",
});

export function validateLevelAngle(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { accepted: false, storedLevelAngle: null, reason: LEVEL_ANGLE_REASONS.notANumber };
  }
  if (!Number.isInteger(value)) {
    return { accepted: false, storedLevelAngle: null, reason: LEVEL_ANGLE_REASONS.notInteger };
  }
  if (value < LEVEL_ANGLE_MINIMUM || value > LEVEL_ANGLE_MAXIMUM) {
    return { accepted: false, storedLevelAngle: null, reason: LEVEL_ANGLE_REASONS.outOfRange };
  }
  return { accepted: true, storedLevelAngle: value, reason: null };
}

function checkedLevelAngle(value) {
  const result = validateLevelAngle(value);
  if (result.accepted) return result.storedLevelAngle;
  const error = new TypeError(result.reason);
  error.code = result.reason;
  throw error;
}

function checkedDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError("INVALID_DIMENSIONS");
  }
  return { width, height };
}

function checkedQuarterTurns(value) {
  if (!Number.isInteger(value) || value < 0 || value > 3) throw new TypeError("INVALID_QUARTER_TURNS");
  return value;
}

function quarterDimensions(sourceWidth, sourceHeight, rotationQuarterTurns) {
  checkedDimensions(sourceWidth, sourceHeight);
  const quarterTurns = checkedQuarterTurns(rotationQuarterTurns);
  return quarterTurns % 2
    ? { width: sourceHeight, height: sourceWidth }
    : { width: sourceWidth, height: sourceHeight };
}

/** Minimum fill scale in the rotated, pre-flip coordinate plane. */
export function minimumLevelScale(width, height, levelAngle) {
  checkedDimensions(width, height);
  const theta = checkedLevelAngle(levelAngle) * Math.PI / 1800;
  const cosine = Math.abs(Math.cos(theta));
  const sine = Math.abs(Math.sin(theta));
  return Math.max(cosine + (height / width) * sine, cosine + (width / height) * sine);
}

export function formatMinimumLevelScale(width, height, levelAngle) {
  return minimumLevelScale(width, height, levelAngle).toFixed(12);
}

/** Output crop edge corners mapped into the oriented, pre-level source plane. */
export function samplingCorners(width, height, levelAngle) {
  checkedDimensions(width, height);
  const storedLevelAngle = checkedLevelAngle(levelAngle);
  const theta = storedLevelAngle * Math.PI / 1800;
  const cosine = Math.cos(theta);
  const sine = Math.sin(theta);
  const scale = minimumLevelScale(width, height, storedLevelAngle);
  const centerX = width / 2;
  const centerY = height / 2;
  return [
    ["topLeft", 0, 0],
    ["topRight", width, 0],
    ["bottomRight", width, height],
    ["bottomLeft", 0, height],
  ].map(([name, outputX, outputY]) => {
    const dx = outputX - centerX;
    const dy = outputY - centerY;
    return {
      name,
      x: centerX + (cosine * dx + sine * dy) / scale,
      y: centerY + (-sine * dx + cosine * dy) / scale,
    };
  });
}

function orientedToSource(x, y, sourceWidth, sourceHeight, rotationQuarterTurns) {
  switch (rotationQuarterTurns) {
    case 0: return { x, y };
    case 1: return { x: y, y: sourceHeight - x };
    case 2: return { x: sourceWidth - x, y: sourceHeight - y };
    case 3: return { x: sourceWidth - y, y: x };
    default: throw new TypeError("INVALID_QUARTER_TURNS");
  }
}

/** Continuous output edge coordinate mapped back to the EXIF-normalized source plane. */
export function outputToSource(outputX, outputY, {
  sourceWidth, sourceHeight, rotationQuarterTurns, horizontalFlip, levelAngle,
}) {
  const dimensions = quarterDimensions(sourceWidth, sourceHeight, rotationQuarterTurns);
  const storedLevelAngle = checkedLevelAngle(levelAngle);
  if (typeof horizontalFlip !== "boolean") throw new TypeError("INVALID_HORIZONTAL_FLIP");
  if (!Number.isFinite(outputX) || !Number.isFinite(outputY)) throw new TypeError("INVALID_OUTPUT_COORDINATE");
  const preFlipX = horizontalFlip ? dimensions.width - outputX : outputX;
  const centerX = dimensions.width / 2;
  const centerY = dimensions.height / 2;
  const dx = preFlipX - centerX;
  const dy = outputY - centerY;
  const theta = storedLevelAngle * Math.PI / 1800;
  const cosine = Math.cos(theta);
  const sine = Math.sin(theta);
  const scale = minimumLevelScale(dimensions.width, dimensions.height, storedLevelAngle);
  return orientedToSource(
    centerX + (cosine * dx + sine * dy) / scale,
    centerY + (-sine * dx + cosine * dy) / scale,
    sourceWidth,
    sourceHeight,
    rotationQuarterTurns,
  );
}

export function compositionSamplePoints(input) {
  const { width, height } = quarterDimensions(input.sourceWidth, input.sourceHeight, input.rotationQuarterTurns);
  return [
    ["topLeft", 0, 0],
    ["topRight", width, 0],
    ["bottomRight", width, height],
    ["bottomLeft", 0, height],
    ["center", width / 2, height / 2],
  ].map(([name, outputX, outputY]) => {
    const source = outputToSource(outputX, outputY, input);
    return {
      name,
      outputX,
      outputY,
      sourceNormalizedX: source.x / input.sourceWidth,
      sourceNormalizedY: source.y / input.sourceHeight,
    };
  });
}

/** Pixel indices are converted to their continuous centers before inverse sampling. */
export function outputPixelCenterToSource(pixelX, pixelY, input) {
  const { width, height } = quarterDimensions(input.sourceWidth, input.sourceHeight, input.rotationQuarterTurns);
  if (!Number.isInteger(pixelX) || !Number.isInteger(pixelY)
      || pixelX < 0 || pixelX >= width || pixelY < 0 || pixelY >= height) {
    throw new TypeError("INVALID_OUTPUT_PIXEL");
  }
  const outputCenterX = pixelX + 0.5;
  const outputCenterY = pixelY + 0.5;
  const source = outputToSource(outputCenterX, outputCenterY, input);
  return { pixelX, pixelY, outputCenterX, outputCenterY, sourceX: source.x, sourceY: source.y };
}

export function displayedLevelAngle(storedLevelAngle, horizontalFlip) {
  const levelAngle = checkedLevelAngle(storedLevelAngle);
  if (typeof horizontalFlip !== "boolean") throw new TypeError("INVALID_HORIZONTAL_FLIP");
  return levelAngle === 0 ? 0 : (horizontalFlip ? -levelAngle : levelAngle);
}

export function storedLevelAngle(displayedAngle, horizontalFlip) {
  const levelAngle = checkedLevelAngle(displayedAngle);
  if (typeof horizontalFlip !== "boolean") throw new TypeError("INVALID_HORIZONTAL_FLIP");
  return levelAngle === 0 ? 0 : (horizontalFlip ? -levelAngle : levelAngle);
}

export function levelDisplayState(levelAngle, horizontalFlip, rotationQuarterTurns) {
  const quarterTurns = checkedQuarterTurns(rotationQuarterTurns);
  const displayedAngleTenth = displayedLevelAngle(levelAngle, horizontalFlip);
  return {
    displayedAngleTenth,
    roundTripStoredLevelAngle: storedLevelAngle(displayedAngleTenth, horizontalFlip),
    reset: { levelAngle: 0, rotationQuarterTurns: quarterTurns, horizontalFlip },
  };
}

export function defaultPhotoCorrection() {
  return { turns: 0, flipped: false, levelAngle: 0 };
}

export function normalizePhotoCorrection(correction = {}) {
  const rawTurns = Number.isInteger(correction.turns) ? correction.turns : 0;
  const levelAngle = correction.levelAngle === undefined ? 0 : checkedLevelAngle(correction.levelAngle);
  return { turns: ((rawTurns % 4) + 4) % 4, flipped: correction.flipped === true, levelAngle };
}

export function rotatePhotoCorrection(correction, quarterTurnDelta) {
  if (quarterTurnDelta !== -1 && quarterTurnDelta !== 1) throw new TypeError("INVALID_QUARTER_TURN_DELTA");
  const normalized = normalizePhotoCorrection(correction);
  return { ...normalized, turns: (normalized.turns + quarterTurnDelta + 4) % 4 };
}

export function flipPhotoCorrection(correction) {
  const normalized = normalizePhotoCorrection(correction);
  return { ...normalized, flipped: !normalized.flipped };
}

export function resetLevelAngle(correction) {
  return { ...normalizePhotoCorrection(correction), levelAngle: 0 };
}

/** Nonzero level selects route B. */
export function decideLevelExportPath({ outputFormat, informationFrame, existingRouteAEligible, levelAngle }) {
  const storedAngle = checkedLevelAngle(levelAngle);
  if (typeof outputFormat !== "string" || typeof informationFrame !== "boolean"
      || typeof existingRouteAEligible !== "boolean") throw new TypeError("INVALID_EXPORT_INPUT");
  const routeA = outputFormat === "JPEG" && !informationFrame && existingRouteAEligible && storedAngle === 0;
  const includeInTxtUi0021Count = outputFormat === "JPEG" && !informationFrame && !routeA;
  return {
    route: routeA ? "A" : "B",
    includeInTxtUi0021Count,
    messageKey: includeInTxtUi0021Count ? "TXT-UI-0021" : null,
    outputExifOrientation: routeA ? "COMPOSED_1_TO_8" : 1,
    existingRotationFlipDecisionUnchanged: storedAngle === 0,
  };
}
