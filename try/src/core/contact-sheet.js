const SPEC = {
  columns: 6,
  cellWidth: 360,
  cellHeight: 240,
  gapX: 8,
  gapY: 20,
  labelBand: 28,
  marginX: 24,
  marginTop: 24,
  marginBottom: 24,
  labelTextSize: 20,
  headerBand: 72,
  minimumSavedWidth: 1080,
};

const CAPABILITIES = {
  iphone: { id: "iphone-safari", maxPixels: 16_777_216, maxDimension: 4096 },
  chromium: { id: "chromium", maxPixels: 80_000_000, maxDimension: 32767 },
  firefox: { id: "firefox", maxPixels: 62_500_000, maxDimension: 32767 },
  safari: { id: "desktop-safari", maxPixels: 40_000_000, maxDimension: 16384 },
  other: { id: "other", maxPixels: 30_000_000, maxDimension: 10000 },
};

export function contactSheetCapability(userAgent = navigator.userAgent) {
  const ua = String(userAgent);
  if (/iPhone|iPad|iPod/i.test(ua)) return { ...CAPABILITIES.iphone };
  if (/Firefox\//i.test(ua)) return { ...CAPABILITIES.firefox };
  if (/Chrome\//i.test(ua) || /Chromium\//i.test(ua) || /Edg\//i.test(ua)) return { ...CAPABILITIES.chromium };
  if (/Safari\//i.test(ua)) return { ...CAPABILITIES.safari };
  return { ...CAPABILITIES.other };
}

export function contactSheetGeometry(count, header = true, saved = true) {
  if (!Number.isInteger(count) || count < 1) throw new Error("모아 볼 컷이 있어야 해요.");
  const columns = Math.min(SPEC.columns, count);
  const rows = Math.ceil(count / SPEC.columns);
  const sheetWidth = SPEC.marginX * 2 + columns * SPEC.cellWidth + (columns - 1) * SPEC.gapX;
  const width = saved ? Math.max(sheetWidth, SPEC.minimumSavedWidth) : sheetWidth;
  const sheetHeight = SPEC.marginTop + SPEC.marginBottom
    + rows * (SPEC.cellHeight + SPEC.labelBand) + (rows - 1) * SPEC.gapY;
  return { ...SPEC, columns, rows, sheetWidth, width, sheetHeight, height: sheetHeight + (header ? SPEC.headerBand : 0), headerHeight: header ? SPEC.headerBand : 0 };
}

export function evaluateContactSheetLimit(count, header = true, capability = contactSheetCapability()) {
  const geometry = contactSheetGeometry(count, header, true);
  const pixels = geometry.width * geometry.height;
  const allowed = pixels <= capability.maxPixels
    && geometry.width <= capability.maxDimension && geometry.height <= capability.maxDimension;
  return { allowed, geometry, pixels, capability };
}

function fitPhoto(width, height, boxWidth, boxHeight) {
  const scale = Math.min(1, boxWidth / width, boxHeight / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function drawHeader(context, geometry, header) {
  if (!geometry.headerHeight) return;
  context.fillStyle = "white";
  context.fillRect(0, 0, geometry.width, geometry.headerHeight);
  const sideRule = Math.round(geometry.width * 18 / 1080);
  const divider = Math.round(geometry.width * 0.615);
  const ruleTop = Math.round(geometry.headerHeight * 0.22);
  const ruleHeight = Math.round(geometry.headerHeight * 0.56);
  context.fillStyle = "rgb(115,115,115)";
  context.fillRect(sideRule, ruleTop, 1, ruleHeight);
  context.fillRect(divider, ruleTop, 1, ruleHeight);
  const inset = Math.round(geometry.headerHeight / 6);
  const fontSize = Math.max(18, Math.round(geometry.headerHeight * 0.42));
  context.textBaseline = "middle";
  context.fillStyle = "rgb(55,55,55)";
  context.font = `400 ${fontSize}px "Noto Sans KR Frame"`;
  context.fillText(header.left, sideRule + inset, geometry.headerHeight / 2, divider - sideRule - inset * 2);
  context.textAlign = "right";
  context.fillText(header.right, geometry.width - sideRule - inset, geometry.headerHeight / 2, geometry.width - divider - inset * 2);
  context.textAlign = "left";
}

function drawCorrected(context, image, correction, x, y, width, height) {
  context.save();
  context.translate(x + width / 2, y + height / 2);
  context.scale(correction.flipped ? -1 : 1, 1);
  context.rotate(correction.turns * Math.PI / 2);
  const sideways = Math.abs(correction.turns) % 2 === 1;
  context.drawImage(image, -((sideways ? height : width) / 2), -((sideways ? width : height) / 2), sideways ? height : width, sideways ? width : height);
  context.restore();
}

export async function renderContactSheet(items, { header = null, corrections = {} } = {}) {
  const limit = evaluateContactSheetLimit(items.length, Boolean(header));
  if (!limit.allowed) return { ...limit, canvas: null };
  await Promise.all([document.fonts.load('400 20px "Noto Sans KR Frame"'), document.fonts.load('700 20px "Noto Sans KR Frame"')]);
  const canvas = document.createElement("canvas");
  canvas.width = limit.geometry.width;
  canvas.height = limit.geometry.height;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "rgb(20,20,20)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (header) drawHeader(context, limit.geometry, header);
  context.font = `400 ${limit.geometry.labelTextSize}px "Noto Sans KR Frame"`;
  context.fillStyle = "rgb(242,242,242)";
  context.textAlign = "center";
  context.textBaseline = "middle";

  for (const [index, item] of items.entries()) {
    const column = index % limit.geometry.columns;
    const row = Math.floor(index / SPEC.columns);
    const left = (limit.geometry.width - limit.geometry.sheetWidth) / 2 + SPEC.marginX + column * (SPEC.cellWidth + SPEC.gapX);
    const top = limit.geometry.headerHeight + SPEC.marginTop + row * (SPEC.cellHeight + SPEC.labelBand + SPEC.gapY);
    const blob = new Blob([item.bytes], { type: item.format === "png" ? "image/png" : "image/jpeg" });
    const image = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const correction = corrections[item.cutId] ?? { turns: 0, flipped: false };
    const sideways = Math.abs(correction.turns) % 2 === 1;
    const fitted = fitPhoto(sideways ? image.height : image.width, sideways ? image.width : image.height, SPEC.cellWidth, SPEC.cellHeight);
    const x = left + Math.floor((SPEC.cellWidth - fitted.width) / 2);
    const y = top + Math.floor((SPEC.cellHeight - fitted.height) / 2);
    drawCorrected(context, image, correction, x, y, fitted.width, fitted.height);
    if (typeof image.close === "function") image.close();
    context.fillText(String(item.frame), left + SPEC.cellWidth / 2, top + SPEC.cellHeight + SPEC.labelBand / 2);
  }
  return { ...limit, canvas };
}

export function contactSheetBlob(canvas, format = "jpeg", quality = 0.92) {
  const type = { jpeg: "image/jpeg", webp: "image/webp", png: "image/png" }[format];
  if (!type) return Promise.reject(new Error("모아 보기 형식을 고르지 못했어요."));
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (!blob || blob.type !== type) {
      reject(new Error(type === "image/webp" ? "이 브라우저에서는 WebP를 만들 수 없어요." : "모아 보기 파일을 만들지 못했어요."));
      return;
    }
    resolve(blob);
  }, type, quality));
}

export { SPEC as contactSheetSpec };
