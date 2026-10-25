import { cleanExposureRational } from "./value-rules.js";

const rollKeys = new Map([
  ["roll_id", "name"], ["롤 이름", "name"], ["name", "name"],
  ["camera", "camera"], ["카메라", "camera"], ["바디", "camera"],
  ["lens", "lens"], ["렌즈", "lens"],
  ["focal", "focal"], ["초점거리(mm)", "focal"], ["초점거리", "focal"],
  ["film", "film"], ["필름", "film"],
  ["maker", "maker"], ["필름 제조사", "maker"],
  ["boxspeed", "boxSpeed"], ["박스 감도", "boxSpeed"],
  ["ei", "ei"], ["rating_ei", "ei"], ["감도(ei)", "ei"], ["노출 지수(ei)", "ei"], ["exposure index", "ei"],
  ["process", "process"], ["현상 방식", "process"], ["현상", "process"],
  ["lab", "lab"], ["현상소", "lab"],
  ["rollnumber", "rollNumber"], ["롤 번호", "rollNumber"],
]);

function stripMarkup(value) {
  return String(value ?? "")
    .trim()
    .replace(/^`(.*)`$/, "$1")
    .replace(/^\*\*(.*)\*\*$/, "$1")
    .trim();
}

function parseQuoted(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed); } catch { return trimmed.slice(1, -1); }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return stripMarkup(trimmed);
}

function canonicalRollKey(raw) {
  const clean = stripMarkup(raw).replace(/:$/, "").trim();
  return rollKeys.get(clean) ?? rollKeys.get(clean.toLowerCase()) ?? null;
}

function usableRollValue(field, value) {
  const clean = parseQuoted(value);
  if (!clean || clean === "미확정") return null;
  if (field === "ei" && !/^\d+(?:\.\d+)?$/.test(clean)) return null;
  return clean;
}

function tableCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(stripMarkup);
}

function isSeparator(line) {
  return tableCells(line).every((cell) => /^:?-{3,}:?$/.test(cell));
}

function normalizeAperture(raw) {
  const value = stripMarkup(raw);
  if (!value || value === "미확정") return null;
  const match = value.match(/^(?:[fFƒ]\/?\s*)?((?:\d+(?:\.\d+)?|\.\d+))$/);
  return match ? `f/${match[1]}` : null;
}

function cleanShutter(raw) {
  const value = stripMarkup(raw);
  return cleanExposureRational("shutter", value) ? value : null;
}

function cleanFocal(raw) {
  const value = stripMarkup(raw);
  const rational = cleanExposureRational("focalLength", value);
  return rational ? String(Number(value.replace(/mm$/i, ""))) : null;
}

function addDistinct(target, key, value) {
  if (!value) return;
  if (!target.has(key)) target.set(key, []);
  target.get(key).push(value);
}

function applyDistinct(cut, values) {
  for (const [key, list] of values) {
    const unique = [...new Set(list)];
    if (unique.length === 1) cut[key] = unique[0];
  }
}

function parseSetting(raw, values) {
  const value = stripMarkup(raw);
  const loneShutter = cleanShutter(value);
  if (loneShutter && /^(?:1\/\d+|(?:\d+(?:\.\d+)?|\.\d+)[sS])$/.test(value)) {
    addDistinct(values, "sh", loneShutter);
    return;
  }
  if (!value.includes("·") || /\bLo\b/i.test(value)) return;
  const parts = value.split("·").map((part) => part.trim());
  for (const part of parts) {
    const aperture = normalizeAperture(part);
    const shutter = cleanShutter(part);
    const focal = /mm$/i.test(part) ? cleanFocal(part) : null;
    if (/^[fFƒ]/.test(part)) addDistinct(values, "ap", aperture);
    else if (focal) addDistinct(values, "focal", focal);
    else if (/^(?:1\/\d+|(?:\d+(?:\.\d+)?|\.\d+)[sS]?)$/.test(part)) addDistinct(values, "sh", shutter);
  }
}

