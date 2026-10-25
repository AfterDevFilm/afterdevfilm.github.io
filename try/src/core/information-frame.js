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

function geometryAtWidth(photoWidthPx, photoHeightPx, rollFrameOn, outputWidth) {
  const widthScale = outputWidth / REFERENCE_WIDTH;
  const scale = (value) => scaleValue(value, widthScale);
  const sideMargin = scale(SIDE_MARGIN_REF);
  const photoWidth = outputWidth - 2 * sideMargin;
  const photoHeight = Math.round(photoWidth * photoHeightPx / photoWidthPx);
  const orientationScale = Math.min(1, photoHeight / photoWidth);
  const fontPxRef = Math.max(12, Math.round(FONT_SIZE_REF * orientationScale));
  const topOuterRef = Math.max(3, Math.round(6 * orientationScale)) + 3;
  const topLabelGapRef = Math.max(4, Math.round(8 * orientationScale));
  const bottomCaptionGapRef = Math.max(6, Math.round(13 * orientationScale));
  const bottomOuterRef = Math.max(6, Math.round(13 * orientationScale));
  const rowGapRef = Math.max(fontPxRef + 4, Math.round(28 * orientationScale));
  const leftInsetRef = Math.max(14, Math.round(22 * orientationScale));
  const rightInsetRef = Math.max(16, Math.round(25 * orientationScale));
  const fontPx = scale(fontPxRef);
  const topOuterMargin = scale(topOuterRef);
  const topLabelPhotoGap = scale(topLabelGapRef);
  const bottomPhotoCaptionGap = scale(bottomCaptionGapRef);
  const bottomOuterMargin = scale(bottomOuterRef);
  const rowGap = scale(rowGapRef);
  const leftTextInset = scale(leftInsetRef);
  const rightTextInset = scale(rightInsetRef);
  const ruleWidth = Math.max(1, scale(1));
  const topLabelX = sideMargin + scale(2);
  const leftRuleX = sideMargin + scale(1);
  const centerRuleX = Math.round(outputWidth * CENTER_RULE_FRACTION);
  const rollFrameLabelBaselineY = rollFrameOn ? topOuterMargin + fontPx : null;
  const photoY = topOuterMargin + (rollFrameOn ? fontPx + topLabelPhotoGap : 0);
  const captionBlockHeight = fontPx + rowGap;
  const captionTopY = photoY + photoHeight + bottomPhotoCaptionGap;
  return {
    canvasWidth: outputWidth, canvasHeight: captionTopY + captionBlockHeight + bottomOuterMargin,
    sideMargin, photoWidth, photoHeight, photoX: sideMargin, photoY, topLabelX, leftRuleX, centerRuleX,
    ruleWidth, leftTextInset, rightTextInset, leftColumnWidth: centerRuleX - (leftRuleX + leftTextInset),
    rightColumnWidth: (outputWidth - sideMargin) - (centerRuleX + rightTextInset),
    rollFrameLabelBaselineY, captionTopY, captionBlockHeight, orientationScale, widthScale,
    captionFontPx: scale(Math.max(12, Math.round(CAPTION_FONT_SIZE_REF * orientationScale))),
    rollFrameFontPx: scale(Math.max(12, Math.round(ROLL_FRAME_FONT_SIZE_REF * orientationScale))),
    typographyRowGap: scale(Math.max(1, Math.round(CAPTION_ROW_GAP_REF * orientationScale))),
  };
}

