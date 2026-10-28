import { createZipWriter, makeZip } from "../adapters/zip.js";
import { writePhotoMetadata } from "../adapters/exif.js";
import { makeExportFilename } from "./export-rules.js";
import { evaluateInformationFramePhotoLimit, renderInformationFrame } from "./information-frame.js";
import { correctedPhotoCanvas, correctedPhotoDimensions, releaseCanvas } from "./photo-correction.js";

export function effectivePaddingRatio(blockWidth, blockHeight, ratio) {
  return blockWidth > blockHeight && (ratio === "4:5" || ratio === "3:4") ? "original" : ratio;
}

export function computePaddingRatioLayout(blockWidth, blockHeight, ratio, photoY = null, photoHeight = null) {
  if (!Number.isInteger(blockWidth) || !Number.isInteger(blockHeight) || blockWidth <= 0 || blockHeight <= 0) throw new Error("사진 크기는 양의 정수여야 해요.");
  const appliedRatio = effectivePaddingRatio(blockWidth, blockHeight, ratio);
  let canvasWidth = blockWidth;
  let canvasHeight = blockHeight;
  if (appliedRatio === "4:5" && 4 * blockHeight > 5 * blockWidth) {
    const s = Math.floor((4 * blockHeight - 5 * blockWidth) / 8 + 0.5);
    canvasWidth = 4 * Math.ceil((blockWidth + 2 * s) / 4);
    canvasHeight = 5 * canvasWidth / 4;
  } else if (appliedRatio === "3:4" && 3 * blockHeight > 4 * blockWidth) {
    const s = Math.floor(2 * (3 * blockHeight - 4 * blockWidth) / 13 + 0.5);
    canvasWidth = 3 * Math.ceil((blockWidth + 2 * s) / 3);
    canvasHeight = 4 * canvasWidth / 3;
  } else if (appliedRatio === "1:1" && blockHeight > blockWidth) {
    const s = Math.floor(2 * (blockHeight - blockWidth) / 3 + 0.5);
    canvasWidth = blockWidth + 2 * s;
    canvasHeight = canvasWidth;
  } else if (appliedRatio === "4:5") {
    const unit = Math.max(Math.ceil(blockWidth / 4), Math.ceil(blockHeight / 5));
    canvasWidth = 4 * unit;
    canvasHeight = 5 * unit;
  } else if (appliedRatio === "3:4") {
    const unit = Math.max(Math.ceil(blockWidth / 3), Math.ceil(blockHeight / 4));
    canvasWidth = 3 * unit;
    canvasHeight = 4 * unit;
  } else if (appliedRatio === "1:1") {
    canvasWidth = canvasHeight = Math.max(blockWidth, blockHeight);
  } else if (appliedRatio !== "original") throw new Error("내보낼 비율을 고르지 못했어요.");
  let y = Math.floor((canvasHeight - blockHeight) / 2);
  if (appliedRatio === "1:1" && photoY !== null && photoHeight !== null) {
    if (!Number.isInteger(photoY) || !Number.isInteger(photoHeight) || photoY < 0 || photoHeight <= 0 || photoY + photoHeight > blockHeight) throw new Error("사진 범위가 블록 안에 있어야 해요.");
    y = Math.min(Math.max(Math.floor((canvasHeight - photoHeight) / 2) - photoY, 0), canvasHeight - blockHeight);
  }
  return { canvasWidth, canvasHeight, x: Math.floor((canvasWidth - blockWidth) / 2), y };
}

