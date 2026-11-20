import { cleanExposureRational } from "../core/value-rules.js";
import { insertXmp, stripMetadataSegments } from "../core/jpeg.js";

function library() {
  if (!globalThis.piexif) throw new Error("EXIF 도구를 불러오지 못했어요.");
  return globalThis.piexif;
}

function isAscii(value) {
  return /^[\x20-\x7e]*$/.test(String(value));
}

function binaryString(bytes) {
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    value += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return value;
}

function bytesFromBinary(value) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index);
  return bytes;
}

function signedRational(value) {
  const match = String(value ?? "").trim().match(/^([+-]?)(\d{1,5})(?:\.(\d{1,4}))?$/);
  if (!match) return null;
  const fraction = match[3] ?? "";
  const denominator = 10 ** fraction.length;
  let numerator = Number(match[2]) * denominator + Number(fraction || 0);
  if (match[1] === "-") numerator *= -1;
  const divisor = ((a, b) => { while (b) [a, b] = [b, a % b]; return Math.abs(a) || 1; })(numerator, denominator);
  return [numerator / divisor, denominator / divisor];
}

function cleanText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function canonicalNumber(value, prefix = "", suffix = "") {
  const text = cleanText(value);
  if (!text) return null;
  const numeric = text.replace(/^f\/?/i, "").replace(/mm$/i, "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(numeric)) return text;
  const number = Number(numeric);
  return Number.isFinite(number) ? `${prefix}${number}${suffix}` : text;
}

function canonicalExposureCompensation(value) {
  const text = cleanText(value);
  if (!text || !/^[+-]?\d+(?:\.\d+)?$/.test(text)) return text;
  const number = Number(text);
  return Number.isFinite(number) ? number.toFixed(1) : text;
}

export function writeExif(jpegBytes, record) {
  const piexif = library();
  const zeroth = {};
  const exif = {};
  if (record.camera && isAscii(record.camera)) zeroth[272] = record.camera;
  if (record.lens && isAscii(record.lens)) exif[42036] = record.lens;
  const aperture = cleanExposureRational("aperture", record.ap);
  const shutter = cleanExposureRational("shutter", record.sh);
  const focal = cleanExposureRational("focalLength", record.focal);
  const bias = signedRational(record.ev);
  if (aperture) exif[33437] = aperture;
  if (shutter) exif[33434] = shutter;
  if (focal) exif[37386] = focal;
  if (bias) exif[37380] = bias;
  const iso = Number(record.ei);
  if (Number.isInteger(iso) && iso > 0 && iso <= 65535) exif[34855] = iso;
  const dumped = piexif.dump({ "0th": zeroth, Exif: exif, GPS: {}, Interop: {}, "1st": {}, thumbnail: null });
  const input = `data:image/jpeg;base64,${btoa(binaryString(jpegBytes))}`;
  const output = piexif.insert(dumped, input);
  return bytesFromBinary(atob(output.slice(output.indexOf(",") + 1)));
}

export function writePhotoMetadata(jpegBytes, record) {
  const withExif = writeExif(stripMetadataSegments(jpegBytes), record);
  return insertXmp(withExif, {
    FilmStock: cleanText(record.film),
    FilmManufacturer: cleanText(record.maker),
    BoxSpeed: cleanText(record.boxSpeed),
    ExposureIndex: cleanText(record.ei),
    FocalLength: canonicalNumber(record.focal, "", "mm"),
    Aperture: canonicalNumber(record.ap),
    Shutter: cleanText(record.sh),
    ExposureCompensation: canonicalExposureCompensation(record.ev),
    DevelopmentProcess: cleanText(record.process),
    Lab: cleanText(record.lab),
    Roll: cleanText(record.rollNumber ?? record.roll),
    FrameNumber: cleanText(record.frame),
    ShootingDate: cleanText(record.date),
  });
}
