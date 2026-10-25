import { naturalSort } from "../core/natural-sort.js";
import { inspectPhoto } from "../core/image-format.js";

const MIB = 1024 * 1024;
const ZIP_INPUT_CHUNK_BYTES = 64 * 1024;
const LIMIT_MESSAGE = "파일이 너무 커서 가져오지 않았어요.";
const PHOTO_NAME = /\.(?:jpe?g|png)$/i;

export const WEB_ZIP_LIMITS = Object.freeze({
  maxZipBytes: 256 * MIB,
  maxEntryCount: 200,
  maxTotalUncompressedBytes: 384 * MIB,
  maxSingleEntryUncompressedBytes: 32 * MIB,
});

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

function zipLimits(overrides = {}) {
  return { ...WEB_ZIP_LIMITS, ...overrides };
}

function tooLarge() {
  return new Error(LIMIT_MESSAGE);
}

function endOfCentralDirectory(bytes, view) {
  const earliest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= earliest; offset -= 1) {
    if (uint32(view, offset) !== 0x06054b50) continue;
    const commentLength = uint16(view, offset + 20);
    if (offset + 22 + commentLength !== bytes.length) continue;
    if (uint16(view, offset + 4) !== 0 || uint16(view, offset + 6) !== 0) {
      throw new Error("여러 디스크로 나뉜 ZIP은 열 수 없어요.");
    }
    const diskEntries = uint16(view, offset + 8);
    const entries = uint16(view, offset + 10);
    if (diskEntries !== entries) throw new Error("ZIP의 항목 표가 맞지 않아요.");
    return { offset, entries, size: uint32(view, offset + 12), start: uint32(view, offset + 16) };
  }
  throw new Error("ZIP 항목 표를 찾지 못했어요.");
}

function centralEntries(bytes, limits) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const end = endOfCentralDirectory(bytes, view);
  if (end.entries > limits.maxEntryCount) throw tooLarge();
  const centralEnd = end.start + end.size;
  if (centralEnd > end.offset || centralEnd > bytes.length) throw new Error("ZIP의 항목 표가 잘렸어요.");
  const entries = [];
  let totalUncompressedSize = 0;
  let largestEntrySize = 0;
  let offset = end.start;
  while (entries.length < end.entries) {
    if (offset + 46 > centralEnd || uint32(view, offset) !== 0x02014b50) {
      throw new Error("ZIP의 항목 표가 잘렸어요.");
    }
    const flags = uint16(view, offset + 8);
    const compressedSize = uint32(view, offset + 20);
    const size = uint32(view, offset + 24);
    const nameLength = uint16(view, offset + 28);
    const extraLength = uint16(view, offset + 30);
    const commentLength = uint16(view, offset + 32);
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > centralEnd) throw new Error("ZIP의 항목 표가 잘렸어요.");
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.push({ name, flags, compressedSize, size });
    totalUncompressedSize += size;
    largestEntrySize = Math.max(largestEntrySize, size);
    if (size > limits.maxSingleEntryUncompressedBytes || totalUncompressedSize > limits.maxTotalUncompressedBytes) {
      throw tooLarge();
    }
    offset = entryEnd;
  }
  if (offset !== centralEnd) throw new Error("ZIP의 항목 표가 맞지 않아요.");
  return { entries, totalUncompressedSize, largestEntrySize };
}

export function isSafeZipPath(name) {
  const normalized = String(name).replace(/\\/g, "/");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return false;
  return !normalized.split("/").some((part) => part === "..");
}

function inspectZipRecords(bytes, overrides) {
  const limits = zipLimits(overrides);
  if (bytes.length > limits.maxZipBytes) throw tooLarge();
  const inspected = centralEntries(bytes, limits);
  for (const entry of inspected.entries) {
    if ((entry.flags & 1) !== 0) throw new Error("암호가 걸린 ZIP은 열 수 없어요.");
    if (!isSafeZipPath(entry.name)) throw new Error("폴더 밖을 가리키는 ZIP 경로가 있어요.");
  }
  return { ...inspected, limits };
}

export function inspectZip(bytes, overrides) {
  const inspected = inspectZipRecords(bytes, overrides);
  return {
    entries: inspected.entries.length,
    totalUncompressedSize: inspected.totalUncompressedSize,
    largestEntrySize: inspected.largestEntrySize,
  };
}

function joined(chunks, length) {
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function unzipPhotos(bytes, inspected) {
  const expected = new Map();
  for (const entry of inspected.entries) {
    if (!PHOTO_NAME.test(entry.name) || entry.name.endsWith("/")) continue;
    expected.set(entry.name, (expected.get(entry.name) ?? 0) + 1);
  }
  const files = [];
  let totalBytes = 0;
  try {
    const tool = library();
    const unzip = new tool.Unzip((file) => {
      if (!PHOTO_NAME.test(file.name) || file.name.endsWith("/")) return;
      if (!isSafeZipPath(file.name) || !expected.get(file.name)) throw new Error("ZIP의 항목 표가 맞지 않아요.");
      expected.set(file.name, expected.get(file.name) - 1);
      const chunks = [];
      let entryBytes = 0;
      file.ondata = (error, chunk, final) => {
        if (error) throw error;
        entryBytes += chunk.length;
        totalBytes += chunk.length;
        if (entryBytes > inspected.limits.maxSingleEntryUncompressedBytes || totalBytes > inspected.limits.maxTotalUncompressedBytes) {
          file.terminate();
          throw tooLarge();
        }
        chunks.push(chunk.slice());
        if (final) files.push({ name: file.name, bytes: joined(chunks, entryBytes) });
      };
      file.start();
    });
    unzip.register(tool.UnzipInflate);
    for (let offset = 0; offset < bytes.length; offset += ZIP_INPUT_CHUNK_BYTES) {
      const end = Math.min(offset + ZIP_INPUT_CHUNK_BYTES, bytes.length);
      unzip.push(bytes.subarray(offset, end), end === bytes.length);
    }
  } catch (error) {
    if (error.message === LIMIT_MESSAGE) throw error;
    throw new Error(`ZIP을 풀지 못했어요: ${error.message}`);
  }
  if ([...expected.values()].some((count) => count !== 0)) throw new Error("ZIP을 풀지 못했어요: ZIP의 항목 표가 맞지 않아요.");
  return files;
}

export function readPhotoZip(bytes, overrides) {
  const inspected = inspectZipRecords(bytes, overrides);
  const extracted = unzipPhotos(bytes, inspected);
  const byName = new Map(extracted.map((file) => [file.name, file.bytes]));
  const names = naturalSort(extracted.map((file) => file.name));
  if (!names.length) throw new Error("ZIP에서 JPEG 또는 PNG 사진을 찾지 못했어요.");
  return names.map((name) => ({ name, bytes: byName.get(name), ...inspectPhoto(name, byName.get(name)) }));
}

export function makeZip(files) {
  for (const file of files) {
    const name = String(file.name);
    const hasControl = [...name].some((character) => {
      const point = character.codePointAt(0);
      return (point >= 0x0000 && point <= 0x001f) || (point >= 0x007f && point <= 0x009f);
    });
    if (!name || name.includes("/") || name.includes("\\") || name.includes("..") || hasControl) {
      throw new Error("내보낼 파일 이름을 만들지 못했어요.");
    }
  }
  return library().zipSync(Object.fromEntries(files.map((file) => [file.name, file.bytes])), { level: 6 });
}
