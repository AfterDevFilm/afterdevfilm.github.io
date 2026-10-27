import { cleanExposureRational } from "./value-rules.js";
import { TEMPLATE_CONFIRMATION_KIND } from "./template-import.js";

export const headerAliases = [
  ["롤 이름", "rollIdentifier"], ["roll", "rollIdentifier"],
  ["카메라", "camera"], ["camera", "camera"], ["바디", "camera"], ["렌즈", "lens"], ["lens", "lens"],
  ["필름", "filmStock"], ["film", "filmStock"],
  ["감도(ei)", "exposureIndex"], ["ei", "exposureIndex"], ["rating_ei", "exposureIndex"], ["노출 지수(ei)", "exposureIndex"],
  ["현상", "developmentProcess"], ["현상 방식", "developmentProcess"], ["process", "developmentProcess"],
  ["필름 제조사", "filmManufacturer"], ["film manufacturer", "filmManufacturer"],
  ["박스 감도", "boxSpeed"], ["box speed", "boxSpeed"], ["현상소", "lab"], ["lab", "lab"],
  ["롤 번호", "rollNumber"], ["roll number", "rollNumber"], ["초점거리(mm)", "focalLength"], ["focal", "focalLength"],
  ["번호", "number"], ["no", "number"], ["#", "number"], ["조리개", "aperture"], ["aperture", "aperture"],
  ["셔터", "shutter"], ["shutter", "shutter"], ["노출보정", "exposureCompensation"], ["노출 보정", "exposureCompensation"], ["ev", "exposureCompensation"],
  ["촬영일", "shootingDate"], ["date", "shootingDate"], ["메모", "note"], ["note", "note"],
  ["설정", "settings"], ["노출", "settings"], ["settings", "settings"], ["exposure", "settings"],
  ["컷 이름", "cutName"], ["피사체", "subject"],
];

const boundaryWhitespace = /[\s\u0085\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]/gu;
export const recognizedTrailingHeaderUnits = new Set(["mm"]);

export function normalizeTemplateHeader(raw) {
  let value = String(raw ?? "").normalize("NFC").trim()
    .replaceAll("（", "(").replaceAll("）", ")");
  const trailing = value.match(/\(([^()]*)\)$/u);
  if (trailing) {
    const unit = trailing[1].replace(boundaryWhitespace, "").toLowerCase();
    if (recognizedTrailingHeaderUnits.has(unit)) value = value.slice(0, trailing.index);
  }
  return value.replace(boundaryWhitespace, "").toLowerCase();
}

const headersByNormalized = new Map(headerAliases.map(([raw, key]) => [normalizeTemplateHeader(raw), key]));
export function templateHeaderKey(raw) { return headersByNormalized.get(normalizeTemplateHeader(raw)) ?? null; }

