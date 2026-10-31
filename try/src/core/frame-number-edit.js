export const FRAME_NUMBER_MAXIMUM = 1_000_000_000;
export const FRAME_NUMBER_HELPER = "다른 컷과 겹치지 않는 번호를 입력해 주세요.";

export const FRAME_NUMBER_MESSAGE_KEYS = Object.freeze({
  invalid: "NUMBER_AT_LEAST_ONE",
  conflict: "FRAME_NUMBER_CONFLICT",
});

export const FRAME_NUMBER_MESSAGES = Object.freeze({
  [FRAME_NUMBER_MESSAGE_KEYS.invalid]: "1 이상의 숫자를 입력해 주세요.",
  [FRAME_NUMBER_MESSAGE_KEYS.conflict]: "다른 컷과 번호가 겹쳐요. 다른 번호를 입력해 주세요.",
});

export function evaluateFrameNumberEdit(typed, current, occupied) {
  const trimmed = String(typed ?? "").trim();
  if (!trimmed) return { value: null, completeEnabled: false, messageKey: null };

  const value = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > FRAME_NUMBER_MAXIMUM) {
    return { value: null, completeEnabled: false, messageKey: FRAME_NUMBER_MESSAGE_KEYS.invalid };
  }
  if (value !== current && occupied.has(value)) {
    return { value, completeEnabled: false, messageKey: FRAME_NUMBER_MESSAGE_KEYS.conflict };
  }
  return { value, completeEnabled: true, messageKey: null };
}

export function frameNumberMessage(messageKey) {
  return messageKey ? FRAME_NUMBER_MESSAGES[messageKey] : null;
}
