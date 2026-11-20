import { inspectPhoto } from "./image-format.js";
import { judgeJpegCompleteness } from "./jpeg-completeness.js";

export const SCAN_REPLACED_MESSAGE = "스캔을 교체했어요.";
export const SCAN_UNREADABLE_MESSAGE = "스캔 파일을 열 수 없어요.";
export const SCAN_REPLACEMENT_READ_FAILURE = "이 파일을 읽지 못했어요. 다른 파일을 골라 주세요.";

/**
 * Read one user-picked photo without changing it. A null file is the native
 * picker's cancel result and deliberately has no replacement payload.
 */
export async function stageScanReplacement(file) {
  if (!file) return { status: "cancelled" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = inspectPhoto(file.name, bytes);
  const judgement = inspected.format === "jpeg" ? judgeJpegCompleteness(bytes) : null;
  return {
    status: "prepared",
    photo: {
      name: file.name,
      bytes,
      ...inspected,
      completeness: judgement?.state ?? null,
      completenessReason: judgement?.reason ?? null,
    },
  };
}

/**
 * A replacement changes only the Scan/source fields. Everything else on the
 * Cut projection (stable cutId, number, name and shooting information) stays.
 */
export function applyScanReplacement(current, staged) {
  if (!current || staged?.status !== "prepared") {
    return { changed: false, photo: current, message: null, noticeTarget: null };
  }
  return {
    changed: true,
    photo: { ...current, ...staged.photo },
    message: SCAN_REPLACED_MESSAGE,
    noticeTarget: "bulk-result",
  };
}