const rollKeyByHeader = new Map([
  ["rollIdentifier", "name"], ["camera", "camera"], ["lens", "lens"], ["focalLength", "focal"],
  ["filmStock", "film"], ["filmManufacturer", "maker"], ["boxSpeed", "boxSpeed"], ["exposureIndex", "ei"],
  ["developmentProcess", "process"], ["lab", "lab"], ["rollNumber", "rollNumber"],
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
  return rollKeyByHeader.get(templateHeaderKey(stripMarkup(raw).replace(/:$/, ""))) ?? null;
}

function addUnknown(columns, raw) {
  const value = stripMarkup(raw);
  if (value && !columns.includes(value)) columns.push(value);
}

// PROVISIONAL (owner decision 2026-10-25): exact confirmation-screen wording.
export function unknownColumnsLine(columns) {
  return columns?.length ? `알아듣지 못한 칸: ${columns.join(", ")}` : null;
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

function visibleMarkdownLines(text) {
  const rawLines = String(text).replace(/\r\n/g, "\n").split("\n");
  let commentOpen = false;
  return rawLines.map((rawLine) => {
    let visible = "";
    let cursor = 0;
    while (cursor < rawLine.length) {
      if (commentOpen) {
        const close = rawLine.indexOf("-->", cursor);
        if (close < 0) return visible;
        cursor = close + 3;
        commentOpen = false;
      } else {
        const open = rawLine.indexOf("<!--", cursor);
        if (open < 0) return visible + rawLine.slice(cursor);
        visible += rawLine.slice(cursor, open);
        cursor = open + 4;
        commentOpen = true;
      }
    }
    return visible;
  });
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

function addConfirmation(confirmations, lineNumber, kind, field, rawValue) {
  confirmations.push({ lineNumber, kind, field, rawValue });
}

function cleanExposureCompensation(raw) {
  const value = stripMarkup(raw);
  return /^[+-]\d+(?:\.\d+)?$/.test(value) ? value : null;
}

function cleanShootingDate(raw) {
  const value = stripMarkup(raw);
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null;
}

function appendDuplicateNumberConfirmations(rows, confirmations) {
  const byNumber = new Map();
  for (const row of rows) {
    if (!byNumber.has(row.cut.n)) byNumber.set(row.cut.n, []);
    byNumber.get(row.cut.n).push(row);
  }
  for (const group of byNumber.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      addConfirmation(confirmations, row.lineNumber, TEMPLATE_CONFIRMATION_KIND.duplicateNumber, "number", row.numberRaw);
    }
  }
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
  const confirmations = options.confirmations ?? [];
  const numberIndex = headers.findIndex((header) => templateHeaderKey(header) === "number");
  const numberText = cells[numberIndex] ?? "";
  const match = numberText.match(/^#?0*([1-9]\d*)$/);
  if (numberIndex >= 0 && !match) {
    if (options.includeAmbiguousNumberConfirmation !== false) {
      addConfirmation(confirmations, lineNumber, TEMPLATE_CONFIRMATION_KIND.ambiguousNumber, "number", numberText);
    }
    return { unread: true };
  }
  const cut = { n: match ? Number(match[1]) : null };
  const values = new Map();
  let subject = "";
  let explicitName = "";
  let rawBareAperture = null;

  headers.forEach((header, index) => {
    const raw = cells[index] ?? "";
    const value = stripMarkup(raw);
    const key = templateHeaderKey(header);
    if (key === "aperture" && normalizeTemplateHeader(header) === "조리개") {
      const aperture = normalizeAperture(value);
      addDistinct(values, "ap", aperture);
      if (value && value !== "미확정" && !aperture) {
        addConfirmation(confirmations, lineNumber, TEMPLATE_CONFIRMATION_KIND.ambiguousValue, "aperture", value);
      }
      if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && aperture) rawBareAperture = value;
    } else if (key === "aperture") {
      const aperture = normalizeAperture(value);
      addDistinct(values, "ap", aperture);
      if (value && value !== "미확정" && !aperture) {
        addConfirmation(confirmations, lineNumber, TEMPLATE_CONFIRMATION_KIND.ambiguousValue, "aperture", value);
      }
    } else if (key === "shutter") {
      const shutter = cleanShutter(value);
      addDistinct(values, "sh", shutter);
      if (value && value !== "미확정" && !shutter) {
        addConfirmation(confirmations, lineNumber, TEMPLATE_CONFIRMATION_KIND.ambiguousValue, "shutter", value);
      }
    } else if (key === "exposureCompensation") {
      const exposureCompensation = cleanExposureCompensation(value);
      addDistinct(values, "ev", exposureCompensation);
      if (value && value !== "미확정" && !exposureCompensation) {
        addConfirmation(confirmations, lineNumber, TEMPLATE_CONFIRMATION_KIND.ambiguousValue, "exposureCompensation", value);
      }
    } else if (key === "shootingDate") {
      const shootingDate = cleanShootingDate(value);
      addDistinct(values, "date", shootingDate);
      if (value && value !== "미확정" && !shootingDate) {
        addConfirmation(confirmations, lineNumber, TEMPLATE_CONFIRMATION_KIND.ambiguousValue, "shootingDate", value);
      }
    } else if (key === "note") {
      if (value) addDistinct(values, "note", value);
    } else if (key === "focalLength") {
      const focal = cleanFocal(value);
      addDistinct(values, "focal", focal);
      if (value && value !== "미확정" && !focal) {
        addConfirmation(confirmations, lineNumber, TEMPLATE_CONFIRMATION_KIND.ambiguousValue, "focalLength", value);
      }
    } else if (key === "lens") {
      if (value) addDistinct(values, "lens", value);
    } else if (key === "settings") {
      parseSetting(value, values);
    } else if (key === "subject") {
      subject = value;
    } else if (key === "cutName") {
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
  return { cut, lineNumber, numberRaw: numberText };
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
  const lines = visibleMarkdownLines(text);
  if (lines.at(-1) === "") lines.pop();
  const candidates = new Map();
  const blockedFields = new Set();
  const unread = new Set();
  const unreadRaw = [];
  const cuts = [];
  const cutRows = [];
  const confirmations = [];
  const consumed = new Set();
  const unknownColumns = [];

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
      const field = pair[1].trim().toLowerCase() === "roll_id" ? "name" : canonicalRollKey(pair[1]);
      if (field) addCandidate(field, pair[2], lineNumber);
      else unread.add(lineNumber);
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
      const numberHeader = headers.some((header) => templateHeaderKey(header) === "number");
      const rollTable = headers.length === 2 && ["항목", "item"].includes(headers[0].toLowerCase());
      if (rollTable) {
        const nestedHeader = rows.findIndex((row) => row.cells.length > 2 && templateHeaderKey(row.cells[0]) === "number");
        const rollRows = nestedHeader < 0 ? rows : rows.slice(0, nestedHeader);
        for (const row of rollRows) {
          const tableKey = stripMarkup(row.cells[0]);
          const field = tableKey.toLowerCase() === "roll_id" ? null : canonicalRollKey(tableKey);
          if (!field) {
            unread.add(row.line);
            if (stripMarkup(row.cells[0]).toLowerCase() === "roll_id") unreadRaw.push(row.raw);
          } else if (blockedFields.has(field)) {
            unread.add(row.line);
          } else addCandidate(field, row.cells[1], row.line);
        }
        if (nestedHeader >= 0) {
          const cutHeaders = rows[nestedHeader].cells;
          cutHeaders.forEach((header) => { if (!templateHeaderKey(header)) addUnknown(unknownColumns, header); });
          for (const row of rows.slice(nestedHeader + 1)) {
            if (row.cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
            const parsed = parseCutRow(cutHeaders, row.cells, row.line, {
              confirmations, includeAmbiguousNumberConfirmation: false,
            });
            if (parsed.unread) unread.add(row.line); else cuts.push(parsed.cut);
            if (!parsed.unread) cutRows.push(parsed);
          }
        }
      } else if (numberHeader) {
        headers.forEach((header) => { if (!templateHeaderKey(header)) addUnknown(unknownColumns, header); });
        for (const row of rows) {
          const parsed = parseCutRow(headers, row.cells, row.line, {
            confirmations, includeAmbiguousNumberConfirmation: false,
          });
          if (parsed.unread) unread.add(row.line);
          else cuts.push(parsed.cut);
          if (!parsed.unread) cutRows.push(parsed);
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
    if (cut) {
      cuts.push(cut);
      cutRows.push({ cut, lineNumber, numberRaw: String(cut.n) });
    }
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
  appendDuplicateNumberConfirmations(cutRows, confirmations);
  const result = { roll, cuts, unread: [...unread].sort((a, b) => a - b), confirmations, unknownColumns };
  if (unreadRaw.length) result.unreadRaw = unreadRaw;
  return result;
}

export function parseCsvRecord(text, papa = globalThis.Papa) {
  if (!papa) throw new Error("CSV parser is not ready");
  const parsed = papa.parse(text, { skipEmptyLines: false });
  if (parsed.errors.length) throw new Error(`CSV를 읽지 못했어요: ${parsed.errors[0].message}`);
  const rows = parsed.data.map((row) => row.map((cell) => String(cell ?? "")));
  let afterBlank = false;
  let headerIndex = -1;
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].every((cell) => !cell.trim())) { afterBlank = true; continue; }
    if (afterBlank) { headerIndex = index; break; }
  }

  const roll = {};
  const unread = [];
  const unreadRaw = [];
  const unknownColumns = [];
  const confirmations = [];
  const cutRows = [];
  const rollEnd = headerIndex < 0 ? rows.length : headerIndex;
  for (let index = 0; index < rollEnd; index += 1) {
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

  const cuts = [];
  if (headerIndex >= 0) {
    const headers = rows[headerIndex].map(stripMarkup);
    headers.forEach((header) => { if (!templateHeaderKey(header)) addUnknown(unknownColumns, header); });
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.every((cell) => !cell.trim())) continue;
      const result = parseCutRow(headers, row, index + 1, { includeApertureExif: false, confirmations });
      if (result.unread) {
        unread.push(index + 1);
        unreadRaw.push(row.join(","));
      } else {
        cuts.push(result.cut);
        cutRows.push(result);
      }
    }
  }
  appendDuplicateNumberConfirmations(cutRows, confirmations);
  const result = { roll, cuts, unread, confirmations, unknownColumns };
  if (unreadRaw.length) result.unreadRaw = unreadRaw;
  return result;
}
