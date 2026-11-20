import { correctedPhotoCanvas, correctedPhotoDimensions, releaseCanvas } from "./photo-correction.js";

const REFERENCE_WIDTH = 1080;
const SIDE_MARGIN_REF = 18;
const CENTER_RULE_FRACTION = 0.615;
const FONT_SIZE_REF = 20;
const CAPTION_FONT_SIZE_REF = 17;
const ROLL_FRAME_FONT_SIZE_REF = 16;
const CAPTION_ROW_GAP_REF = 20;
const FRAME_TOO_LARGE = "이 사진은 액자를 넣기엔 커요. 사진만 저장은 돼요.";
const CAPTION_SEPARATOR = " · ";
const CAPTION_PRIMARY_COLOR = "rgb(30,30,30)";
const CAPTION_SECONDARY_COLOR = "rgb(55,55,55)";
const HISTOGRAM_WIDTH_REF = 140;
const HISTOGRAM_HEIGHT_REF = 22;
const CONTENT_SCALE = 1.4;
const TOP_OUTER_MARGIN_REF = 16;
const TOP_ROW_PHOTO_GAP_REF = 4;
const BOTTOM_OUTER_MARGIN_REF = 16;

const CAPABILITIES = {
  "iphone-safari": { id: "iphone-safari", photoPixels: 14_000_000, canvasPixels: 16_777_216, maxDimension: 4096 },
  firefox: { id: "firefox", photoPixels: 50_000_000, canvasPixels: 62_500_000, maxDimension: 32767 },
  chromium: { id: "chromium", photoPixels: 64_000_000, canvasPixels: 80_000_000, maxDimension: 32767 },
  "desktop-safari": { id: "desktop-safari", photoPixels: 32_000_000, canvasPixels: 40_000_000, maxDimension: 16384 },
  other: { id: "other", photoPixels: 24_000_000, canvasPixels: 30_000_000, maxDimension: 10000 },
};

function scaleValue(value, widthScale) {
  return Math.round(value * widthScale);
}

function scaledReference(baseReference, orientationScale, widthScale, minimumReference = 0, contentScale = 1) {
  return Math.round(Math.max(minimumReference, baseReference * orientationScale) * contentScale * widthScale);
}

