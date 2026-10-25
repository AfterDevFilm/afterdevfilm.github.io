const collator = new Intl.Collator("ko-KR-u-kf-lower", {
  usage: "sort",
  numeric: true,
  sensitivity: "variant",
  caseFirst: "lower",
});

function splitExtension(path) {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  if (dot <= slash + 1) return [path, ""];
  return [path.slice(0, dot), path.slice(dot + 1)];
}

function codeUnitCompare(left, right) {
  const limit = Math.min(left.length, right.length);
  for (let index = 0; index < limit; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference) return difference;
  }
  return left.length - right.length;
}

function byteCompare(left, right) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const limit = Math.min(a.length, b.length);
  for (let index = 0; index < limit; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function naturalCompare(leftValue, rightValue) {
  const left = String(leftValue).normalize("NFC");
  const right = String(rightValue).normalize("NFC");
  const [leftName, leftExtension] = splitExtension(left);
  const [rightName, rightExtension] = splitExtension(right);
  let result = collator.compare(leftName, rightName);
  if (!result) result = collator.compare(leftExtension, rightExtension);
  if (!result) result = left.length - right.length;
  if (!result) result = codeUnitCompare(left, right);
  if (!result) result = byteCompare(left, right);
  return result;
}

export function naturalSort(values) {
  return [...values].sort(naturalCompare);
}
