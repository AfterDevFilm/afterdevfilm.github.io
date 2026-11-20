import { assessZeroCut, pairZeroCut } from "./template-zero-cut.js";

// The parser owns number interpretation; raw numbers are display-only.
export function zeroCutRecords(cuts, numberRaws) {
  return cuts.map((cut, index) => ({ numberRaw: numberRaws[index], number: cut.n }));
}

export function applyZeroCut(cuts, numberRaws, scanCount, selectedIndex) {
  const records = zeroCutRecords(cuts, numberRaws);
  if (!assessZeroCut(records, scanCount).ask) return cuts.map((cut) => ({ ...cut }));
  const pairing = pairZeroCut(records, scanCount, selectedIndex);
  return cuts.map((cut, index) => ({
    ...cut,
    n: pairing.detachedRecordIndices.includes(index) ? null
      : pairing.targetCutByRecordIndex[index] ?? null,
  }));
}
