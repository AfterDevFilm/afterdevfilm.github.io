const FIELD_OUTPUT = {
  camera: "카메라를",
  lens: "렌즈를",
  focal: "초점거리(mm)를",
  ap: "조리개를",
  sh: "셔터를",
  ev: "노출 보정을",
  film: "필름을",
  maker: "필름 제조사를",
  boxSpeed: "박스 감도를",
  ei: "노출 지수(EI)를",
  process: "현상 방식을",
  lab: "현상소를",
  rollNumber: "롤 번호를",
};

function normalized(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function planBulkShootingInfo(shownByCut, entered, replaceExisting = false) {
  const entries = Object.entries(entered)
    .map(([field, value]) => [field, normalized(value)])
    .filter(([, value]) => value !== null);
  const assignments = {};
  let collisionCutCount = 0;

  for (const [cutId, shown] of Object.entries(shownByCut)) {
    const collisions = entries.filter(([field, value]) => {
      const current = normalized(shown[field]);
      return current !== null && current !== value;
    });
    if (collisions.length) collisionCutCount += 1;
    const changes = {};
    for (const [field, value] of entries) {
      const current = normalized(shown[field]);
      if (current === value) continue;
      if (current === null || replaceExisting) changes[field] = value;
    }
    if (Object.keys(changes).length) assignments[cutId] = changes;
  }

  const changedCutCount = Object.keys(assignments).length;
  const resultText = entries.length === 1
    ? `${changedCutCount}컷에 ${FIELD_OUTPUT[entries[0][0]] ?? "값을"} 넣었어요.`
    : `${changedCutCount}컷에 촬영 정보를 넣었어요.`;
  return { assignments, collisionCutCount, changedCutCount, resultText };
}

export function renumberByOrder(positions) {
  return positions.map((position, index) => ({ ...position, frame: index + 1 }));
}

export function renumberSelection(order, selected, startingAt) {
  const chosen = new Set(selected);
  let next = startingAt;
  return order.map((position) => chosen.has(position.cut)
    ? { ...position, frame: next++ }
    : { ...position });
}

export function shiftSelection(order, selected, amount) {
  const chosen = new Set(selected);
  const shifted = order.map((position) => chosen.has(position.cut)
    ? { ...position, frame: position.frame + amount }
    : { ...position });
  const frames = shifted.map(({ frame }) => frame);
  if (frames.some((frame) => !Number.isInteger(frame) || frame < 1) || new Set(frames).size !== frames.length) return null;
  return shifted;
}

export function selectionIsContiguous(order, selected) {
  if (!selected.length || new Set(selected).size !== selected.length) return false;
  const chosen = new Set(selected);
  const indexes = order.map(({ cut }, index) => chosen.has(cut) ? index : -1).filter((index) => index >= 0);
  if (indexes.length !== chosen.size) return false;
  return indexes.every((index, offset) => index === indexes[0] + offset);
}

export function reverseSelection(order, selected = null) {
  const chosen = selected === null ? order.map(({ cut }) => cut) : selected;
  if (!selectionIsContiguous(order, chosen)) return null;
  const chosenSet = new Set(chosen);
  const indexes = order.map(({ cut }, index) => chosenSet.has(cut) ? index : -1).filter((index) => index >= 0);
  const frames = indexes.map((index) => order[index].frame);
  const reversedCuts = indexes.map((index) => order[index].cut).reverse();
  const result = order.map((position) => ({ ...position }));
  indexes.forEach((index, offset) => { result[index] = { cut: reversedCuts[offset], frame: frames[offset] }; });
  return result;
}

export function moveSelection(order, selected, destinationIndex) {
  const chosen = new Set(selected);
  const moving = order.filter(({ cut }) => chosen.has(cut));
  const remaining = order.filter(({ cut }) => !chosen.has(cut));
  const index = Math.max(0, Math.min(destinationIndex, remaining.length));
  return [...remaining.slice(0, index), ...moving, ...remaining.slice(index)].map((position) => ({ ...position }));
}