function geometryAtWidth(photoWidthPx, photoHeightPx, rollFrameOn, outputWidth, rgbHistogramOn = false) {
  const widthScale = outputWidth / REFERENCE_WIDTH;
  const scale = (value) => scaleValue(value, widthScale);
  const sideMargin = scale(SIDE_MARGIN_REF);
  const photoWidth = outputWidth - 2 * sideMargin;
  const photoHeight = Math.round(photoWidth * photoHeightPx / photoWidthPx);
  const orientationScale = Math.min(1, photoHeight / photoWidth);
  const fontPxRef = Math.max(12, FONT_SIZE_REF * orientationScale);
  const bottomCaptionGapRef = Math.max(6, Math.round(13 * orientationScale));
  const leftInsetRef = Math.max(14, Math.round(22 * orientationScale));
  const rightInsetRef = Math.max(16, Math.round(25 * orientationScale));
  const fontPx = Math.round(fontPxRef * CONTENT_SCALE * widthScale);
  const topOuterMargin = scale(TOP_OUTER_MARGIN_REF);
  const topLabelPhotoGap = scale(TOP_ROW_PHOTO_GAP_REF);
  const bottomPhotoCaptionGap = scale(bottomCaptionGapRef);
  const bottomOuterMargin = scale(BOTTOM_OUTER_MARGIN_REF);
  const captionFontPx = scaledReference(CAPTION_FONT_SIZE_REF, orientationScale, widthScale, 12, CONTENT_SCALE);
  const minimumCaptionFontPx = scaledReference(CAPTION_FONT_SIZE_REF, orientationScale, widthScale, 12);
  const rollFrameFontPx = scaledReference(ROLL_FRAME_FONT_SIZE_REF, orientationScale, widthScale, 12, CONTENT_SCALE);
  const typographyRowGap = scaledReference(CAPTION_ROW_GAP_REF, orientationScale, widthScale, 1, CONTENT_SCALE);
  const rowGap = typographyRowGap;
  const leftTextInset = scale(leftInsetRef);
  const rightTextInset = scale(rightInsetRef);
  const ruleWidth = Math.max(1, scale(1));
  const topLabelX = sideMargin + scale(2);
  const leftRuleX = sideMargin + scale(1);
  const centerRuleX = Math.round(outputWidth * CENTER_RULE_FRACTION);
  const histogramWidth = rgbHistogramOn ? scale(HISTOGRAM_WIDTH_REF) : null;
  const histogramHeight = rgbHistogramOn ? scale(HISTOGRAM_HEIGHT_REF) : null;
  const topRowHeight = Math.max(rollFrameOn ? rollFrameFontPx : 0, histogramHeight ?? 0);
  const rollFrameLabelBaselineY = rollFrameOn ? topOuterMargin + topRowHeight : null;
  const photoY = topOuterMargin + (topRowHeight > 0 ? topRowHeight + topLabelPhotoGap : 0);
  const captionBlockHeight = captionFontPx + rowGap;
  const captionTopY = photoY + photoHeight + bottomPhotoCaptionGap;
  const canvasHeight = captionTopY + captionBlockHeight + bottomOuterMargin;
  return {
    canvasWidth: outputWidth, canvasHeight,
    sideMargin, photoWidth, photoHeight, photoX: sideMargin, photoY, topLabelX, leftRuleX, centerRuleX,
    ruleWidth, leftTextInset, rightTextInset, leftColumnWidth: centerRuleX - (leftRuleX + leftTextInset),
    rightColumnWidth: (outputWidth - sideMargin) - (centerRuleX + rightTextInset),
    rollFrameLabelBaselineY,
    histogramX: histogramWidth == null ? null : outputWidth - sideMargin - histogramWidth,
    histogramY: histogramHeight == null ? null : topOuterMargin + topRowHeight - histogramHeight,
    histogramWidth, histogramHeight, captionTopY, captionBlockHeight,
    ruleEndY: captionTopY + captionBlockHeight - ruleWidth,
    topOuterMargin, topLabelPhotoGap, bottomPhotoCaptionGap, bottomOuterMargin,
    fontPx, rowGap, orientationScale, widthScale,
    captionFontPx, minimumCaptionFontPx, rollFrameFontPx, typographyRowGap,
  };
}

export function computeInformationFrameGeometry(photoWidth, photoHeight, rollFrameOn = true, rgbHistogramOn = false, requestedOutputWidth = null) {
  if (!Number.isInteger(photoWidth) || !Number.isInteger(photoHeight) || photoWidth <= 0 || photoHeight <= 0) {
    throw new Error("사진 크기는 양의 정수여야 해요.");
  }
  if (requestedOutputWidth !== null && (!Number.isInteger(requestedOutputWidth) || requestedOutputWidth <= 0)) {
    throw new Error("출력 너비는 양의 정수여야 해요.");
  }
  let outputWidth = requestedOutputWidth ?? photoWidth;
  if (requestedOutputWidth === null) {
    while (geometryAtWidth(photoWidth, photoHeight, rollFrameOn, outputWidth, rgbHistogramOn).photoWidth !== photoWidth) outputWidth += 1;
  }
  const geometry = geometryAtWidth(photoWidth, photoHeight, rollFrameOn, outputWidth, rgbHistogramOn);
  if (requestedOutputWidth === null && geometry.photoHeight !== photoHeight) throw new Error("사진 크기를 그대로 둘 수 없어요.");
  return geometry;
}

export function showsRGBHistogramControl(mode) {
  return mode === "simple" || mode === "detail";
}

