import { checkSinglePhotoName } from "./export-rules.js";
import { makeSinglePhotoFilename } from "./single-photo.js";

export const SINGLE_PHOTO_COPY = Object.freeze({
  "TXT-UI-0376": "사진 한 장 가져오기",
  "TXT-UI-0386": "한 컷",
  "TXT-UI-0293": "파일 이름",
  "TXT-UI-0385": "파일 이름을 써야 내보낼 수 있어요",
  "TXT-UI-0509": "이름을 입력해 주세요.",
  "TXT-UI-0510": "이름이 너무 길어요. 조금 줄여 주세요.",
  "TXT-UI-0511": "이름은 점(.)으로 시작할 수 없어요.",
  "TXT-UI-0176": "사용할 수 없는 글자가 있어요.",
  "TXT-UI-0015": "취소",
  "TXT-UI-0237": "공유하기",
  "TXT-UI-0492": "저장하기",
  "TXT-UI-0322": "사진만·간단히·자세히 중에서 하나를 골라 주세요.",
  "TXT-UI-0508": "내보낼 컷을 골라 주세요.",
});

const reasonCopy = Object.freeze({
  empty: SINGLE_PHOTO_COPY["TXT-UI-0509"],
  denied_character: SINGLE_PHOTO_COPY["TXT-UI-0176"],
  leading_dot: SINGLE_PHOTO_COPY["TXT-UI-0511"],
  too_long: SINGLE_PHOTO_COPY["TXT-UI-0510"],
});

export function checkNameDialogInput(raw, mode, ext = "jpg") {
  const checked = checkSinglePhotoName(raw);
  const filename = makeSinglePhotoFilename(raw, ext, mode ?? "off");
  if (checked.result !== "valid" || filename.result !== "name") {
    return { ok: false, line: reasonCopy[checked.reason ?? filename.reason] };
  }
  return { ok: true, name: checked.value };
}

// Browser capability is checked against the generated file at the action, not
// against a guessed probe file. An unsupported share still gives its existing notice.
export function singlePhotoExportState({ name, mode, ext = "jpg", canShare }) {
  const checked = checkNameDialogInput(name, mode, ext);
  const empty = checkSinglePhotoName(name).reason === "empty";
  const nameError = !checked.ok && !empty ? checked.line : null;
  const buttonsEnabled = mode !== null && mode !== undefined && (checked.ok || empty);
  return {
    buttonsEnabled,
    nameError,
    blockerLine: mode == null ? SINGLE_PHOTO_COPY["TXT-UI-0322"] : empty ? reasonCopy.empty : "",
    action: buttonsEnabled ? empty ? "prompt" : "run" : null,
  };
}

export function chooseSinglePhotoAction({ pressed, name, mode }) {
  return checkSinglePhotoName(name).reason === "empty" ? { openNameDialog: pressed } : { run: pressed, name };
}
