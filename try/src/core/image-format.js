function uint32(bytes, offset) {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if (frameMarkers.has(marker) && length >= 7) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (width > 0 && height > 0) return { format: "jpeg", width, height };
    }
    offset += length;
  }
  return null;
}

function pngDimensions(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) return null;
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
  const width = uint32(bytes, 16);
  const height = uint32(bytes, 20);
  return width > 0 && height > 0 ? { format: "png", width, height } : null;
}

export function inspectPhoto(name, bytes) {
  const extension = String(name).toLowerCase().match(/\.([^.]+)$/)?.[1];
  if (!new Set(["jpg", "jpeg", "png"]).has(extension)) throw new Error("JPEG 또는 PNG 사진만 가져올 수 있어요.");
  const result = extension === "png" ? pngDimensions(bytes) : jpegDimensions(bytes);
  if (!result) throw new Error(`${name}의 사진 크기를 읽지 못했어요.`);
  return result;
}

/**
 * Width and height as the picture is shown: a JPEG whose EXIF orientation turns it by a quarter (5 to 8) has the
 * two swapped. `source` is the JPEG bytes or a Blob. If the orientation cannot be read, the stored size is returned.
 */
export async function shownPhotoDimensions(source, width, height, format = "jpeg") {
  if (format === "jpeg" && globalThis.exifr?.orientation) {
    try {
      const orientation = await globalThis.exifr.orientation(source);
      if (orientation >= 5 && orientation <= 8) return { width: height, height: width };
    } catch {
      // No readable EXIF: keep the stored size.
    }
  }
  return { width, height };
}
