import {
  FRAME_NUMBER_MESSAGE_KEYS,
  frameNumberMessage,
} from "./frame-number-edit.js";

export const MOVE_AFTER_NUMBER_MAX = 1_000_000_000;

const MOVE_AFTER_MESSAGE_KEYS = Object.freeze({
  selectedOwn: "SELECTED_OWN",
  attachNew: "ATTACH_NEW",
  overlapShift: "OVERLAP_SHIFT",
});

function invalidResult() {
  const messageKey = FRAME_NUMBER_MESSAGE_KEYS.invalid;
  return {
    kind: "invalid",
    completeEnabled: false,
    messageKey,
    messageText: frameNumberMessage(messageKey),
  };
}

/** RULE-UI-0112: pure decision policy for the multi-Cut "move after number" action. */
export function evaluateMoveAfterNumber(typed, cuts, selected) {
  const input = String(typed ?? "");
  if (!input) return { kind: "empty", completeEnabled: false, messageKey: null };

  const parsed = /^[0-9]+$/.test(input) ? Number(input) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MOVE_AFTER_NUMBER_MAX) {
    return invalidResult();
  }

  const number = parsed;
  const selectedCuts = cuts.filter(({ id }) => selected.has(id));
  const unselectedCuts = cuts.filter(({ id }) => !selected.has(id));

  if (selectedCuts.some((cut) => cut.number === number)) {
    return {
      kind: "selected_own",
      completeEnabled: false,
      messageKey: MOVE_AFTER_MESSAGE_KEYS.selectedOwn,
      number,
      normalizedInput: number,
      messageText: `${number}번은 옮기려고 고른 컷이에요. 다른 컷 번호를 입력해 주세요.`,
    };
  }

  const existingTarget = unselectedCuts.find((cut) => cut.number === number);
  if (existingTarget) {
    const order = unselectedCuts.map(({ id }) => id);
    const insertionIndex = order.indexOf(existingTarget.id) + 1;
    order.splice(insertionIndex, 0, ...selectedCuts.map(({ id }) => id));
    return {
      kind: "move_after",
      completeEnabled: true,
      messageKey: null,
      normalizedInput: number,
      order,
      numbers: Object.fromEntries(cuts.map(({ id, number: cutNumber }) => [id, cutNumber])),
    };
  }

  const lastNewNumber = number + selectedCuts.length - 1;
  if (lastNewNumber > MOVE_AFTER_NUMBER_MAX) return invalidResult();

  const order = unselectedCuts.map(({ id }) => id);
  let insertionTarget = null;
  for (const cut of unselectedCuts) {
    if (cut.number < number && (!insertionTarget || cut.number > insertionTarget.number)) {
      insertionTarget = cut;
    }
  }
  const insertionIndex = insertionTarget ? order.indexOf(insertionTarget.id) + 1 : 0;
  order.splice(insertionIndex, 0, ...selectedCuts.map(({ id }) => id));

  const numbers = Object.fromEntries(cuts.map(({ id, number: cutNumber }) => [id, cutNumber]));
  selectedCuts.forEach(({ id }, index) => {
    numbers[id] = number + index;
  });

  let collisionEnd = lastNewNumber;
  let shiftFrom = null;
  let shiftCount = 0;
  const sortedUnselectedCuts = [...unselectedCuts].sort((left, right) => left.number - right.number);
  for (const cut of sortedUnselectedCuts) {
    if (cut.number < number) continue;
    if (cut.number > collisionEnd) break;
    if (collisionEnd === MOVE_AFTER_NUMBER_MAX) return invalidResult();
    if (shiftFrom === null) shiftFrom = cut.number;
    collisionEnd += 1;
    numbers[cut.id] = collisionEnd;
    shiftCount += 1;
  }

  const newNumbers = [number, lastNewNumber];
  if (shiftFrom === null) {
    const range = number === lastNewNumber ? String(number) : `${number}~${lastNewNumber}`;
    return {
      kind: "attach_new",
      completeEnabled: true,
      messageKey: MOVE_AFTER_MESSAGE_KEYS.attachNew,
      normalizedInput: number,
      order,
      numbers,
      newNumbers,
      messageText: `${number}번은 롤에 없는 번호예요. 고른 컷 ${selectedCuts.length}개에 ${range}번을 붙일까요?`,
    };
  }

  return {
    kind: "overlap_shift",
    completeEnabled: true,
    messageKey: MOVE_AFTER_MESSAGE_KEYS.overlapShift,
    normalizedInput: number,
    order,
    numbers,
    newNumbers,
    shiftFrom,
    shiftCount,
    messageText: `겹치는 번호가 있어요. ${shiftFrom}번부터 컷 ${shiftCount}개의 번호를 뒤로 밀까요?`,
  };
}
