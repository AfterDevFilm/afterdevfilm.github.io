import { compactNumbers } from "./export-rules.js";

export const TEMPLATE_ROLL_FIELDS = [
  ["name", "롤 이름"],
  ["camera", "카메라"],
  ["lens", "렌즈"],
  ["focal", "초점거리(mm)"],
  ["film", "필름"],
  ["maker", "필름 제조사"],
  ["boxSpeed", "박스 감도"],
  ["ei", "노출 지수(EI)"],
  ["process", "현상 방식"],
  ["lab", "현상소"],
  ["rollNumber", "롤 번호"],
];

export function templateCutPieces(cut) {
  const fields = [
    ["lens", "렌즈", (value) => value],
    ["focal", "초점거리", (value) => /mm$/i.test(value) ? value : `${value}mm`],
    ["ap", "조리개", (value) => value],
    ["sh", "셔터", (value) => value],
    ["ev", "노출 보정", (value) => value],
    ["date", "촬영일", (value) => value],
    ["note", "메모", (value) => value],
  ];
  return fields.flatMap(([key, label, format]) => {
    const value = String(cut?.[key] ?? "").trim();
    return value ? [`${label} ${format(value)}`] : [];
  });
}

export function templateCutLine(cut) {
  const pieces = templateCutPieces(cut);
  return `${cut.n}번  ${pieces.length ? pieces.join(" · ") : "—"}`;
}

export function cutNameRejectedLine(numbers) {
  const values = [...new Set(numbers)].sort((left, right) => left - right);
  return values.length
    ? `${compactNumbers(values)}번은 컷 이름에 쓸 수 없는 글자가 있어 메모에 남겼어요.`
    : null;
}

export function rollMissingNumberLine(templateNumbers, rollNumbers) {
  const available = new Set(rollNumbers);
  const missing = [...new Set(templateNumbers)].filter((number) => !available.has(number)).sort((left, right) => left - right);
  return missing.length ? `롤에 없는 번호: ${compactNumbers(missing)}번` : null;
}
