const reasonLine = {
  disconnected: (numbers) => `${numbers}번 컷은 연결이 끊어져 내보낼 수 없어요.`,
  unreadable: (numbers) => `${numbers}번 컷은 스캔 파일이 열리지 않아 내보낼 수 없어요.`,
  changed: (numbers) => `${numbers}번 컷은 스캔 파일이 바뀌어 내보낼 수 없어요.`,
  noScan: (numbers) => `${numbers}번 컷은 스캔이 없어 내보낼 수 없어요.`,
  frameTooLarge: (numbers) => `${numbers}번은 커서 액자 없이 저장했어요.`,
};

const MAX_FILENAME_BYTES = 255;
const textEncoder = new TextEncoder();
const whiteSpace = new Set([
  ...Array.from({ length: 5 }, (_, index) => 0x0009 + index),
  0x0020, 0x0085, 0x00a0, 0x1680,
  ...Array.from({ length: 11 }, (_, index) => 0x2000 + index),
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);
const denyRanges = [
  [0x0000, 0x001f], [0x007f, 0x009f],
  [0x061c, 0x061c], [0x200e, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069],
  [0x00ad, 0x00ad], [0x180e, 0x180e], [0x200b, 0x200b], [0x2060, 0x2064], [0xfeff, 0xfeff],
  [0x115f, 0x1160], [0x3164, 0x3164], [0xffa0, 0xffa0], [0x2028, 0x2029],
];
const deniedAscii = new Set([..."/\\:*?\"<>|"].map((character) => character.codePointAt(0)));

function codePoints(value) {
  return [...String(value)];
}

function trimName(value) {
  const points = codePoints(value);
  let start = 0;
  let end = points.length;
  while (start < end && whiteSpace.has(points[start].codePointAt(0))) start += 1;
  while (end > start && whiteSpace.has(points[end - 1].codePointAt(0))) end -= 1;
  return points.slice(start, end).join("");
}

function deniedCodePoint(value) {
  for (const character of value) {
    const point = character.codePointAt(0);
    if (deniedAscii.has(point) || denyRanges.some(([start, end]) => point >= start && point <= end)) return point;
  }
  return null;
}

function utf8Length(value) {
  return textEncoder.encode(value).length;
}

export function checkRollName(raw) {
  const value = trimName(raw);
  if (!value) return { result: "invalid", reason: "empty" };
  const offendingCodePoint = deniedCodePoint(value);
  if (offendingCodePoint !== null) return { result: "invalid", reason: "denied_character", offendingCodePoint };
  if (value.startsWith(".")) return { result: "invalid", reason: "leading_dot" };
  if (utf8Length(`${value}_1.webp`) > MAX_FILENAME_BYTES) return { result: "invalid", reason: "too_long" };
  return { result: "valid", value };
}

export function checkCutName(raw) {
  if (raw == null) return { result: "valid", value: null };
  const value = trimName(raw);
  if (!value) return { result: "valid", value: null };
  const offendingCodePoint = deniedCodePoint(value);
  if (offendingCodePoint !== null) return { result: "invalid", reason: "denied_character", offendingCodePoint };
  return { result: "valid", value };
}

export function isSafeExportName(name) {
  const value = String(name);
  if (!value || value.includes("/") || value.includes("\\") || value.includes("..")) return false;
  return !codePoints(value).some((character) => {
    const point = character.codePointAt(0);
    return (point >= 0x0000 && point <= 0x001f) || (point >= 0x007f && point <= 0x009f);
  });
}

export function makeExportArchiveFilename(roll) {
  const checked = checkRollName(roll);
  if (checked.result !== "valid") return { result: "invalid" };
  const name = `${checked.value}_photos.zip`;
  if (utf8Length(name) > MAX_FILENAME_BYTES) return { result: "too_long" };
  return isSafeExportName(name) ? { result: "name", name } : { result: "invalid" };
}

export function compactNumbers(numbers) {
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  const parts = [];
  for (let index = 0; index < unique.length; index += 1) {
    const start = unique[index];
    let end = start;
    while (index + 1 < unique.length && unique[index + 1] === end + 1) {
      end = unique[++index];
    }
    parts.push(start === end ? String(start) : `${start}~${end}`);
  }
  return parts.join("·");
}

export function makeExportFilename(input) {
  const frame = Number(input.frame);
  if (!Number.isInteger(frame) || frame < 1 || ![1, 2, 3].includes(input.width)
    || !["jpg", "png", "webp"].includes(input.ext) || !["off", "simple", "detail"].includes(input.mode ?? "off")) {
    return { result: "invalid" };
  }
  const roll = checkRollName(input.roll);
  if (roll.reason === "too_long") return { result: "too_long" };
  if (roll.result !== "valid") return { result: "invalid" };
  const cutName = input.includeCut ? checkCutName(input.cut) : { result: "valid", value: null };
  if (cutName.result !== "valid") return { result: "invalid" };
  const number = String(frame).padStart(input.width, "0");
  const cut = input.includeCut && cutName.value ? `_${cutName.value}` : "";
  const mode = input.mode && input.mode !== "off" ? `_${input.mode}` : "";
  const name = `${roll.value}_${number}${cut}${mode}.${input.ext}`;
  if (utf8Length(name) > MAX_FILENAME_BYTES) return { result: "too_long" };
  return isSafeExportName(name) ? { result: "name", name } : { result: "invalid" };
}

export function groupExcludedLines(excluded) {
  const groups = new Map();
  for (const item of excluded) {
    if (!reasonLine[item.reason]) continue;
    if (!groups.has(item.reason)) groups.set(item.reason, new Set());
    groups.get(item.reason).add(item.frame);
  }
  return [...groups.entries()]
    .map(([reason, frames]) => ({ reason, frames: [...frames].sort((a, b) => a - b) }))
    .sort((left, right) => left.frames[0] - right.frames[0])
    .map(({ reason, frames }) => ({
      text: reasonLine[reason](compactNumbers(frames)),
      frames,
    }));
}

export function missingNumberLine(label, values) {
  return values.length ? `${label}: ${compactNumbers(values)}번` : null;
}
