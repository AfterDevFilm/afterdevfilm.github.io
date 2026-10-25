export const ROLL_VALUE_FIELDS = [
  ["camera", "카메라"],
  ["lens", "렌즈"],
  ["focal", "초점거리"],
  ["film", "필름"],
  ["maker", "필름 제조사"],
  ["boxSpeed", "박스 감도"],
  ["ei", "EI"],
  ["process", "현상 방식"],
  ["lab", "현상소"],
  ["rollNumber", "롤 번호"],
];

function blank(value) {
  return value == null || String(value).trim() === "";
}

const rollValueKeys = new Set(ROLL_VALUE_FIELDS.map(([key]) => key));

export function mergeRollValues(roll, cut) {
  const result = { ...cut };
  for (const [key] of ROLL_VALUE_FIELDS) {
    if (blank(result[key]) && !blank(roll[key])) result[key] = roll[key];
  }
  return result;
}

export function resolveCutField(roll, imported, cut, key) {
  if (!blank(cut?.[key])) {
    return { value: cut[key], inputValue: cut[key], placeholder: "", source: "이 컷에만 입력", hasCutValue: true };
  }
  if (!blank(imported?.[key])) {
    return { value: imported[key], inputValue: "", placeholder: imported[key], source: "가져온 기록", hasCutValue: false };
  }
  if (rollValueKeys.has(key) && !blank(roll?.[key])) {
    return { value: roll[key], inputValue: "", placeholder: roll[key], source: "롤 공통", hasCutValue: false };
  }
  return { value: "", inputValue: "", placeholder: "", source: null, hasCutValue: false };
}

export function resolveCutRecord(roll, imported, cut) {
  const result = mergeRollValues(roll, imported ?? {});
  for (const [key, value] of Object.entries(cut ?? {})) {
    if (key !== "n" && !blank(value)) result[key] = value;
  }
  return result;
}
