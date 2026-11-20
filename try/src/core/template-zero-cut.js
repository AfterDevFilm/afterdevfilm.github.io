// template-zero-cut: pure RULE-DOM-0105 port of TemplateZeroCutPairing.kt.
export const TEMPLATE_ZERO_CUT_COPY = Object.freeze({
  "TXT-UI-0391": "기록에 0번 컷이 있어요.",
  "TXT-UI-0392": "컷 번호는 1부터 시작해요.",
  "TXT-UI-0393": "1번 사진을 어느 기록에 맞출까요?",
  "TXT-UI-0394": "받은 스캔 맨 앞 3장",
  "TXT-UI-0395": "받은 스캔 {N}장",
  "TXT-UI-0396": "기록을 골라 주세요",
  "TXT-UI-0397": "{N}번 기록부터",
  "TXT-UI-0398": "컷 {C}번은 {R}번 기록{pairs}이에요.",
  "TXT-UI-0399": "{R}번 기록{records}은 컷에 붙지 않아요.",
  "TXT-UI-0400": "{R}번 기록은 짝이 없어요.",
  "TXT-UI-0401": "{R}번 기록부터 뒤 기록 {N}개는 짝이 없어요.",
  "TXT-UI-0402": "스캔 {N}",
  "TXT-UI-0403": "1번 사진을 맞출 기록, 현재 값 {value}, 펼치기",
  "TXT-UI-0404": "고르지 않음",
  "TXT-UI-0405": "선택됨",
  "TXT-UI-0406": "기록을 고르면 켜져요",
  "TXT-UI-0407": "{f}번 기록부터는 컷 번호가 {k}칸씩 밀려요.",
  "TXT-UI-0408": "컷 {C}번은 기록 없음",
  "TXT-UI-0409": "0번 기록 빼고",
  "TXT-UI-0410": "{R}번 기록은 빼고 적은 번호대로 맞춰요."
});

export const TEMPLATE_RECORD_NUMBER_MAX = 2000;
const INT_MAX_VALUE = 2147483647;

export function templateZeroCutText(id, values = {}) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, () => String(value)),
    TEMPLATE_ZERO_CUT_COPY[id]
  );
}

export function zeroOption(numberRaw) {
  return templateZeroCutText("TXT-UI-0397", { N: numberRaw });
}

export function skipExplanation(zeroRecords) {
  return templateZeroCutText("TXT-UI-0410", { R: zeroRecords.join("·") });
}

export function scanCaption(scanCount) {
  return scanCount >= 3 ? TEMPLATE_ZERO_CUT_COPY["TXT-UI-0394"]
    : templateZeroCutText("TXT-UI-0395", { N: scanCount });
}

export function scanAccessibility(index) {
  return templateZeroCutText("TXT-UI-0402", { N: index });
}

export function fieldAccessibility(value) {
  return templateZeroCutText("TXT-UI-0403", {
    value: value ?? TEMPLATE_ZERO_CUT_COPY["TXT-UI-0404"]
  });
}

export function isZeroRecord(record) {
  const match = /^0+/.exec(record.numberRaw);
  return match !== null && match[0] === record.numberRaw;
}

export function pairingFrameNumber(number) {
  return Number.isInteger(number) && number >= 1 && number <= TEMPLATE_RECORD_NUMBER_MAX
    ? number : null;
}

export function assessZeroCut(records, scanCount) {
  if (!Number.isInteger(scanCount) || scanCount < 0) throw new RangeError("scanCount must be a nonnegative integer");
  let z = 0;
  while (z < records.length && isZeroRecord(records[z])) z++;
  const next = records.slice(z).find((record) => pairingFrameNumber(record.number) !== null);
  const defenseReason = z === 0 ? null
    : scanCount === 0 ? "ZERO_SCANS"
    : next === undefined ? "NO_NUMBER_RECORD_AFTER_ZERO_PREFIX" : null;
  const ask = z > 0 && defenseReason === null;
  const options = ask ? records.slice(0, z).map((record, index) => ({
    index, text: zeroOption(record.numberRaw), explanation: null
  })) : [];
  if (ask) options.push({
    index: z,
    text: TEMPLATE_ZERO_CUT_COPY["TXT-UI-0409"],
    explanation: skipExplanation(records.slice(0, z).map((record) => record.numberRaw))
  });
  return {
    ask,
    leadingZeroCount: z,
    nextNumberAfterZeroRecords: next === undefined ? null : pairingFrameNumber(next.number),
    nextNumberRawAfterZeroRecords: next?.numberRaw ?? null,
    options,
    defenseReason
  };
}

