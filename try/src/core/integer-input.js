const DECIMAL_ZERO_CODE_POINTS = [
  0x0030, 0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6,
  0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0de6, 0x0e50, 0x0ed0,
  0x0f20, 0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80,
  0x1a90, 0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900,
  0xa9d0, 0xa9f0, 0xaa50, 0xabf0, 0xff10, 0x104a0, 0x10d30, 0x11066,
  0x110f0, 0x11136, 0x111d0, 0x112f0, 0x11450, 0x114d0, 0x11650, 0x116c0,
  0x11730, 0x118e0, 0x11950, 0x11c50, 0x11d50, 0x11da0, 0x11f50, 0x16a60,
  0x16ac0, 0x16b50, 0x1d7ce, 0x1d7d8, 0x1d7e2, 0x1d7ec, 0x1d7f6,
  0x1e140, 0x1e2f0, 0x1e4f0, 0x1e950, 0x1fbf0,
];

export const INTEGER_INPUT_LABELS = Object.freeze({
  boxSpeed: "박스 감도",
  ei: "노출 지수(EI)",
  rollNumber: "롤 번호",
});

function decimalDigit(codePoint) {
  for (const zero of DECIMAL_ZERO_CODE_POINTS) {
    const digit = codePoint - zero;
    if (digit >= 0 && digit <= 9) return digit;
  }
  return null;
}

export function canonicalIntegerInput(raw) {
  const trimmed = String(raw ?? "").replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, "");
  if (!trimmed) return "";
  const codePoints = [...trimmed].map((character) => character.codePointAt(0));
  let index = 0;
  let canonical = "";
  if ([0x2b, 0xff0b].includes(codePoints[0])) { canonical = "+"; index = 1; }
  else if ([0x2d, 0x2212, 0xff0d].includes(codePoints[0])) { canonical = "-"; index = 1; }
  if (index === codePoints.length) return null;
  for (; index < codePoints.length; index += 1) {
    const digit = decimalDigit(codePoints[index]);
    if (digit === null) return null;
    canonical += String(digit);
  }
  try {
    const value = BigInt(canonical);
    if (value < -(2n ** 63n) || value > (2n ** 63n) - 1n) return null;
    return value.toString();
  } catch {
    return null;
  }
}

export function prepareIntegerFieldInput(key, typed, stored) {
  const label = INTEGER_INPUT_LABELS[key];
  if (!label) return { accepted: true, value: typed };
  if (typed === stored) return { accepted: true, value: stored };
  const canonical = canonicalIntegerInput(typed);
  if (canonical !== null) return { accepted: true, value: canonical };
  return {
    accepted: false,
    message: `'${label}'에 숫자가 아닌 값이 있어요: '${typed}'. 고친 뒤 다시 저장해 주세요.`,
  };
}

export function rollNumberProposal(raw) {
  const value = String(raw ?? "");
  if (!value || value === "—" || value === "-") return { value: null, memo: false, confirmation: false };
  const runs = [];
  let current = "";
  let onlyDigits = true;
  for (const character of value) {
    const digit = decimalDigit(character.codePointAt(0));
    if (digit === null) {
      onlyDigits = false;
      if (current) { runs.push(current); current = ""; }
    } else current += String(digit);
  }
  if (current) runs.push(current);
  if (runs.length !== 1) return { value: null, memo: true, confirmation: false };
  const canonical = canonicalIntegerInput(runs[0]);
  if (canonical === null || canonical === "") return { value: null, memo: true, confirmation: false };
  return { value: canonical, memo: false, confirmation: !onlyDigits };
}
