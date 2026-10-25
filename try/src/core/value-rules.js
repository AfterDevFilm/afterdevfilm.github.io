function gcd(a, b) {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right) {
    [left, right] = [right, left % right];
  }
  return left || 1;
}

function decimalRational(raw) {
  if (!/^(?:\d{1,5}(?:\.\d+)?|\.\d+)$/.test(raw)) return null;
  const [whole = "0", fraction = ""] = raw.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  if (trimmedFraction.length > 4) return null;
  const denominator = 10 ** trimmedFraction.length;
  const numerator = Number(whole || 0) * denominator + Number(trimmedFraction || 0);
  if (!Number.isSafeInteger(numerator) || numerator <= 0) return null;
  const divisor = gcd(numerator, denominator);
  return [numerator / divisor, denominator / divisor];
}

export function cleanExposureRational(kind, text) {
  const value = String(text ?? "").trim();
  if (!value) return null;

  if (kind === "shutter") {
    const fraction = value.match(/^1\/(\d{1,5})(?:[sS])?$/);
    if (fraction) {
      const denominator = Number(fraction[1]);
      return denominator > 0 ? [1, denominator] : null;
    }
    const seconds = value.match(/^((?:\d{1,5}(?:\.\d+)?|\.\d+))(?:[sS"])?$/);
    return seconds ? decimalRational(seconds[1]) : null;
  }

  if (kind === "aperture") {
    const match = value.match(/^(?:[fF]\/)?((?:\d{1,5}(?:\.\d+)?|\.\d+))$/);
    return match ? decimalRational(match[1]) : null;
  }

  if (kind === "focalLength" || kind === "focal") {
    const match = value.match(/^((?:\d{1,5}(?:\.\d+)?|\.\d+))(?:mm|MM)?$/);
    return match ? decimalRational(match[1]) : null;
  }

  return null;
}

export function rationalText(kind, text) {
  const rational = cleanExposureRational(kind, text);
  return rational ? `${rational[0]}/${rational[1]}` : null;
}

export function normalizeBulb(text) {
  const match = String(text ?? "").trim().match(/^(?:bulb|b|벌브)\s*(\d{1,5}(?:\.\d{1,4})?)(?:s|초)$/i);
  if (!match || Number(match[1]) <= 0) return null;
  return `${match[1]}s`;
}

export function shouldShowExifReason(field, text) {
  if (!String(text ?? "").trim()) return false;
  return cleanExposureRational(field === "focal" ? "focalLength" : field, text) === null;
}

export function sharedCopy(kind) {
  const rows = {
    reason_text: {
      text: "숫자 형식이 아니라 갤러리 정보에는 나오지 않아요. 촬영 정보 액자와 앱 안에는 그대로 남아요.",
      text_ios: "숫자 형식이 아니라 사진 앱 정보에는 나오지 않아요. 촬영 정보 액자와 앱 안에는 그대로 남아요.",
    },
    dialog_title: { text: "셔터를 85s로 바꿀까요?" },
    dialog_body: { text: "갤러리 정보에도 나와요.", text_ios: "사진 앱 정보에도 나와요." },
    dialog_buttons: { text: "아니요|바꾸기" },
  };
  return rows[kind] ?? null;
}

export function formatAperture(text) {
  const value = String(text ?? "");
  return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) ? `f/${value}` : value;
}

export function parseRollFocalLength(text) {
  const value = String(text ?? "");
  const match = value.match(/^(\d{1,5}(?:\.\d+)?)(?:mm)?$/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) && number > 0 ? String(number) : null;
}