export function computeInformationFrameGeometry(photoWidth, photoHeight, rollFrameOn = true) {
  if (!Number.isInteger(photoWidth) || !Number.isInteger(photoHeight) || photoWidth <= 0 || photoHeight <= 0) {
    throw new Error("사진 크기는 양의 정수여야 해요.");
  }
  let outputWidth = photoWidth;
  while (geometryAtWidth(photoWidth, photoHeight, rollFrameOn, outputWidth).photoWidth !== photoWidth) outputWidth += 1;
  const geometry = geometryAtWidth(photoWidth, photoHeight, rollFrameOn, outputWidth);
  if (geometry.photoHeight !== photoHeight) throw new Error("사진 크기를 그대로 둘 수 없어요.");
  return geometry;
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

export function evaluateInformationFrameLimit(width, height, capability = browserCanvasCapability()) {
  const geometry = computeInformationFrameGeometry(width, height, true);
  const sourcePixels = width * height;
  const canvasPixels = geometry.canvasWidth * geometry.canvasHeight;
  const allowed = sourcePixels <= capability.photoPixels && canvasPixels <= capability.canvasPixels
    && geometry.canvasWidth <= capability.maxDimension && geometry.canvasHeight <= capability.maxDimension;
  return { allowed, message: allowed ? "" : FRAME_TOO_LARGE, sourcePixels, canvasPixels, geometry, capability };
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

export function drawInformationFrameLine(context, segments, x, baselineY, maxWidth, fontPx) {
  if (!segments.length || maxWidth <= 0) return;
  const joined = formatInformationFrameLine(segments);
  context.font = `${fontPx}px "Noto Sans KR Frame"`;
  if (context.measureText(joined).width > maxWidth) {
    context.fillStyle = CAPTION_SECONDARY_COLOR;
    context.fillText(fitText(context, joined, maxWidth), x, baselineY);
    return;
  }
  let cursor = x;
  segments.forEach((part, index) => {
    context.font = `${part.bold ? 700 : 400} ${fontPx}px "Noto Sans KR Frame"`;
    context.fillStyle = part.bold ? CAPTION_PRIMARY_COLOR : CAPTION_SECONDARY_COLOR;
    context.fillText(part.text, cursor, baselineY);
    cursor += context.measureText(part.text).width;
    if (index < segments.length - 1) {
      context.font = `400 ${fontPx}px "Noto Sans KR Frame"`;
      context.fillStyle = CAPTION_SECONDARY_COLOR;
      context.fillText(CAPTION_SEPARATOR, cursor, baselineY);
      cursor += context.measureText(CAPTION_SEPARATOR).width;
    }
  });
}

async function decodePhoto(bytes, format) {
  const blob = new Blob([bytes], { type: format === "png" ? "image/png" : "image/jpeg" });
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

function canvasJpegBytes(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(async (blob) => {
    if (!blob) { reject(new Error("액자 사진을 만들지 못했어요.")); return; }
    resolve(new Uint8Array(await blob.arrayBuffer()));
  }, "image/jpeg", quality));
}

export async function renderInformationFrame(photo, record, mode, frame, quality = 0.85, rollFrameOn = true) {
  const limit = evaluateInformationFrameLimit(photo.width, photo.height);
  if (!limit.allowed) throw new Error(limit.message);
  await Promise.all([document.fonts.load('400 16px "Noto Sans KR Frame"'), document.fonts.load('700 16px "Noto Sans KR Frame"')]);
  const image = await decodePhoto(photo.bytes, photo.format);
  const geometry = rollFrameOn ? limit.geometry : computeInformationFrameGeometry(photo.width, photo.height, false);
  const canvas = document.createElement("canvas");
  canvas.width = geometry.canvasWidth;
  canvas.height = geometry.canvasHeight;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, geometry.photoX, geometry.photoY, geometry.photoWidth, geometry.photoHeight);
  if (typeof image.close === "function") image.close();
  context.textBaseline = "alphabetic";
  context.font = `400 ${geometry.rollFrameFontPx}px "Noto Sans KR Frame"`;
  context.fillStyle = "rgb(70,70,70)";
  const rollFrameLabel = rollFrameOn ? formatRollFrameLabel(record.rollNumber, frame) : null;
  if (rollFrameLabel) context.fillText(rollFrameLabel, geometry.topLabelX, geometry.rollFrameLabelBaselineY);
  context.fillStyle = "rgb(115,115,115)";
  context.fillRect(geometry.leftRuleX, geometry.captionTopY, geometry.ruleWidth, geometry.captionBlockHeight);
  context.fillRect(geometry.centerRuleX, geometry.captionTopY, geometry.ruleWidth, geometry.captionBlockHeight);
  const caption = buildInformationFrameCaption(record, mode);
  const line1Y = geometry.captionTopY + geometry.captionFontPx;
  const line2Y = line1Y + geometry.typographyRowGap;
  drawInformationFrameLine(context, caption.left[0], geometry.leftRuleX + geometry.leftTextInset, line1Y, geometry.leftColumnWidth, geometry.captionFontPx);
  drawInformationFrameLine(context, caption.left[1], geometry.leftRuleX + geometry.leftTextInset, line2Y, geometry.leftColumnWidth, geometry.captionFontPx);
  drawInformationFrameLine(context, caption.right[0], geometry.centerRuleX + geometry.rightTextInset, line1Y, geometry.rightColumnWidth, geometry.captionFontPx);
  drawInformationFrameLine(context, caption.right[1], geometry.centerRuleX + geometry.rightTextInset, line2Y, geometry.rightColumnWidth, geometry.captionFontPx);
  return { bytes: await canvasJpegBytes(canvas, quality), canvas, geometry };
}
