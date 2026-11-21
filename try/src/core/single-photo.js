import { checkSinglePhotoName } from "./export-rules.js";

const MAX_FILENAME_BYTES = 255;
const textEncoder = new TextEncoder();

export function makeSinglePhotoFilename(rawName, ext, mode = "off") {
  const checked = checkSinglePhotoName(rawName);
  if (checked.result !== "valid") return { result: "invalid", reason: checked.reason };
  if (!["jpg", "png", "webp"].includes(ext)) return { result: "invalid", reason: "extension" };
  if (!["off", "simple", "detail"].includes(mode)) return { result: "invalid", reason: "mode" };
  const suffix = mode === "off" ? "" : `_${mode}`;
  const name = `${checked.value}${suffix}.${ext}`;
  if (textEncoder.encode(name).length > MAX_FILENAME_BYTES) return { result: "invalid", reason: "too_long" };
  return { result: "name", name };
}
