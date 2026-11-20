export function newZipRollState(state) {
  return { ...state, roll: {}, records: [], recordFileName: "", importedRollKeys: new Set(), pendingRecord: null, rollName: "" };
}
