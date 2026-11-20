function numberFromName(name) {
  const match = String(name).match(/^film(\d+)$/i);
  return match ? Number(match[1]) : 0;
}

export function nextDefaultRollNames(existing = [], count = 1, highWater = 0) {
  const largest = Math.max(highWater, 0, ...existing.map(numberFromName));
  return Array.from({ length: Math.max(0, count) }, (_, index) => `film${String(largest + index + 1).padStart(3, "0")}`);
}

export function defaultRollHighWaterAfter(current = 0, name = "") {
  return Math.max(current, numberFromName(name));
}

export function mayFillDefaultRollName(current = "", touched = false) {
  return current === "" && !touched;
}

export function defaultRollName() {
  return nextDefaultRollNames([], 1, 0)[0];
}
