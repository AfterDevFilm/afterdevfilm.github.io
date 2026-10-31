export const SHOOTING_DATE_PROVENANCE = Object.freeze({
  none: "NONE",
  provider: "PROVIDER_ACCEPTED",
  user: "USER_AUTHORED",
  deleted: "USER_DELETED",
});

function uniqueTemplateRowsByFrame(rows) {
  const grouped = new Map();
  for (const row of rows ?? []) {
    if (!grouped.has(row.frame)) grouped.set(row.frame, []);
    grouped.get(row.frame).push(row);
  }
  return new Map([...grouped].flatMap(([frame, matches]) => matches.length === 1 ? [[frame, matches[0]]] : []));
}

export function reprojectProviderShootingDates(cuts, templateRows) {
  const byFrame = uniqueTemplateRowsByFrame(templateRows);
  return cuts.map((cut) => {
    if (cut.dateProvenance !== SHOOTING_DATE_PROVENANCE.provider) return { ...cut };
    return { ...cut, date: byFrame.get(cut.frame)?.date ?? "" };
  });
}
