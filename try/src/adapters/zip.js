import { naturalSort } from "../core/natural-sort.js";
import { inspectPhoto } from "../core/image-format.js";

function library() {
  if (!globalThis.fflate) throw new Error("ZIP 도구를 불러오지 못했어요.");
  return globalThis.fflate;
}

function uint16(view, offset) {
  return view.getUint16(offset, true);
}

function uint32(view, offset) {
  return view.getUint32(offset, true);
}

function centralEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const entries = [];
  for (let offset = 0; offset + 46 <= bytes.length;) {
    if (uint32(view, offset) !== 0x02014b50) { offset += 1; continue; }
    const flags = uint16(view, offset + 8);
    const compressedSize = uint32(view, offset + 20);
    const size = uint32(view, offset + 24);
    const nameLength = uint16(view, offset + 28);
    const extraLength = uint16(view, offset + 30);
    const commentLength = uint16(view, offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length) throw new Error("ZIP의 항목 표가 잘렸어요.");
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.push({ name, flags, compressedSize, size });
    offset = end;
  }
  if (!entries.length) throw new Error("ZIP 항목 표를 찾지 못했어요.");
  return entries;
}

export function isSafeZipPath(name) {
  const normalized = String(name).replace(/\\/g, "/");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return false;
  return !normalized.split("/").some((part) => part === "..");
}

export function inspectZip(bytes) {
  const entries = centralEntries(bytes);
  for (const entry of entries) {
    if ((entry.flags & 1) !== 0) throw new Error("암호가 걸린 ZIP은 열 수 없어요.");
    if (!isSafeZipPath(entry.name)) throw new Error("폴더 밖을 가리키는 ZIP 경로가 있어요.");
  }
  return {
    entries: entries.length,
    totalUncompressedSize: entries.reduce((sum, entry) => sum + entry.size, 0),
    largestEntrySize: Math.max(...entries.map((entry) => entry.size)),
  };
}

export function readPhotoZip(bytes) {
  inspectZip(bytes);
  let files;
  try {
    files = library().unzipSync(bytes);
  } catch (error) {
    throw new Error(`ZIP을 풀지 못했어요: ${error.message}`);
  }
  const names = naturalSort(Object.keys(files).filter((name) => /\.(?:jpe?g|png)$/i.test(name) && !name.endsWith("/")));
  if (!names.length) throw new Error("ZIP에서 JPEG 또는 PNG 사진을 찾지 못했어요.");
  return names.map((name) => ({ name, bytes: files[name], ...inspectPhoto(name, files[name]) }));
}

export function makeZip(files) {
  return library().zipSync(Object.fromEntries(files.map((file) => [file.name, file.bytes])), { level: 6 });
}