export function histogramSampleDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("사진 크기는 양의 정수여야 해요.");
  const longest = Math.max(width, height);
  if (longest <= 512) return { width, height };
  const scale = 512 / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function computeRGBHistogramFromSRGBPixels(pixels) {
  const counts = [new Array(256).fill(0), new Array(256).fill(0), new Array(256).fill(0)];
  for (const pixel of pixels) for (let channel = 0; channel < 3; channel += 1) counts[channel][pixel[channel]] += 1;
  const commonMaximum = Math.max(...counts.flat().map((count) => Math.sqrt(count)));
  const normalized = (channel) => counts[channel].map((count) => commonMaximum === 0 ? 0 : Math.sqrt(count) / commonMaximum);
  return { red: normalized(0), green: normalized(1), blue: normalized(2) };
}

function histogramFromDecodedImage(image) {
  const size = histogramSampleDimensions(image.width, image.height);
  const sample = document.createElement("canvas");
  sample.width = size.width;
  sample.height = size.height;
  const context = sample.getContext("2d", { alpha: false, colorSpace: "srgb" });
  context.drawImage(image, 0, 0, size.width, size.height);
  const bytes = context.getImageData(0, 0, size.width, size.height, { colorSpace: "srgb" }).data;
  const pixels = [];
  for (let offset = 0; offset < bytes.length; offset += 4) pixels.push([bytes[offset], bytes[offset + 1], bytes[offset + 2]]);
  return computeRGBHistogramFromSRGBPixels(pixels);
}

function drawHistogram(context, geometry, histogram) {
  const { histogramX: left, histogramY: top, histogramWidth: width, histogramHeight: height } = geometry;
  if (left == null || top == null || width == null || height == null) return;
  const bottom = top + height;
  const draw = (values, color) => {
    context.beginPath();
    context.moveTo(left, bottom);
    values.forEach((value, index) => context.lineTo(left + index * (width - 1) / 255, bottom - value * height));
    context.lineTo(left + width, bottom);
    context.closePath();
    context.fillStyle = color;
    context.fill();
  };
  draw(histogram.red, "rgba(255,0,0,0.55)");
  draw(histogram.green, "rgba(0,255,0,0.55)");
  draw(histogram.blue, "rgba(0,0,255,0.55)");
}

