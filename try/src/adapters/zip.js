import { naturalSort } from "../core/natural-sort.js";
import { inspectPhoto } from "../core/image-format.js";
import { judgeJpegCompleteness } from "../core/jpeg-completeness.js";

const MIB = 1024 * 1024;
const ZIP_INPUT_CHUNK_BYTES = 64 * 1024;
const LIMIT_MESSAGE = "파일이 너무 커서 가져오지 않았어요.";
const PHOTO_NAME = /\.(?:jpe?g|png)$/i;
const FILE_CONTENT_MESSAGE = "파일을 읽지 못했어요.";

export const ZIP_ERROR_KIND_LIMIT = "limit";

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

function crcLibrary() {
  if (!globalThis.CRC32?.buf) throw new Error("CRC32 도구를 불러오지 못했어요.");
  return globalThis.CRC32;
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

function tooLarge(limit) {
  const error = new Error(LIMIT_MESSAGE);
  error.kind = ZIP_ERROR_KIND_LIMIT;
  error.limit = limit;
  return error;
}

function isZipSafetyLimit(error) {
  return error?.kind === ZIP_ERROR_KIND_LIMIT;
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

// `bytes` is the whole ZIP, or only its tail that starts at file offset `base`.
function centralEntries(bytes, limits, base = 0) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const end = endOfCentralDirectory(bytes, view);
  if (end.entries > limits.maxEntryCount) throw tooLarge("entryCount");
  const centralEnd = end.start + end.size - base;
  if (end.start < base || centralEnd > end.offset || centralEnd > bytes.length) throw new Error("ZIP의 항목 표가 잘렸어요.");
  const entries = [];
  let totalUncompressedSize = 0;
  let largestEntrySize = 0;
  let offset = end.start - base;
  while (entries.length < end.entries) {
    if (offset + 46 > centralEnd || uint32(view, offset) !== 0x02014b50) {
      throw new Error("ZIP의 항목 표가 잘렸어요.");
    }
    const flags = uint16(view, offset + 8);
    const compression = uint16(view, offset + 10);
    const crc32 = uint32(view, offset + 16);
    const compressedSize = uint32(view, offset + 20);
    const size = uint32(view, offset + 24);
    const nameLength = uint16(view, offset + 28);
    const extraLength = uint16(view, offset + 30);
    const commentLength = uint16(view, offset + 32);
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > centralEnd) throw new Error("ZIP의 항목 표가 잘렸어요.");
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.push({ name, flags, compression, crc32, compressedSize, size });
    totalUncompressedSize += size;
    largestEntrySize = Math.max(largestEntrySize, size);
    if (size > limits.maxSingleEntryUncompressedBytes) throw tooLarge("singleEntryUncompressedBytes");
    if (totalUncompressedSize > limits.maxTotalUncompressedBytes) throw tooLarge("totalUncompressedBytes");
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

function inspectZipRecords(bytes, overrides, base = 0, total = bytes.length) {
  const limits = zipLimits(overrides);
  if (total > limits.maxZipBytes) throw tooLarge("zipBytes");
  const inspected = centralEntries(bytes, limits, base);
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

function isImportCandidateName(name) {
  const normalized = String(name).replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const basename = parts.at(-1) ?? "";
  return !normalized.endsWith("/") && basename && !basename.startsWith(".") && !parts.includes("__MACOSX");
}

function fileContentFailure(name, kind = "fileContentError") {
  return { name, kind, message: FILE_CONTENT_MESSAGE, action: "pickAnother" };
}

/**
 * Incremental photo extractor. Each entry is written straight into one buffer sized from the central directory,
 * so a photo is never held twice (chunk list + joined copy). `push` takes the ZIP in order, in any chunk size.
 */
function photoExtractor(inspected) {
  const declared = new Map();
  const failures = [];
  for (const entry of inspected.entries) {
    if (!isImportCandidateName(entry.name)) continue;
    const supportedCompression = entry.compression === 0 || entry.compression === 8;
    if (!PHOTO_NAME.test(entry.name) && !supportedCompression) continue;
    if (!supportedCompression) {
      failures.push(fileContentFailure(entry.name));
      continue;
    }
    declared.set(entry.name, [...(declared.get(entry.name) ?? []), entry]);
  }
  const files = [];
  let totalBytes = 0;
  const tool = library();
  const crcTool = crcLibrary();
  const unzip = new tool.Unzip((file) => {
    const entries = declared.get(file.name);
    if (!entries?.length) return;
    if (!isSafeZipPath(file.name)) throw new Error("ZIP의 항목 표가 맞지 않아요.");
    const entry = entries.shift();
    const keepPhoto = PHOTO_NAME.test(file.name);
    let output = keepPhoto ? new Uint8Array(entry.size) : null;
    let entryBytes = 0;
    let crc32 = 0;
    let failed = false;
    file.ondata = (error, chunk, final) => {
      if (error) {
        if (isZipSafetyLimit(error)) throw error;
        if (!failed) failures.push(fileContentFailure(file.name));
        failed = true;
        output = null;
        return;
      }
      if (failed) return;
      entryBytes += chunk.length;
      totalBytes += chunk.length;
      crc32 = crcTool.buf(chunk, crc32);
      if (entryBytes > inspected.limits.maxSingleEntryUncompressedBytes) {
        file.terminate();
        throw tooLarge("singleEntryUncompressedBytes");
      }
      if (totalBytes > inspected.limits.maxTotalUncompressedBytes) {
        file.terminate();
        throw tooLarge("totalUncompressedBytes");
      }
      if (output && entryBytes > output.length) {
        const grown = new Uint8Array(Math.max(entryBytes, output.length * 2));
        grown.set(output.subarray(0, entryBytes - chunk.length));
        output = grown;
      }
      output?.set(chunk, entryBytes - chunk.length);
      if (final && (crc32 >>> 0) !== entry.crc32) {
        failures.push(fileContentFailure(file.name, "checksumMismatch"));
      } else if (final && output) {
        files.push({ name: file.name, bytes: entryBytes === output.length ? output : output.slice(0, entryBytes) });
      }
    };
    file.start();
  });
  unzip.register(tool.UnzipInflate);
  return {
    push(chunk, final) {
      try {
        unzip.push(chunk, final);
      } catch (error) {
        if (isZipSafetyLimit(error)) throw error;
        throw new Error(`ZIP을 풀지 못했어요: ${error.message}`);
      }
    },
    finish() {
      if ([...declared.values()].some((entries) => entries.length !== 0)) throw new Error("ZIP을 풀지 못했어요: ZIP의 항목 표가 맞지 않아요.");
      return { files, failures };
    },
  };
}

function photosFrom(extracted) {
  const byName = new Map(extracted.files.map((file) => [file.name, file.bytes]));
  const names = naturalSort(extracted.files.map((file) => file.name));
  if (!names.length && !extracted.failures.length) throw new Error("ZIP에서 JPEG 또는 PNG 사진을 찾지 못했어요.");
  const photos = names.map((name) => {
    const bytes = byName.get(name);
    const photo = { name, bytes, ...inspectPhoto(name, bytes) };
    if (/\.jpe?g$/i.test(name)) {
      const judgement = judgeJpegCompleteness(bytes);
      photo.completeness = judgement.state;
      photo.completenessReason = judgement.reason;
    } else {
      photo.completeness = null;
      photo.completenessReason = null;
    }
    return photo;
  });
  const failuresByName = new Map();
  for (const failure of extracted.failures) failuresByName.set(failure.name, [...(failuresByName.get(failure.name) ?? []), failure]);
  const orderedFailures = naturalSort(extracted.failures.map((failure) => failure.name)).map((name) => failuresByName.get(name).shift());
  Object.defineProperty(photos, "failures", { value: orderedFailures, enumerable: false });
  return photos;
}

export function readPhotoZip(bytes, overrides) {
  const inspected = inspectZipRecords(bytes, overrides);
  const extractor = photoExtractor(inspected);
  for (let offset = 0; offset < bytes.length; offset += ZIP_INPUT_CHUNK_BYTES) {
    const end = Math.min(offset + ZIP_INPUT_CHUNK_BYTES, bytes.length);
    extractor.push(bytes.subarray(offset, end), end === bytes.length);
  }
  return photosFrom(extractor.finish());
}

async function blobBytes(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

/** Same result as `readPhotoZip`, but reads a File/Blob piece by piece, so the whole ZIP is never in memory at once. */
export async function readPhotoZipBlob(blob, overrides) {
  const total = blob.size;
  let base = Math.max(0, total - 22 - 0xffff);
  let tail = await blobBytes(blob, base, total);
  // The central directory sits at the end; take the whole of it (not only the last 64 KiB) when it is longer.
  const limits = zipLimits(overrides);
  if (total <= limits.maxZipBytes && tail.length >= 22) {
    try {
      const end = endOfCentralDirectory(tail, new DataView(tail.buffer, tail.byteOffset, tail.byteLength));
      if (end.entries <= limits.maxEntryCount && end.start < base && end.start + end.size <= total) {
        base = end.start;
        tail = await blobBytes(blob, base, total);
      }
    } catch {
      // The inspection below reports the real problem with the original message.
    }
  }
  const inspected = inspectZipRecords(tail, overrides, base, total);
  tail = null;
  const extractor = photoExtractor(inspected);
  for (let offset = 0; offset < total; offset += ZIP_INPUT_CHUNK_BYTES * 16) {
    const end = Math.min(offset + ZIP_INPUT_CHUNK_BYTES * 16, total);
    extractor.push(await blobBytes(blob, offset, end), end === total);
  }
  return photosFrom(extractor.finish());
}

function assertExportName(file) {
  const name = String(file.name);
  const hasControl = [...name].some((character) => {
    const point = character.codePointAt(0);
    return (point >= 0x0000 && point <= 0x001f) || (point >= 0x007f && point <= 0x009f);
  });
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..") || hasControl) {
    throw new Error("내보낼 파일 이름을 만들지 못했어요.");
  }
}

export function makeZip(files) {
  for (const file of files) assertExportName(file);
  return library().zipSync(Object.fromEntries(files.map((file) => [file.name, file.bytes])), { level: 6 });
}

const ZIP_PART_FLUSH_BYTES = 8 * MIB;

/**
 * Streaming ZIP writer: each file is compressed as it is added and then no longer needed, so the result is built
 * without holding every file next to a second copy. Output pieces are folded into Blob parts every few MiB.
 */
export function createZipWriter({ level = 6 } = {}) {
  const tool = library();
  const parts = [];
  let pending = [];
  let pendingBytes = 0;
  let failure = null;
  let finished = false;
  const names = new Set();
  const flush = () => {
    if (!pending.length) return;
    parts.push(new Blob(pending));
    pending = [];
    pendingBytes = 0;
  };
  const zip = new tool.Zip((error, chunk, final) => {
    if (error) { failure = error; return; }
    pending.push(chunk);
    pendingBytes += chunk.length;
    if (pendingBytes >= ZIP_PART_FLUSH_BYTES) flush();
    if (final) { flush(); finished = true; }
  });
  return {
    add(name, bytes) {
      assertExportName({ name });
      if (names.has(name)) throw new Error("내보낼 파일 이름을 만들지 못했어요.");
      names.add(name);
      const entry = new tool.ZipDeflate(name, { level });
      zip.add(entry);
      entry.push(bytes, true);
      if (failure) throw failure;
    },
    finish() {
      zip.end();
      if (failure) throw failure;
      if (!finished) throw new Error("ZIP 파일을 만들지 못했어요.");
      return new Blob(parts, { type: "application/zip" });
    },
  };
}
