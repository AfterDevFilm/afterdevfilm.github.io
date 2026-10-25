import { missingNumberLine } from "./export-rules.js";

function templateRows(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line, index) => ({ line: index + 1, number: Number(line.match(/^\s*#?(\d+)\b/)?.[1]) }))
    .filter((row) => Number.isInteger(row.number) && row.number > 0);
}

function templateRollValue(text, key) {
  const expression = new RegExp(`^${key}\\s*:\\s*(.+)$`, "im");
  return String(text).match(expression)?.[1].trim() ?? null;
}

function recalculate(state) {
  const countByNumber = new Map();
  for (const row of state.records) {
    countByNumber.set(row.number, (countByNumber.get(row.number) ?? 0) + 1);
  }
  const cutByNumber = new Map(state.cuts.map((cut) => [cut.frame, cut]));
  const matches = {};
  let confirmations = 0;
  for (const row of state.records) {
    if (countByNumber.get(row.number) > 1) {
      matches[row.line] = "none";
      confirmations += 1;
      continue;
    }
    const cut = cutByNumber.get(row.number);
    matches[row.line] = cut ? `${cut.id}:AUTOMATIC_CANDIDATE` : "none";
  }
  state.matches = matches;
  state.confirmations = confirmations;
}

function applyStep(state, step) {
  if (step.op === "template") {
    state.records = templateRows(step.text);
    state.templateCamera = templateRollValue(step.text, "Camera");
    state.templateLens = templateRollValue(step.text, "Lens");
  } else if (step.op === "reverse_all") {
    state.cuts.reverse().forEach((cut, index) => { cut.frame = index + 1; });
  } else if (step.op === "renumber") {
    state.cuts.find((cut) => cut.id === `c${step.cut}`).frame = step.to;
  } else if (step.op === "move") {
    const index = state.cuts.findIndex((cut) => cut.id === `c${step.cut}`);
    const [cut] = state.cuts.splice(index, 1);
    state.cuts.splice(step.to, 0, cut);
  } else if (step.op === "roll_lens") {
    state.rollLens = step.value;
  } else if (step.op === "override_lens") {
    state.overrideLens.set(`c${step.cut}`, step.value);
  }
  recalculate(state);
}

export function evaluateTemplateMatching(input) {
  if (!input.steps) {
    const missing = input.templateNumbers.filter((value) => !input.rollFrameNumbers.includes(value));
    return {
      unmatchedRecordLine: missingNumberLine("맞는 컷이 없는 기록", input.unmatchedRecordNumbers),
      rollMissingNumberLine: missingNumberLine("롤에 없는 번호", missing),
    };
  }

  const state = {
    cuts: Array.from({ length: input.cuts }, (_, index) => ({ id: `c${index}`, frame: index + 1 })),
    records: [],
    matches: {},
    confirmations: 0,
    templateCamera: null,
    templateLens: null,
    rollLens: null,
    overrideLens: new Map(),
  };
  for (const step of input.steps) applyStep(state, step);
  const output = {
    matches: state.matches,
    confirmations: state.confirmations,
    order: state.cuts.map((cut) => `${cut.id}:${cut.frame}`),
  };
  if (state.templateCamera || state.templateLens) {
    output.lens = state.cuts.map((cut) => `${cut.id}:${state.overrideLens.get(cut.id) ?? state.rollLens ?? state.templateLens}`);
    if (state.overrideLens.size === 0) output.camera = state.cuts.map((cut) => `${cut.id}:${state.templateCamera}`);
    output.recordCameraLens = 0;
  }
  return output;
}

export function matchCutsToPhotos(photos, records) {
  const byNumber = new Map(records.map((record) => [record.n, record]));
  return photos.map((photo, index) => ({
    ...photo,
    frame: index + 1,
    record: byNumber.get(index + 1) ?? {},
  }));
}