export function pairZeroCut(records, scanCount, selectedIndex = null) {
  const assessment = assessZeroCut(records, scanCount);
  const z = assessment.leadingZeroCount;
  if (assessment.ask && (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > z)) {
    throw new RangeError("selectedIndex must be an available option index");
  }
  const j = assessment.ask ? selectedIndex : z;
  const targets = {};
  const detached = [];
  const shiftedBeyondInt = new Set();
  records.forEach((record, index) => {
    if (index < z && index < j) detached.push(index);
    else if (index < z) targets[index] = index - j + 1;
    else if (pairingFrameNumber(record.number) !== null) {
      const number = pairingFrameNumber(record.number);
      const shifted = number + (assessment.ask && j < z ? z - j : 0);
      if (shifted > INT_MAX_VALUE) shiftedBeyondInt.add(index);
      else targets[index] = shifted;
    }
  });
  const unmatched = records.flatMap((record, index) => (
    shiftedBeyondInt.has(index)
    || (index >= z && record.number !== null && pairingFrameNumber(record.number) === null)
    || targets[index] > scanCount
  ) ? [index] : []);
  const byCut = new Map();
  for (const [index, target] of Object.entries(targets)) {
    if (target >= 1 && target <= scanCount) {
      if (!byCut.has(target)) byCut.set(target, []);
      byCut.get(target).push(Number(index));
    }
  }
  const preview = {};
  for (let cut = 1; cut <= Math.min(scanCount, 3); cut++) {
    const indices = byCut.get(cut);
    preview[cut] = indices?.length === 1 ? records[indices[0]].numberRaw : null;
  }
  const pairText = assessment.defenseReason !== null || scanCount === 0
    ? null : previewSentence(preview);
  const noticeText = assessment.ask && j < z ? templateZeroCutText("TXT-UI-0407", {
    f: assessment.nextNumberRawAfterZeroRecords, k: z - j
  }) : null;
  const detachedRaw = detached.map((index) => records[index].numberRaw);
  const detachedText = assessment.ask && detached.length > 0 ? templateZeroCutText("TXT-UI-0399", {
    R: detachedRaw[0], records: detachedRaw.slice(1).map((raw) => `, ${raw}번 기록`).join("")
  }) : null;
  const unmatchedText = assessment.ask && unmatched.length > 0 ? templateZeroCutText(
    unmatched.length === 1 ? "TXT-UI-0400" : "TXT-UI-0401",
    { R: records[unmatched[0]].numberRaw, N: unmatched.length }
  ) : null;
  const pairingMode = assessment.defenseReason === "ZERO_SCANS" ? "WRITTEN_NUMBERS_ZERO_RECORDS_DETACHED"
    : assessment.defenseReason === "NO_NUMBER_RECORD_AFTER_ZERO_PREFIX" ? "NO_NUMBER_RECORDS"
    : assessment.ask ? "ZERO_CUT_SELECTION" : "WRITTEN_NUMBERS";
  return {
    assessment,
    targetCutByRecordIndex: targets,
    detachedRecordIndices: detached,
    unmatchedRecordIndices: unmatched,
    previewRecordRawByCut: preview,
    captionText: assessment.ask ? scanCaption(scanCount) : null,
    pairText,
    noticeText,
    detachedText,
    unmatchedText,
    pairingMode
  };
}

function previewSentence(preview) {
  const entries = Object.entries(preview);
  if (entries.length === 0) return null;
  const [recordPrefix, suffix] = TEMPLATE_ZERO_CUT_COPY["TXT-UI-0398"].split("{pairs}");
  const parts = entries.map(([cut, raw]) => raw === null
    ? templateZeroCutText("TXT-UI-0408", { C: cut })
    : recordPrefix.replaceAll("{C}", () => cut).replaceAll("{R}", () => raw));
  return parts.join(", ") + suffix;
}
