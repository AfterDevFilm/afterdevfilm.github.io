export function acceptsDecimalFieldEdit(oldText, newText) {
  const oldValue = String(oldText ?? "");
  const newValue = String(newText ?? "");
  if (/^[0-9]*\.?[0-9]*$/.test(newValue.replace(/^ +| +$/g, ""))) return true;
  const removed = oldValue.length - newValue.length;
  if (removed <= 0) return false;
  for (let index = 0; index <= newValue.length; index += 1) {
    if (oldValue.slice(0, index) + oldValue.slice(index + removed) === newValue) return true;
  }
  return false;
}

export function prepareApertureInput(value) {
  const text = String(value ?? "").replace(/^ +| +$/g, "");
  if (!text) return { result: "blank" };
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(text) || !Number.isFinite(Number(text))) return { result: "rejected" };
  const [whole, fraction = ""] = text.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return { result: "accepted", stored: normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole };
}