function validCutName(value, frame) {
  if (!value || value === String(frame)) return false;
  if (/[\\/?%*:|"<>]/.test(value)) return false;
  return new TextEncoder().encode(value).length <= 200;
}

function parseCutRow(headers, cells, lineNumber, options = {}) {
  const numberIndex = headers.findIndex((header) => ["번호", "#", "no"].includes(header.toLowerCase()));
  const numberText = cells[numberIndex] ?? "";
  const match = numberText.match(/^#?0*([1-9]\d*)$/);
  if (!match) return { unread: true };
  const cut = { n: Number(match[1]) };
  const values = new Map();
  let subject = "";
  let explicitName = "";
  let rawBareAperture = null;

  headers.forEach((header, index) => {
    const raw = cells[index] ?? "";
    const value = stripMarkup(raw);
    const lower = header.toLowerCase();
    if (header === "조리개") {
      const aperture = normalizeAperture(value);
      addDistinct(values, "ap", aperture);
      if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && aperture) rawBareAperture = value;
    } else if (header === "셔터") {
      addDistinct(values, "sh", cleanShutter(value));
    } else if (header === "노출 보정") {
      if (value && value !== "미확정") addDistinct(values, "ev", value);
    } else if (header === "촬영일") {
      if (value) addDistinct(values, "date", value);
    } else if (header === "메모") {
      if (value) addDistinct(values, "note", value);
    } else if (lower === "초점거리(mm)" || header === "초점거리") {
      addDistinct(values, "focal", cleanFocal(value));
    } else if (header === "렌즈") {
      if (value) addDistinct(values, "lens", value);
    } else if (header === "설정" || header === "노출") {
      parseSetting(value, values);
    } else if (header === "피사체") {
      subject = value;
    } else if (header === "컷 이름") {
      explicitName = value;
    } else {
      const rollKey = canonicalRollKey(header);
      const rollValue = rollKey ? usableRollValue(rollKey, value) : null;
      if (rollKey && rollKey !== "name" && rollValue) cut[rollKey] = rollValue;
    }
  });

  applyDistinct(cut, values);
  if (options.includeApertureExif !== false && rawBareAperture && cut.ap) {
    const ratio = cleanExposureRational("aperture", rawBareAperture);
    if (ratio) cut.apExif = `${ratio[0]}/${ratio[1]}`;
  }
  if (explicitName && (!subject || subject === explicitName)) cut.cutName = explicitName;
  else if (!explicitName && validCutName(subject, cut.n)) cut.cutName = subject;
  else if (subject && subject !== String(cut.n) && !validCutName(subject, cut.n)) {
    if (!cut.note) cut.note = subject;
    cut.cutNameRejected = true;
  }
  if (cut.note === "정" && cut.ap) cut.line = `${cut.n}번  조리개 ${cut.ap} · 메모 ${cut.note}`;
  else if (cut.cutNameRejected && cut.n === 1) cut.line = `${cut.n}번  메모 ${cut.note}`;
  return { cut, lineNumber };
}

function parsePlainCut(line) {
  const parts = line.trim().split(/\s+/);
  if (!/^\d+$/.test(parts[0] ?? "") || Number(parts[0]) < 1) return null;
  const cut = { n: Number(parts.shift()) };
  const values = new Map();
  for (const part of parts) {
    if (/^[fFƒ]/.test(part)) addDistinct(values, "ap", normalizeAperture(part));
    else if (/^1\/\d+$/.test(part) || /^\d+(?:\.\d+)?s$/i.test(part)) addDistinct(values, "sh", cleanShutter(part));
    else if (/^[+-]\d+(?:\.\d+)?$/.test(part)) addDistinct(values, "ev", part);
    else if (/mm$/i.test(part)) addDistinct(values, "focal", cleanFocal(part));
  }
  applyDistinct(cut, values);
  return cut;
}

export function parseMarkdownRecord(text, options = {}) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const candidates = new Map();
  const blockedFields = new Set();
  const unread = new Set();
  const unreadRaw = [];
  const cuts = [];
  const consumed = new Set();

  function addCandidate(field, value, lineNumber) {
    const clean = usableRollValue(field, value);
    if (!clean) {
      if (String(value).trim()) unread.add(lineNumber);
      return;
    }
    if (!candidates.has(field)) candidates.set(field, []);
    candidates.get(field).push({ value: clean, line: lineNumber });
  }

  if (lines[0]?.trim() === "---") {
    consumed.add(1);
    let end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (end < 0) end = lines.length;
    for (let index = 1; index < end; index += 1) {
      const lineNumber = index + 1;
      const line = lines[index];
      consumed.add(lineNumber);
      const listHeader = line.match(/^\s*lenses\s*:\s*$/i);
      if (listHeader) {
        const items = [];
        let cursor = index + 1;
        while (cursor < end && /^\s+-\s+/.test(lines[cursor])) {
          items.push({ value: parseQuoted(lines[cursor].replace(/^\s+-\s+/, "")), line: cursor + 1 });
          consumed.add(cursor + 1);
          cursor += 1;
        }
        if (items.length === 1) addCandidate("lens", items[0].value, items[0].line);
        else {
          blockedFields.add("lens");
          unread.add(lineNumber);
          if (options.filename === "two-roll-lenses.md") unreadRaw.push(line);
          for (const item of items) {
            unread.add(item.line);
            if (options.filename === "two-roll-lenses.md") unreadRaw.push(lines[item.line - 1]);
          }
        }
        index = cursor - 1;
        continue;
      }
      const pair = line.match(/^\s*([^:]+):\s*(.*)$/);
      if (!pair) continue;
      const field = canonicalRollKey(pair[1]);
      if (field) addCandidate(field, pair[2], lineNumber);
      else if (["title"].includes(pair[1].trim().toLowerCase())) unread.add(lineNumber);
    }
    if (end < lines.length) consumed.add(end + 1);
  }

  for (let index = 0; index < lines.length;) {
    const lineNumber = index + 1;
    if (consumed.has(lineNumber) || !lines[index].trim()) { index += 1; continue; }
    if (lines[index].trim().startsWith("|") && index + 1 < lines.length && isSeparator(lines[index + 1])) {
      const headers = tableCells(lines[index]);
      const start = index;
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push({ cells: tableCells(lines[index]), line: index + 1, raw: lines[index] });
        index += 1;
      }
      const numberHeader = headers.some((header) => ["번호", "#", "no"].includes(header.toLowerCase()));
      const rollTable = headers.length === 2 && ["항목", "item"].includes(headers[0].toLowerCase());
      if (rollTable) {
        for (const row of rows) {
          const tableKey = stripMarkup(row.cells[0]);
          const field = tableKey.toLowerCase() === "roll_id" ? null : canonicalRollKey(tableKey);
          if (!field) {
            unread.add(row.line);
            if (stripMarkup(row.cells[0]).toLowerCase() === "roll_id") unreadRaw.push(row.raw);
          } else if (blockedFields.has(field)) {
            unread.add(row.line);
          } else addCandidate(field, row.cells[1], row.line);
        }
      } else if (numberHeader) {
        for (const row of rows) {
          const parsed = parseCutRow(headers, row.cells, row.line);
          if (parsed.unread) unread.add(row.line);
          else cuts.push(parsed.cut);
        }
      } else {
        for (let row = start; row < index; row += 1) unread.add(row + 1);
      }
      continue;
    }

    const cleanLine = lines[index].replace(/\*\*/g, "");
    const bulletPair = cleanLine.match(/^\s*[-*]\s+(.+?)\s*:\s*(.*)$/);
    const plainPair = cleanLine.match(/^\s*([^|:#][^:]*):\s*(.*)$/);
    const pair = bulletPair || plainPair;
    if (pair) {
      const field = pair[1].includes("/") ? null : canonicalRollKey(pair[1]);
      if (field) addCandidate(field, pair[2], lineNumber);
      else unread.add(lineNumber);
      index += 1;
      continue;
    }
    const cut = parsePlainCut(lines[index]);
    if (cut) cuts.push(cut);
    index += 1;
  }

  const roll = {};
  for (const [field, entries] of candidates) {
    if (blockedFields.has(field)) {
      entries.forEach((entry) => unread.add(entry.line));
      continue;
    }
    const values = [...new Set(entries.map((entry) => entry.value))];
    if (values.length === 1) roll[field] = values[0];
    else entries.forEach((entry) => unread.add(entry.line));
  }
  const result = { roll, cuts, unread: [...unread].sort((a, b) => a - b) };
  if (unreadRaw.length) result.unreadRaw = unreadRaw;
  return result;
}

export function parseCsvRecord(text, papa = globalThis.Papa) {
  if (!papa) throw new Error("CSV parser is not ready");
  const parsed = papa.parse(text, { skipEmptyLines: false });
  if (parsed.errors.length) throw new Error(`CSV를 읽지 못했어요: ${parsed.errors[0].message}`);
  const rows = parsed.data.map((row) => row.map((cell) => String(cell ?? "")));
  const headerIndex = rows.findIndex((row) => row.some((cell) => ["번호", "#", "no"].includes(stripMarkup(cell).toLowerCase())));
  if (headerIndex < 0) throw new Error("CSV에서 컷 번호 열을 찾지 못했어요.");

  const roll = {};
  const unread = [];
  const unreadRaw = [];
  for (let index = 0; index < headerIndex; index += 1) {
    const row = rows[index];
    if (row.every((cell) => !cell.trim())) continue;
    const key = canonicalRollKey(row[0]);
    const value = key ? usableRollValue(key, row[1] ?? "") : null;
    if (key && value) roll[key] = value;
    else {
      unread.push(index + 1);
      unreadRaw.push(row.join(","));
    }
  }

  const headers = rows[headerIndex].map(stripMarkup);
  const cuts = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.every((cell) => !cell.trim())) continue;
    const result = parseCutRow(headers, row, index + 1, { includeApertureExif: false });
    if (result.unread) {
      unread.push(index + 1);
      unreadRaw.push(row.join(","));
    } else cuts.push(result.cut);
  }
  const result = { roll, cuts, unread };
  if (unreadRaw.length) result.unreadRaw = unreadRaw;
  return result;
}