export function applyPaddingRatioCanvas(block, ratio, photoY = null, photoHeight = null) {
  if (effectivePaddingRatio(block.width, block.height, ratio) === "original") return block;
  const layout = computePaddingRatioLayout(block.width, block.height, ratio, photoY, photoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(block, layout.x, layout.y);
  return canvas;
}

export function applyPaddingRatioFilename(name, ratio, blockWidth = null, blockHeight = null) {
  const appliedRatio = blockWidth !== null && blockHeight !== null ? effectivePaddingRatio(blockWidth, blockHeight, ratio) : ratio;
  if (appliedRatio === "original") return name;
  const suffix = { "4:5": "_4x5", "3:4": "_3x4", "1:1": "_1x1" }[appliedRatio];
  if (!suffix) throw new Error("내보낼 비율을 고르지 못했어요.");
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}${suffix}${name.slice(dot)}` : `${name}${suffix}`;
}

function metadataOnlyBytes(item, metadata) {
  return item.format === "png" ? item.bytes : writePhotoMetadata(item.bytes, metadata);
}

export function exportPhotoZip(items, rollName = "roll") {
  const files = items.map((item) => {
    const format = item.format ?? "jpeg";
    const extension = format === "png" ? "png" : "jpg";
    const nameResult = makeExportFilename({
      roll: rollName,
      frame: item.frame,
      width: 2,
      includeCut: false,
      cut: null,
      mode: "off",
      ext: extension,
    });
    if (nameResult.result !== "name") throw new Error("내보낼 파일 이름을 만들지 못했어요.");
    const metadata = { ...item.record, roll: item.record.rollNumber ?? rollName, frame: item.frame };
    const bytes = metadataOnlyBytes(item, metadata);
    return { name: nameResult.name, bytes };
  });
  return { bytes: makeZip(files), files };
}

export async function exportFramedPhotoZip(items, rollName, mode) {
  const files = [];
  const photoOnlyFrames = [];
  for (const item of items) {
    const frameAllowed = evaluateInformationFramePhotoLimit(item).allowed;
    const extension = frameAllowed || item.format !== "png" ? "jpg" : "png";
    const nameResult = makeExportFilename({
      roll: rollName, frame: item.frame, width: 2, includeCut: false, cut: null,
      mode: frameAllowed ? mode : "off", ext: extension,
    });
    if (nameResult.result !== "name") throw new Error("내보낼 파일 이름을 만들지 못했어요.");
    const metadata = { ...item.record, roll: item.record.rollNumber ?? rollName, frame: item.frame };
    if (!frameAllowed) {
      files.push({ name: nameResult.name, bytes: metadataOnlyBytes(item, metadata) });
      photoOnlyFrames.push(item.frame);
      continue;
    }
    const rendered = await renderInformationFrame(item, metadata, mode, item.frame, 0.85);
    files.push({ name: nameResult.name, bytes: writePhotoMetadata(rendered.bytes, metadata) });
  }
  return { bytes: makeZip(files), files, photoOnlyFrames };
}

function canvasBytes(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(async (blob) => {
    if (!blob || blob.type !== type) {
      reject(new Error(type === "image/webp" ? "이 브라우저에서는 WebP를 만들 수 없어요." : "사진 파일을 만들지 못했어요."));
      return;
    }
    resolve(new Uint8Array(await blob.arrayBuffer()));
  }, type, quality));
}

/**
 * The browser export screen's real ZIP output. It keeps JPEG photo-only bytes when possible and uses Canvas only for
 * a requested conversion or frame. Each file goes into the ZIP as soon as it exists and is kept only as a Blob
 * (`blob`, `size`) for the result screen; every canvas is released right after its bytes are made.
 * Returns `{ zip: Blob, files, photoOnlyFrames }`.
 */
export async function exportConfiguredZip(items, {
  rollName = "roll", mode = "off", format = "jpeg", quality = 0.9, width = 2,
  includeCut = false, rollFrameLabel = false, rgbHistogram = false, paddingRatio = "original",
} = {}) {
  const type = { jpeg: "image/jpeg", webp: "image/webp", png: "image/png" }[format];
  const extension = { jpeg: "jpg", webp: "webp", png: "png" }[format];
  if (!type) throw new Error("내보낼 사진 형식을 고르지 못했어요.");
  const writer = createZipWriter();
  const files = [];
  const photoOnlyFrames = [];
  for (const item of items) {
    const metadata = { ...item.record, roll: item.record.rollNumber ?? rollName, frame: item.frame };
    const frameAllowed = mode === "off" || evaluateInformationFramePhotoLimit(item).allowed;
    const actualMode = frameAllowed ? mode : "off";
    if (!frameAllowed) photoOnlyFrames.push(item.frame);
    const nameResult = makeExportFilename({
      roll: rollName, frame: item.frame, width, includeCut, cut: item.cutName || null,
      mode: actualMode, ext: extension,
    });
    if (nameResult.result !== "name") throw new Error("내보낼 파일 이름을 만들지 못했어요.");

    let bytes;
    let outputName = nameResult.name;
    let shown = correctedPhotoDimensions(item.width, item.height, item.correction);
    const correction = item.correction ?? { turns: 0, flipped: false };
    const unchanged = correction.turns % 4 === 0 && !correction.flipped;
    if (actualMode === "off" && format === "jpeg" && item.format !== "png" && unchanged) {
      bytes = metadataOnlyBytes(item, metadata);
    } else {
      const made = [];
      try {
        const rendered = actualMode === "off" ? null : await renderInformationFrame(item, metadata, actualMode, item.frame, quality, rollFrameLabel, rgbHistogram);
        let canvas = actualMode === "off" ? await correctedPhotoCanvas(item) : rendered.canvas;
        made.push(canvas);
        if (actualMode !== "off") {
          const blockWidth = canvas.width;
          const blockHeight = canvas.height;
          canvas = applyPaddingRatioCanvas(canvas, paddingRatio, rendered.geometry.photoY, rendered.geometry.photoHeight);
          if (!made.includes(canvas)) made.push(canvas);
          outputName = applyPaddingRatioFilename(outputName, paddingRatio, blockWidth, blockHeight);
        }
        shown = { width: canvas.width, height: canvas.height };
        bytes = await canvasBytes(canvas, type, quality);
      } finally {
        for (const canvas of made) releaseCanvas(canvas);
      }
      if (format === "jpeg") bytes = writePhotoMetadata(bytes, metadata);
    }
    writer.add(outputName, bytes);
    files.push({ name: outputName, type, blob: new Blob([bytes], { type }), size: bytes.length, ...shown });
  }
  return { zip: writer.finish(), files, photoOnlyFrames };
}

export function downloadBytes(bytes, name, type = "application/zip") {
  const url = URL.createObjectURL(bytes instanceof Blob ? bytes : new Blob([bytes], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
