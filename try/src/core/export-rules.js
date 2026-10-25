const reasonLine = {
  disconnected: (numbers) => `${numbers}번 컷은 연결이 끊어져 내보낼 수 없어요.`,
  unreadable: (numbers) => `${numbers}번 컷은 스캔 파일이 열리지 않아 내보낼 수 없어요.`,
  changed: (numbers) => `${numbers}번 컷은 스캔 파일이 바뀌어 내보낼 수 없어요.`,
  noScan: (numbers) => `${numbers}번 컷은 스캔이 없어 내보낼 수 없어요.`,
  frameTooLarge: (numbers) => `${numbers}번은 커서 액자 없이 저장했어요.`,
};

export function compactNumbers(numbers) {
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  const parts = [];
  for (let index = 0; index < unique.length; index += 1) {
    const start = unique[index];
    let end = start;
    while (index + 1 < unique.length && unique[index + 1] === end + 1) {
      end = unique[++index];
    }
    parts.push(start === end ? String(start) : `${start}~${end}`);
  }
  return parts.join("·");
}

export function makeExportFilename(input) {
  const frame = Number(input.frame);
  if (!Number.isInteger(frame) || frame < 1 || ![1, 2, 3].includes(input.width)) {
    return { result: "invalid" };
  }
  const number = String(frame).padStart(input.width, "0");
  const cut = input.includeCut && input.cut ? `_${input.cut}` : "";
  const mode = input.mode && input.mode !== "off" ? `_${input.mode}` : "";
  const name = `${input.roll}_${number}${cut}${mode}.${input.ext}`;
  if (new TextEncoder().encode(name).length > 255) return { result: "too_long" };
  return { result: "name", name };
}

export function groupExcludedLines(excluded) {
  const groups = new Map();
  for (const item of excluded) {
    if (!reasonLine[item.reason]) continue;
    if (!groups.has(item.reason)) groups.set(item.reason, new Set());
    groups.get(item.reason).add(item.frame);
  }
  return [...groups.entries()]
    .map(([reason, frames]) => ({ reason, frames: [...frames].sort((a, b) => a - b) }))
    .sort((left, right) => left.frames[0] - right.frames[0])
    .map(({ reason, frames }) => ({
      text: reasonLine[reason](compactNumbers(frames)),
      frames,
    }));
}

export function missingNumberLine(label, values) {
  return values.length ? `${label}: ${compactNumbers(values)}번` : null;
}
