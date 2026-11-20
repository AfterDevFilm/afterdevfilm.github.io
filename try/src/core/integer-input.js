export const INTEGER_INPUT_LABELS = Object.freeze({
  boxSpeed: "박스 감도",
  ei: "노출 지수(EI)",
  rollNumber: "롤 번호",
});

export function canonicalIntegerInput(raw, maximum = (2n ** 63n) - 1n) {
  const input = String(raw ?? "");
  if (!input) return "";
  if (!/^[0-9]+$/.test(input)) return null;
  try {
    const value = BigInt(input);
    if (value < 1n || value > maximum) return null;
    return value.toString();
  } catch {
    return null;
  }
}

export function prepareIntegerFieldInput(key, typed, stored) {
  const label = INTEGER_INPUT_LABELS[key];
  if (!label) return { accepted: true, value: typed };
  if (typed === stored) return { accepted: true, value: stored };
  const maximum = key === "ei" ? 65_535n : key === "boxSpeed" ? 9_999_999n : (2n ** 63n) - 1n;
  const canonical = canonicalIntegerInput(typed, maximum);
  if (canonical !== null) return { accepted: true, value: canonical };
  return {
    accepted: false,
    rejection: /^[0-9]+$/.test(String(typed ?? "")) ? "range" : "notDigits",
    message: key === "ei" && /^[0-9]+$/.test(String(typed ?? ""))
      ? "'노출 지수(EI)'는 1부터 65,535까지 넣을 수 있어요."
      : `'${label}'에 숫자가 아닌 값이 있어요: '${typed}'. 고친 뒤 다시 “완료”를 눌러 주세요.`,
  };
}

export function rollNumberProposal(raw) {
  const value = String(raw ?? "");
  if (!value || value === "—" || value === "-") return { value: null, memo: false, confirmation: false };
  const canonical = canonicalIntegerInput(value);
  if (canonical === null || canonical === "") return { value: null, memo: true, confirmation: false };
  return { value: canonical, memo: false, confirmation: false };
}
