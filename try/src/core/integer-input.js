export const INTEGER_INPUT_LABELS = Object.freeze({
  boxSpeed: "박스 감도",
  ei: "노출 지수(EI)",
  rollNumber: "롤 번호",
});

export function canonicalIntegerInput(raw) {
  const input = String(raw ?? "");
  if (!input) return "";
  if (!/^[0-9]+$/.test(input)) return null;
  try {
    const value = BigInt(input);
    if (value < 1n || value > (2n ** 63n) - 1n) return null;
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
  const canonical = canonicalIntegerInput(value);
  if (canonical === null || canonical === "") return { value: null, memo: true, confirmation: false };
  return { value: canonical, memo: false, confirmation: false };
}
