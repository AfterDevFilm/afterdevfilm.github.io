// Confirmation photos use the unique Cut at the record's frame number.
export const TEMPLATE_CUT_PHOTO_COPY = Object.freeze({
  "TXT-UI-0449": "사진 없음",
  "TXT-UI-0450": "맞는 컷이 없어요",
  "TXT-UI-0451": "맞는 컷이 없는 기록은 사진에 붙지 않아요. 불러온 뒤에 컷 번호를 조정해서 붙일 수 있어요.",
});
// TXT-UI-0461/0462/0463 are omitted: web Cuts always contain one photo;
// a Cut with zero scans or without a representative photo is not a web state.

export function templateCutPhotos(records, items) {
  const byFrame = new Map();
  for (const item of items) {
    if (!byFrame.has(item.frame)) byFrame.set(item.frame, []);
    byFrame.get(item.frame).push(item);
  }
  const rows = records.map(({ n }) => {
    const matches = n == null ? [] : byFrame.get(n) ?? [];
    return matches.length === 1 ? { kind: "photo", cutId: matches[0].cutId } : { kind: "none" };
  });
  return { rows, hasUnmatched: rows.some((row) => row.kind === "none") };
}

export function cutPhotoAccessibility({ n, numberRaw }, match) {
  const number = n ?? numberRaw;
  if (number == null || number === "") return null;
  return match.kind === "photo" ? `${number}번 컷 사진`
    : `기록 ${number}번, ${TEMPLATE_CUT_PHOTO_COPY["TXT-UI-0450"]}`;
}