export function browserCanvasCapability(userAgent = navigator.userAgent) {
  const ua = String(userAgent);
  const appleTouch = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  if (appleTouch) return { ...CAPABILITIES["iphone-safari"] };
  if (/Firefox\//i.test(ua)) return { ...CAPABILITIES.firefox };
  if (/Chrome\//i.test(ua) || /Chromium\//i.test(ua) || /Edg\//i.test(ua)) return { ...CAPABILITIES.chromium };
  if (/Safari\//i.test(ua)) return { ...CAPABILITIES["desktop-safari"] };
  return { ...CAPABILITIES.other };
}

export function evaluateInformationFrameLimit(width, height, capability = browserCanvasCapability(), rgbHistogramOn = false, rollFrameOn = true) {
  const geometry = computeInformationFrameGeometry(width, height, rollFrameOn, rgbHistogramOn);
  const sourcePixels = width * height;
  const canvasPixels = geometry.canvasWidth * geometry.canvasHeight;
  const allowed = sourcePixels <= capability.photoPixels && canvasPixels <= capability.canvasPixels
    && geometry.canvasWidth <= capability.maxDimension && geometry.canvasHeight <= capability.maxDimension;
  return { allowed, message: allowed ? "" : FRAME_TOO_LARGE, sourcePixels, canvasPixels, geometry, capability };
}

export function evaluateInformationFramePhotoLimit(photo, capability = browserCanvasCapability(), rgbHistogramOn = false, rollFrameOn = true) {
  const dimensions = correctedPhotoDimensions(photo.width, photo.height, photo.correction);
  return evaluateInformationFrameLimit(dimensions.width, dimensions.height, capability, rgbHistogramOn, rollFrameOn);
}

export function formatFrameAperture(value) {
  const text = String(value ?? "");
  return /^\d+(?:\.\d+)?$/.test(text) ? `f/${text}` : text;
}

export function formatFrameFocalLength(value) {
  const stored = String(value ?? "");
  const text = stored.trim();
  if (!text) return "";
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(?:mm)?$/i);
  if (!match) return stored;
  const [whole, fraction = ""] = match[1].split(".");
  const canonicalWhole = whole.replace(/^0+(?=\d)/, "");
  const canonicalFraction = fraction.replace(/0+$/, "");
  return `${canonicalWhole}${canonicalFraction ? `.${canonicalFraction}` : ""}mm`;
}

export function formatRollFrameLabel(rollNumber, frame) {
  const rollText = String(rollNumber ?? "").trim();
  const frameText = String(frame ?? "").trim();
  const parts = [rollText ? `R${rollText}` : "", frameText ? `F${frameText}` : ""].filter(Boolean);
  return parts.length ? parts.join("  ") : null;
}

export function formatInformationFrameLine(segments) {
  return segments.map((part) => part.text).join(CAPTION_SEPARATOR);
}

function segment(value, bold = false) {
  const text = String(value ?? "").trim();
  return text ? { text, bold } : null;
}

function exposureCompensation(value) {
  const text = String(value ?? "").trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  const magnitude = text.replace(/^[+-]/, "");
  return `${number > 0 ? "+" : number < 0 ? "-" : ""}${magnitude} EV`;
}

export function buildInformationFrameCaption(record, mode) {
  const detail = mode === "detail";
  const leftLine1 = [segment(record.camera, true), detail ? segment(record.lens) : null].filter(Boolean);
  const leftLine2 = [segment(formatFrameFocalLength(record.focal)), segment(formatFrameAperture(record.ap)), segment(record.sh)];
  if (detail) leftLine2.push(segment(exposureCompensation(record.ev)));
  const rightLine1 = [segment(record.film, true), segment(record.ei ? `EI ${record.ei}` : "")].filter(Boolean);
  const rightLine2 = detail ? [segment(record.process), segment(record.lab)].filter(Boolean) : [];
  return { left: [leftLine1, leftLine2.filter(Boolean)], right: [rightLine1, rightLine2] };
}

function fitText(context, text, maxWidth) {
  if (context.measureText(text).width <= maxWidth) return text;
  let result = "";
  for (const character of text) {
    if (context.measureText(`${result}${character}…`).width > maxWidth) break;
    result += character;
  }
  return result ? `${result}…` : "";
}

export function drawInformationFrameLine(context, segments, x, baselineY, maxWidth, fontPx, minimumFontPx = fontPx) {
  if (!segments.length || maxWidth <= 0) return;
  const joined = formatInformationFrameLine(segments);
  const measuredWidth = (size) => segments.reduce((width, part, index) => {
    context.font = `${part.bold ? 700 : 400} ${size}px "Noto Sans KR Frame"`;
    const partWidth = context.measureText(part.text).width;
    if (index === segments.length - 1) return width + partWidth;
    context.font = `400 ${size}px "Noto Sans KR Frame"`;
    return width + partWidth + context.measureText(CAPTION_SEPARATOR).width;
  }, 0);
  let fittedFontPx = null;
  for (let size = fontPx; size >= minimumFontPx; size -= 1) {
    if (measuredWidth(size) <= maxWidth) {
      fittedFontPx = size;
      break;
    }
  }
  if (fittedFontPx === null) {
    context.font = `400 ${minimumFontPx}px "Noto Sans KR Frame"`;
    context.fillStyle = CAPTION_SECONDARY_COLOR;
    context.fillText(fitText(context, joined, maxWidth), x, baselineY);
    return;
  }
  let cursor = x;
  segments.forEach((part, index) => {
    context.font = `${part.bold ? 700 : 400} ${fittedFontPx}px "Noto Sans KR Frame"`;
    context.fillStyle = part.bold ? CAPTION_PRIMARY_COLOR : CAPTION_SECONDARY_COLOR;
    context.fillText(part.text, cursor, baselineY);
    cursor += context.measureText(part.text).width;
    if (index < segments.length - 1) {
      context.font = `400 ${fittedFontPx}px "Noto Sans KR Frame"`;
      context.fillStyle = CAPTION_SECONDARY_COLOR;
      context.fillText(CAPTION_SEPARATOR, cursor, baselineY);
      cursor += context.measureText(CAPTION_SEPARATOR).width;
    }
  });
}

function canvasJpegBytes(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(async (blob) => {
    if (!blob) { reject(new Error("액자 사진을 만들지 못했어요.")); return; }
    resolve(new Uint8Array(await blob.arrayBuffer()));
  }, "image/jpeg", quality));
}

export async function renderInformationFrame(photo, record, mode, frame, quality = 0.85, rollFrameOn = true, rgbHistogramOn = false) {
  const rollFrameLabel = rollFrameOn ? formatRollFrameLabel(record.rollNumber, frame) : null;
  const effectiveRollFrameOn = rollFrameLabel !== null;
  const preflight = evaluateInformationFramePhotoLimit(photo, browserCanvasCapability(), rgbHistogramOn, effectiveRollFrameOn);
  if (!preflight.allowed) throw new Error(preflight.message);
  await Promise.all([document.fonts.load('400 16px "Noto Sans KR Frame"'), document.fonts.load('700 16px "Noto Sans KR Frame"')]);
  const corrected = await correctedPhotoCanvas(photo);
  let canvas = null;
  try {
    const limit = evaluateInformationFrameLimit(corrected.width, corrected.height, browserCanvasCapability(), rgbHistogramOn, effectiveRollFrameOn);
    if (!limit.allowed) throw new Error(limit.message);
    const geometry = limit.geometry;
    canvas = document.createElement("canvas");
    canvas.width = geometry.canvasWidth;
    canvas.height = geometry.canvasHeight;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(corrected, geometry.photoX, geometry.photoY, geometry.photoWidth, geometry.photoHeight);
    if (rgbHistogramOn) drawHistogram(context, geometry, histogramFromDecodedImage(corrected));
    context.textBaseline = "alphabetic";
    context.font = `400 ${geometry.rollFrameFontPx}px "Noto Sans KR Frame"`;
    context.fillStyle = "rgb(70,70,70)";
    if (rollFrameLabel) context.fillText(rollFrameLabel, geometry.topLabelX, geometry.rollFrameLabelBaselineY);
    context.fillStyle = "rgb(115,115,115)";
    const ruleHeight = geometry.captionBlockHeight - geometry.ruleWidth + 1;
    context.fillRect(geometry.leftRuleX, geometry.captionTopY, geometry.ruleWidth, ruleHeight);
    context.fillRect(geometry.centerRuleX, geometry.captionTopY, geometry.ruleWidth, ruleHeight);
    const caption = buildInformationFrameCaption(record, mode);
    const line1Y = geometry.captionTopY + geometry.captionFontPx;
    const line2Y = line1Y + geometry.typographyRowGap;
    drawInformationFrameLine(context, caption.left[0], geometry.leftRuleX + geometry.leftTextInset, line1Y, geometry.leftColumnWidth, geometry.captionFontPx, geometry.minimumCaptionFontPx);
    drawInformationFrameLine(context, caption.left[1], geometry.leftRuleX + geometry.leftTextInset, line2Y, geometry.leftColumnWidth, geometry.captionFontPx, geometry.minimumCaptionFontPx);
    drawInformationFrameLine(context, caption.right[0], geometry.centerRuleX + geometry.rightTextInset, line1Y, geometry.rightColumnWidth, geometry.captionFontPx, geometry.minimumCaptionFontPx);
    drawInformationFrameLine(context, caption.right[1], geometry.centerRuleX + geometry.rightTextInset, line2Y, geometry.rightColumnWidth, geometry.captionFontPx, geometry.minimumCaptionFontPx);
    return { bytes: await canvasJpegBytes(canvas, quality), canvas, geometry };
  } catch (error) {
    if (canvas) releaseCanvas(canvas);
    throw error;
  } finally {
    releaseCanvas(corrected);
  }
}
