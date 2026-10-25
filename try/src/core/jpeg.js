const encoder = new TextEncoder();
const decoder = new TextDecoder();
const xmpHeader = encoder.encode("http://ns.adobe.com/xap/1.0/\0");
const afterdevNamespace = "https://w3id.org/afterdev/xmp/1.0/";
const afterdevFields = [
  "FilmStock", "FilmManufacturer", "BoxSpeed", "ExposureIndex", "FocalLength", "Aperture", "Shutter",
  "ExposureCompensation", "DevelopmentProcess", "Lab", "Roll", "FrameNumber", "ShootingDate",
  "ScanDeviceMake", "ScanDeviceModel",
];

function concat(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function isXmp(payload) {
  if (payload.length < xmpHeader.length) return false;
  return xmpHeader.every((value, index) => payload[index] === value);
}

function isExif(payload) {
  return payload.length >= 6 && decoder.decode(payload.subarray(0, 6)) === "Exif\0\0";
}

function isJfif(payload) {
  return payload.length >= 5 && decoder.decode(payload.subarray(0, 5)) === "JFIF\0";
}

function segmentAt(bytes, offset) {
  if (offset + 4 > bytes.length || bytes[offset] !== 0xff) return null;
  const marker = bytes[offset + 1];
  if (marker === 0xda || marker === 0xd9) return null;
  const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
  const end = offset + length + 2;
  if (length < 2 || end > bytes.length) throw new Error("JPEG 구간이 잘렸어요.");
  return { marker, end, payload: bytes.subarray(offset + 4, end), bytes: bytes.subarray(offset, end) };
}

function orderLeadingExifAfterJfif(bytes) {
  const first = segmentAt(bytes, 2);
  const second = first && segmentAt(bytes, first.end);
  if (!first || !second || first.marker !== 0xe1 || !isExif(first.payload) || second.marker !== 0xe0 || !isJfif(second.payload)) {
    return bytes;
  }
  return concat([bytes.subarray(0, 2), second.bytes, first.bytes, bytes.subarray(second.end)]);
}

export function stripMetadataSegments(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("JPEG 시작 표식이 없어요.");
  const kept = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error("JPEG 구간 표식이 잘못됐어요.");
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) {
      kept.push(bytes.subarray(offset));
      return concat(kept);
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + length + 2 > bytes.length) throw new Error("JPEG 구간이 잘렸어요.");
    const segment = bytes.subarray(offset, offset + length + 2);
    const payload = bytes.subarray(offset + 4, offset + length + 2);
    if (!(marker === 0xe1 && (isExif(payload) || isXmp(payload)))) kept.push(segment);
    offset += length + 2;
  }
  throw new Error("JPEG 이미지 데이터가 없어요.");
}

export function insertXmp(bytes, fields) {
  bytes = orderLeadingExifAfterJfif(bytes);
  const pairs = afterdevFields
    .map((name) => [name, fields[name]])
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([name, value]) => [name, String(value).trim()]);
  if (!pairs.length) return bytes;
  const xmlEscape = (value) => value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;");
  const attributes = pairs.map(([name, value]) => `      afterdev:${name}="${xmlEscape(value)}"`).join("\n");
  const packet = [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    `    <rdf:Description rdf:about=""\n      xmlns:afterdev="${afterdevNamespace}"\n${attributes}/>`,
    "  </rdf:RDF>",
    "</x:xmpmeta>",
    '<?xpacket end="w"?>',
  ].join("\n");
  const body = concat([xmpHeader, encoder.encode(packet)]);
  const length = body.length + 2;
  if (length > 65535) throw new Error("XMP 촬영 정보가 너무 길어요.");
  const segment = concat([new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff]), body]);
  let offset = 2;
  let insertionOffset = 2;
  let exifEnd = null;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const end = offset + segmentLength + 2;
    if (segmentLength < 2 || end > bytes.length) throw new Error("JPEG 구간이 잘렸어요.");
    const payload = bytes.subarray(offset + 4, end);
    if (marker === 0xe0 && offset === 2) insertionOffset = end;
    if (marker === 0xe1 && isExif(payload)) exifEnd = end;
    offset = end;
  }
  insertionOffset = exifEnd ?? insertionOffset;
  return concat([bytes.subarray(0, insertionOffset), segment, bytes.subarray(insertionOffset)]);
}

export function extractXmpText(bytes) {
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const payload = bytes.subarray(offset + 4, offset + length + 2);
    if (marker === 0xe1 && isXmp(payload)) return decoder.decode(payload.subarray(xmpHeader.length));
    offset += length + 2;
  }
  return null;
}
