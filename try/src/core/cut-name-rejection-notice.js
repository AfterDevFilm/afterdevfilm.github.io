import { checkCutName } from "./export-rules.js";

export const CUT_NAME_REJECTION_COPY = Object.freeze({
  "TXT-UI-0468": "촬영 기록 파일에 {N}번 컷의 \"{FIELD}\"{GA} \"{VALUE}\"{RO} 적혀 있어요. {CHARS}는 파일 이름에 쓸 수 없는 글자라서 컷 이름으로 가져올 수 없어요.",
  "TXT-UI-0469": "촬영 기록 파일에서 {N}번 컷의 \"{FIELD}\"에 큰따옴표가 들어 있어 컷 이름으로 가져올 수 없어요. 큰따옴표는 파일 이름에 쓸 수 없어요.",
  "TXT-UI-0470": "촬영 기록 파일에서 {N}번 컷의 \"{FIELD}\"에 파일 이름에 쓸 수 없는 글자가 들어 있어 컷 이름으로 가져올 수 없어요.",
  "TXT-UI-0471": "촬영 기록 파일에서 {N}번 컷의 \"{FIELD}\"에 {CHARS} 등 파일 이름에 쓸 수 없는 글자가 들어 있어 컷 이름으로 가져올 수 없어요.",
  "TXT-UI-0472": "촬영 기록 파일에서 {N}번 컷의 \"{FIELD}\"에 적힌 내용이 너무 길어 컷 이름으로 가져올 수 없어요.",
  "TXT-UI-0473": "촬영 기록 파일에서 {NUMBERS}번 컷의 \"{FIELD}\"에 파일 이름에 쓸 수 없는 글자가 있어 컷 이름으로 가져올 수 없어요.",
  "TXT-UI-0474": "촬영 기록 파일에서 {NUMBERS}번 컷의 \"{FIELD}\"에 적힌 내용이 너무 길어 컷 이름으로 가져올 수 없어요.",
  "TXT-UI-0475": "기록을 불러온 뒤 {N}번 컷을 열면 \"메모\"에서 그 내용을 볼 수 있어요.",
  "TXT-UI-0476": "기록을 불러온 뒤 각 컷을 열면 \"메모\"에서 그 내용을 볼 수 있어요."
});

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const visibleDenied = new Set([...'/\\:*?"<>|']);
function substitute(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key]);
}
function deniedCharacters(value) {
  return [...value].filter((character) => checkCutName(`a${character}b`).reason === "denied_character");
}
function ro(value) {
  const last = [...value].at(-1)?.codePointAt(0);
  if (last < 0xac00 || last > 0xd7a3) return "로";
  const final = (last - 0xac00) % 28;
  return final && final !== 8 ? "으로" : "로";
}
export function cutNameRejectionLines(rejections) {
  const lines = [];
  for (const field of ["컷 이름", "피사체"]) {
    for (const cause of ["characters", "length"]) {
      const group = (rejections ?? []).filter((item) => item.field === field &&
        (checkCutName(item.value).reason === "denied_character" ? "characters" : "length") === cause);
      if (!group.length) continue;
      const values = { FIELD: field, N: group[0].number, NUMBERS: group.map((item) => item.number).sort((a, b) => a - b).join("·") };
      let id;
      if (group.length > 1) id = cause === "characters" ? 473 : 474;
      else if (cause === "length") id = 472;
      else {
        const denied = deniedCharacters(group[0].value);
        const visible = [...new Set(denied.filter((c) => visibleDenied.has(c)))];
        const invisible = denied.some((c) => !visibleDenied.has(c));
        values.CHARS = visible.map((c) => `"${c}"`).join(", ");
        if (visible.includes('"')) id = 469;
        else if (!visible.length) id = 470;
        else if (invisible) id = 471;
        else {
          id = 468;
          const graphemes = [...segmenter.segment(group[0].value)].map((part) => part.segment);
          const shown = graphemes.slice(0, 20).join("");
          values.VALUE = shown + (graphemes.length > 20 ? "…" : "");
          values.GA = field === "피사체" ? "가" : "이";
          values.RO = ro(values.VALUE);
        }
      }
      const sentence = substitute(CUT_NAME_REJECTION_COPY[`TXT-UI-0${id}`], values);
      const suffix = substitute(CUT_NAME_REJECTION_COPY[`TXT-UI-0${group.length > 1 ? 476 : 475}`], values);
      lines.push(`${sentence} ${suffix}`);
    }
  }
  return lines;
}
