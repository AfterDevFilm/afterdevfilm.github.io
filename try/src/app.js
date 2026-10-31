import { readPhotoZipBlob, zipLimitMessageLines, WEB_ZIP_LIMITS, ZIP_ERROR_KIND_LIMIT } from "./adapters/zip.js";
import { cleanShootingDate, parseCsvRecord, parseMarkdownRecord, recordUnreadEntries, unknownColumnsLine } from "./core/record.js";
import { matchCutsToPhotos } from "./core/match.js";
import { applyPaddingRatioCanvas, downloadBytes, exportConfiguredZip } from "./core/export.js";
import { compactNumbers, groupExcludedLines, makeExportArchiveFilename } from "./core/export-rules.js";
import { evaluateInformationFramePhotoLimit, renderInformationFrame, showsRGBHistogramControl } from "./core/information-frame.js";
import { defaultRollName } from "./core/default-roll-name.js";
import { resolveCutField, resolveCutRecord } from "./core/roll-values.js";
import { groupShareFiles, makeShareFiles } from "./core/share.js";
import { shownPhotoDimensions } from "./core/image-format.js";
import { JPEG_COMPLETENESS, judgeJpegCompleteness } from "./core/jpeg-completeness.js";
import {
  SCAN_REPLACED_MESSAGE, SCAN_REPLACEMENT_READ_FAILURE, SCAN_UNREADABLE_MESSAGE,
  applyScanReplacement, stageScanReplacement,
} from "./core/scan-replacement.js";
import { normalizeBulb, sharedCopy, shouldShowExifReason } from "./core/value-rules.js";
import { INTEGER_INPUT_LABELS, prepareIntegerFieldInput } from "./core/integer-input.js";
import { inputSuggestionAsk } from "./core/input-suggestion.js";
import {
  moveSelection, planBulkShootingInfo, renumberByOrder, renumberSelection, reverseSelection, selectionIsContiguous, shiftSelection,
} from "./core/multi-edit.js";
import { contactSheetBlob, evaluateContactSheetLimit, renderContactSheet } from "./core/contact-sheet.js";
import {
  TEMPLATE_ROLL_FIELDS, cutNameRejectedLine, rollMissingNumberLine, templateConfirmationNoticeLines, templateCutLine,
} from "./core/template-import.js";
import { SHOOTING_DATE_PROVENANCE, reprojectProviderShootingDates } from "./core/shooting-date-renumber.js";
import {
  ThumbnailBitmapCache, makeThumbnailBitmap, renderCachedThumbnail,
} from "./core/thumbnail-cache.js";
import {
  FRAME_NUMBER_HELPER, FRAME_NUMBER_MAXIMUM, evaluateFrameNumberEdit, frameNumberMessage,
} from "./core/frame-number-edit.js";

const SHOOTING_DATE_INVALID_MESSAGE = "2026-09-27처럼 올바른 날짜를 입력해 주세요.";

const shootingFields = [
  { key: "camera", label: "카메라", recent: true, placeholder: "예: Nikon FM2" },
  { key: "lens", label: "렌즈", recent: true },
  { key: "focal", label: "초점거리(mm)", placeholder: "숫자만 입력", reason: "focal" },
  { key: "ap", label: "조리개", cutOnly: true, reason: "aperture" },
  { key: "sh", label: "셔터", cutOnly: true, reason: "shutter" },
  { key: "ev", label: "노출 보정", cutOnly: true },
  { key: "film", label: "필름", recent: true },
  { key: "maker", label: "필름 제조사", recent: true },
  { key: "boxSpeed", label: "박스 감도", placeholder: "ISO 숫자만 입력", inputMode: "numeric" },
  { key: "ei", label: "노출 지수(EI)", placeholder: "숫자만 입력", inputMode: "numeric" },
  { key: "process", label: "현상 방식", choices: ["C-41", "ECN-2", "E-6", "B&W"] },
  { key: "lab", label: "현상소", recent: true },
  { key: "rollNumber", label: "롤 번호", placeholder: "숫자만 입력", inputMode: "numeric" },
];

const rollGroups = [
  ["", ["rollNumber"]],
  ["카메라", ["camera", "lens", "focal"]],
  ["필름", ["film", "maker", "boxSpeed", "ei"]],
  ["현상", ["process", "lab"]],
];

const FRAME_NUMBER_INVALID = "1 이상의 프레임 번호를 입력해 주세요.";
const FRAME_NUMBER_CONFLICT = "다른 컷과 번호가 겹쳐요. 다른 번호를 입력해 주세요.";

function frameNumberInput(raw) {
  const typed = String(raw ?? "");
  const trimmed = typed.trim();
  const value = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > FRAME_NUMBER_MAXIMUM) {
    return { value: null, message: `'컷 번호'에 숫자가 아닌 값이 있어요: '${typed}'. 고친 뒤 다시 저장해 주세요.` };
  }
  return { value, message: null };
}

function framePositionsProblem(positions) {
  if (!positions) return FRAME_NUMBER_CONFLICT;
  const frames = positions.map(({ frame }) => frame);
  if (frames.some((frame) => !Number.isSafeInteger(frame) || frame < 1 || frame > FRAME_NUMBER_MAXIMUM)) return FRAME_NUMBER_INVALID;
  if (new Set(frames).size !== frames.length) return FRAME_NUMBER_CONFLICT;
  return null;
}

const state = {
  photos: [], importFailures: [], records: [], cutValues: [], roll: {}, items: [], mode: null,
  screen: "start", returnScreen: "roll", presentation: "grid", columns: 2,
  currentCut: 0, previewToken: 0, thumbnailToken: 0, shareSession: null,
  orientation: {}, cutMeta: {}, recent: {}, editing: null, dialog: null, rollAskPending: true,
  exportFormat: "jpeg", exportQuality: "high", exportDigits: 2, rollFrameLabel: false, rgbHistogram: false, paddingRatio: "original",
  exportSelection: new Set(), webpSupported: null, result: null,
  cutOrder: [], frameByCut: {}, bulkEditing: false, bulkSelection: new Set(), bulkDraft: {}, bulkAfterAction: false, bulkMessage: "",
  contactFormat: "jpeg", contactQuality: "high", contactHeader: true, contactRender: null, contactFile: null, contactMessage: "",
  importedRollKeys: new Set(), pendingRecord: null, templateGuideSeen: false, bulkNoticeTimer: null,
  recordFileName: "", exampleActive: false, exampleRecordBytes: null,
  appPreviewAvailable: { album: false, webp: true, large: true, contact: true, "zip-backup": true },
};
const thumbnailCache = new ThumbnailBitmapCache();
const thumbnailRenderVersions = new WeakMap();

const appPreviews = {
  album: {
    title: "롤 이름 앨범에 차례대로",
    image: "./assets/app-previews/photos-album-order.png",
    caption: "합성 롤의 사진이 1번부터 차례대로 들어간 앱 화면이에요.",
  },
  webp: {
    title: "앱의 WebP 내보내기",
    image: "./assets/app-previews/export-settings.png",
    caption: "앱에서는 WebP 형식과 품질을 고르고 내보낼 수 있어요.",
  },
  large: {
    title: "큰 사진도 원본 크기 그대로",
    image: "./assets/app-previews/large-photo-frame.png",
    caption: "합성 30MP급 사진에 원본 크기 그대로 액자를 넣은 결과예요.",
  },
  contact: {
    title: "앱의 모아 보기",
    image: "./assets/app-previews/contact-sheet.png",
    caption: "합성 롤로 만든 앱의 모아 보기 결과예요.",
  },
  "zip-backup": {
    title: "앱의 받은 ZIP 백업",
    image: "./assets/app-previews/received-zip-backup.png",
    caption: "앱에서는 받은 압축 파일을 바로 백업하고, 저장한 파일을 다시 고를 수 있어요.",
  },
};

const byId = (id) => document.getElementById(id);
const zipInput = byId("zip-input");
const recordInput = byId("record-input");
const replaceScanInput = byId("replace-scan-input");
const dropZone = byId("drop-zone");
const startStatus = byId("status");
const exportStatus = byId("export-status");
const exportReasons = byId("export-reasons");
const cutList = byId("cut-list");
const exportButton = byId("export-button");
const previewWrap = byId("frame-preview-wrap");
const previewCanvas = byId("frame-preview");
const shareButton = byId("share-button");
const shareProgress = byId("share-progress");
const rollNameInput = byId("roll-name");
const zipLimitLabel = `${WEB_ZIP_LIMITS.maxZipBytes / (1024 * 1024)}MB`;
const largeZipAppLine = "앱에서는 현상소에서 받은 큰 ZIP도 그대로 넣을 수 있어요.";
function zipLimitLines(limit) {
  return [...zipLimitMessageLines(limit).slice(1), largeZipAppLine];
}
byId("zip-limit-note").textContent = `체험판은 ${zipLimitLabel}·사진 ${WEB_ZIP_LIMITS.maxEntryCount}장까지 받아요`;

function showScreen(name) {
  state.screen = name;
  for (const screen of document.querySelectorAll("[data-screen]")) screen.hidden = screen.dataset.screen !== name;
  window.scrollTo(0, 0);
}

function setStatus(message, error = false, target = state.screen === "start" ? startStatus : exportStatus, errorKind = null, errorLimit = null) {
  const isZipLimit = errorKind === ZIP_ERROR_KIND_LIMIT;
  target.textContent = isZipLimit ? [message, ...zipLimitLines(errorLimit)].join("\n") : message;
  target.classList.toggle("error", error);
  target.classList.toggle("limit-error", isZipLimit);
}

function setExportReasons(frames = []) {
  const lines = groupExcludedLines(frames.map((frame) => ({ frame, reason: "frameTooLarge" })));
  exportReasons.textContent = lines.map((line) => line.text).join(" ");
  exportReasons.hidden = lines.length === 0;
}

function cutValues(item) {
  return state.cutValues.find((record) => record.cutId === item.cutId) ?? null;
}

function ensureCutValues(item) {
  let record = cutValues(item);
  if (!record) {
    record = { cutId: item.cutId, n: item.frame };
    state.cutValues.push(record);
  }
  record.n = item.frame;
  return record;
}

function combinedRecord(record, cut) {
  return resolveCutRecord(state.roll, record, cut);
}

function refreshItems() {
  const base = matchCutsToPhotos(state.photos, state.records).map((item, index) => {
    const cutId = item.cutId ?? item.name;
    if (!(cutId in state.frameByCut)) state.frameByCut[cutId] = item.frame;
    return { ...item, cutId, originalIndex: index };
  });
  if (!state.cutOrder.length || state.cutOrder.some((cutId) => !base.some((item) => item.cutId === cutId))) {
    state.cutOrder = base.map((item) => item.cutId);
  }
  const byCut = new Map(base.map((item) => [item.cutId, item]));
  const recordByNumber = new Map(state.records.map((record) => [record.n, record]));
  state.items = state.cutOrder.map((cutId) => byCut.get(cutId)).filter(Boolean).map((item) => {
    const frame = state.frameByCut[item.cutId] ?? item.frame;
    const importedRecord = recordByNumber.get(frame) ?? null;
    const shown = { ...item, frame, importedRecord };
    const cutRecord = cutValues(shown);
    return { ...shown, cutRecord, record: combinedRecord(importedRecord, cutRecord) };
  });
}

function invalidateShareSession() {
  state.shareSession = null;
  shareButton.textContent = "사진첩에 저장";
  shareProgress.hidden = true;
  shareProgress.textContent = "";
}

function updateShareAvailability() {
  const chosen = state.result?.files.filter((file) => file.selected) ?? [];
  try {
    shareButton.disabled = !chosen.length || !groupShareFiles(makeShareFiles(chosen));
  } catch {
    shareButton.disabled = true;
  }
}

function rollIsEmpty() {
  return shootingFields.filter((field) => !field.cutOnly).every((field) => !String(state.roll[field.key] ?? "").trim());
}

function photoBlob(item) {
  return new Blob([item.bytes], { type: item.format === "png" ? "image/png" : "image/jpeg" });
}

function completenessBlocksExport(item) {
  return item?.completeness === JPEG_COMPLETENESS.INCOMPLETE
    || item?.completeness === JPEG_COMPLETENESS.UNDETERMINED
    || item?.completeness === JPEG_COMPLETENESS.NOT_JPEG;
}

function reassessUndetermined(items) {
  for (const item of items) {
    if (item.completeness !== JPEG_COMPLETENESS.UNDETERMINED) continue;
    const judgement = judgeJpegCompleteness(item.bytes);
    item.completeness = judgement.state;
    item.completenessReason = judgement.reason;
  }
}

function photoCorrection(item) {
  return state.orientation[item.cutId] ?? { turns: 0, flipped: false };
}

async function renderPhoto(container, item, maximum, token, label) {
  container.textContent = "미리보기";
  container.dataset.thumbnailState = "loading";
  const version = (thumbnailRenderVersions.get(container) ?? 0) + 1;
  thumbnailRenderVersions.set(container, version);
  try {
    const correction = photoCorrection(item);
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", label);
    await renderCachedThumbnail({
      cache: thumbnailCache,
      key: item.cutId,
      load: async () => makeThumbnailBitmap(() => photoBlob(item), {
        dimensions: await shownPhotoDimensions(item.bytes, item.width, item.height, item.format),
      }),
      canvas,
      maximum,
      correction,
    });
    if (token !== state.thumbnailToken || !container.isConnected || thumbnailRenderVersions.get(container) !== version) return;
    container.replaceChildren(canvas);
    container.dataset.thumbnailState = "ready";
  } catch {
    container.textContent = "미리보기 없음";
    container.dataset.thumbnailState = "failed";
  }
}

function renderRoll() {
  refreshItems();
  const token = ++state.thumbnailToken;
  const shownPresentation = state.bulkEditing ? "list" : state.presentation;
  byId("photo-count").textContent = state.items.length;
  byId("roll-title").textContent = rollNameInput.value.trim() || defaultRollName();
  byId("roll-screen").classList.toggle("roll-screen-bulk", state.bulkEditing);
  renderImportFailures();
  byId("roll-normal-header").hidden = state.bulkEditing;
  byId("roll-controls").hidden = state.bulkEditing;
  byId("bulk-edit-header").hidden = !state.bulkEditing;
  byId("roll-idle-actions").hidden = state.bulkEditing;
  byId("bulk-edit-controls").hidden = !state.bulkEditing;
  byId("bulk-result").hidden = !state.bulkMessage;
  byId("bulk-result").textContent = state.bulkMessage;
  byId("bulk-edit-title").textContent = `여러 컷 편집 · ${state.bulkSelection.size}개 선택`;
  byId("bulk-toggle-all").textContent = state.bulkSelection.size === state.items.length ? "전체 해제" : "전체 선택";
  cutList.className = shownPresentation === "grid" ? `cut-grid columns-${state.columns}` : "cut-list";
  cutList.replaceChildren();
  state.items.forEach((item, index) => {
    const button = document.createElement(state.bulkEditing ? "label" : "button");
    if (!state.bulkEditing) button.type = "button";
    button.className = shownPresentation === "grid" ? "grid-cut" : `list-cut${state.bulkEditing ? " selecting" : ""}`;
    if (!state.bulkEditing) button.addEventListener("click", () => openCut(index));
    const photo = document.createElement("div");
    photo.className = shownPresentation === "grid" ? "grid-photo" : "list-photo";
    photo.dataset.cutId = item.cutId;
    renderPhoto(photo, item, shownPresentation === "grid" ? 150 : 72, token, `${item.frame}번 컷 미리보기`);
    if (shownPresentation === "grid") {
      const number = document.createElement("span");
      number.className = "grid-number";
      number.textContent = String(item.frame);
      button.append(photo, number);
    } else {
      const summary = document.createElement("span");
      summary.className = "list-summary";
      const title = document.createElement("strong");
      title.textContent = `${item.frame}번 컷`;
      const file = document.createElement("small");
      file.textContent = `${String(index + 1).padStart(2, "0")} / ${String(state.items.length).padStart(2, "0")} · ${item.name}`;
      summary.append(title, file);
      button.append(photo, summary);
      if (state.bulkEditing) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = state.bulkSelection.has(item.cutId);
        checkbox.setAttribute("aria-label", `${item.frame}번 컷 선택`);
        checkbox.addEventListener("change", () => {
          if (state.bulkAfterAction) {
            state.bulkSelection = new Set([item.cutId]);
            state.bulkAfterAction = false;
          } else if (checkbox.checked) state.bulkSelection.add(item.cutId);
          else state.bulkSelection.delete(item.cutId);
          state.bulkMessage = "";
          renderRoll();
        });
        button.append(checkbox);
      }
    }
    cutList.append(button);
  });
  updateBulkControls();
  updateToggles();
  updateShareAvailability();
}

function renderImportFailures() {
  const section = byId("import-failures");
  const failures = state.importFailures;
  section.hidden = state.bulkEditing || failures.length === 0;
  byId("import-failures-title").textContent = failures.length ? `읽지 못한 사진 ${failures.length}장은 빼고 가져와요.` : "";
  const list = byId("import-failure-list");
  list.replaceChildren();
  for (const failure of failures) {
    const row = document.createElement("article");
    row.className = "import-failure-row";
    const name = document.createElement("strong");
    name.textContent = failure.name.replace(/\\/g, "/").split("/").pop();
    const reason = document.createElement("p");
    reason.textContent = failure.message;
    const action = document.createElement("button");
    action.type = "button";
    action.className = "text-button";
    action.textContent = "다른 파일 선택";
    action.addEventListener("click", () => zipInput.click());
    row.append(name, reason, action);
    list.append(row);
  }
}

function selectedBulkItems() {
  return state.items.filter((item) => state.bulkSelection.has(item.cutId));
}

function currentPositions() {
  return state.items.map((item) => ({ cut: item.cutId, frame: item.frame }));
}

function updateBulkControls() {
  const any = state.bulkSelection.size > 0;
  for (const button of document.querySelectorAll("[data-bulk-orientation], .bulk-action-grid button")) button.disabled = !any;
  byId("bulk-reverse").disabled = state.bulkSelection.size < 2
    || !selectionIsContiguous(currentPositions(), [...state.bulkSelection]);
  byId("bulk-export").disabled = !any;
  requestAnimationFrame(() => {
    const buttons = [...document.querySelectorAll(".bulk-action-grid button")];
    for (const button of buttons) button.classList.remove("wrapped");
    for (const pair of [[buttons[0], buttons[1]], [buttons[2], buttons[3]]]) {
      if (pair.some((button) => button && button.scrollHeight > 48)) {
        for (const button of pair) button?.classList.add("wrapped");
      }
    }
  });
}

function updateToggles() {
  for (const button of document.querySelectorAll("[data-presentation]")) {
    button.classList.toggle("selected", button.dataset.presentation === state.presentation);
  }
  for (const button of document.querySelectorAll("[data-columns]")) {
    button.classList.toggle("selected", Number(button.dataset.columns) === state.columns);
    button.disabled = state.presentation === "list";
  }
  byId("column-toggle").classList.toggle("dimmed", state.presentation === "list");
}

function makeInfoRow({ label, value = "", source = "", action = "", emptyText = "", onClick, onRevert }) {
  const row = document.createElement("div");
  row.className = "info-row";
  const main = document.createElement(onClick ? "button" : "div");
  if (onClick) main.type = "button";
  main.className = "info-row-main";
  if (onClick) main.addEventListener("click", onClick);
  const text = document.createElement("span");
  text.className = "info-row-text";
  const caption = document.createElement("span");
  caption.className = "info-row-label";
  caption.textContent = label;
  const shown = document.createElement("span");
  shown.className = value ? "info-row-value" : "info-row-value empty";
  shown.textContent = value || emptyText;
  text.append(caption, shown);
  if (source) {
    const sourceLine = document.createElement("small");
    sourceLine.textContent = source;
    text.append(sourceLine);
  }
  main.append(text);
  if (onClick || action) {
    const trailing = document.createElement("span");
    trailing.className = "info-row-action";
    trailing.textContent = action || "›";
    main.append(trailing);
  }
  row.append(main);
  if (onRevert) {
    const revert = document.createElement("button");
    revert.className = "row-revert";
    revert.type = "button";
    revert.textContent = "롤 값으로 되돌리기";
    revert.addEventListener("click", onRevert);
    row.append(revert);
  }
  return row;
}

function cutMeta(item) {
  if (!state.cutMeta[item.cutId]) {
    const providerAttached = Boolean(state.recordFileName);
    state.cutMeta[item.cutId] = {
      name: item.importedRecord?.cutName ?? "",
      date: item.importedRecord?.date ?? "",
      nameSource: item.importedRecord?.cutName ? "가져온 기록" : "",
      dateSource: item.importedRecord?.date ? "가져온 기록" : "",
      dateProvenance: providerAttached ? SHOOTING_DATE_PROVENANCE.provider : SHOOTING_DATE_PROVENANCE.none,
    };
  }
  return state.cutMeta[item.cutId];
}

function openCut(index) {
  state.currentCut = Math.max(0, Math.min(index, state.items.length - 1));
  renderCut();
  showScreen("cut");
}

function renderCut() {
  refreshItems();
  const item = state.items[state.currentCut];
  if (!item) return;
  const token = ++state.thumbnailToken;
  byId("cut-position").textContent = `${String(state.currentCut + 1).padStart(2, "0")} / ${String(state.items.length).padStart(2, "0")}`;
  byId("cut-roll-name").textContent = rollNameInput.value.trim() || defaultRollName();
  renderPhoto(byId("cut-photo"), item, 720, token, `${item.frame}번 컷 큰 사진`);

  const meta = cutMeta(item);
  const cutInfoCard = byId("cut-info-card");
  cutInfoCard.replaceChildren(
    makeInfoRow({ label: "컷 이름", value: meta.name, source: meta.nameSource, emptyText: "—", action: meta.name ? "바꾸기" : "추가", onClick: () => openMetaEditor("name", "컷 이름") }),
    makeInfoRow({ label: "컷 번호", value: String(item.frame), action: "바꾸기", onClick: () => openMetaEditor("frame", "컷 번호") }),
    makeInfoRow({ label: "촬영일", value: meta.date, source: meta.dateSource, emptyText: "—", action: meta.date ? "바꾸기" : "추가", onClick: () => openMetaEditor("date", "촬영일") }),
  );

  byId("scan-info-card").replaceChildren(
    makeInfoRow({ label: "파일 이름", value: item.name, emptyText: "—" }),
    ...(completenessBlocksExport(item)
      ? [makeInfoRow({ label: "원본 상태", value: SCAN_UNREADABLE_MESSAGE })]
      : []),
  );
  byId("roll-info-hint").hidden = !rollIsEmpty();
  const shootingCard = byId("shooting-info-card");
  shootingCard.replaceChildren();
  for (const field of shootingFields) {
    const presentation = resolveCutField(state.roll, item.importedRecord, cutValues(item), field.key);
    shootingCard.append(makeInfoRow({
      label: field.label,
      value: presentation.value,
      emptyText: "—",
      source: presentation.source,
      action: presentation.value ? "바꾸기" : "추가",
      onClick: () => openFieldEditor("cut", field),
      onRevert: presentation.hasCutValue ? () => {
        delete ensureCutValues(item)[field.key];
        invalidateShareSession();
        renderCut();
      } : null,
    }));
  }
  byId("previous-cut").disabled = state.currentCut === 0;
  byId("next-cut").disabled = state.currentCut === state.items.length - 1;
}

function renderRollInfo() {
  const root = byId("roll-info-groups");
  root.replaceChildren();
  for (const [title, keys] of rollGroups) {
    const section = document.createElement("section");
    section.className = "detail-group";
    const heading = document.createElement("h2");
    heading.textContent = title;
    const card = document.createElement("div");
    card.className = "info-card row-card";
    for (const key of keys) {
      const field = shootingFields.find((candidate) => candidate.key === key);
      card.append(makeInfoRow({
        label: field.label,
        value: state.roll[key] ?? "",
        source: state.importedRollKeys.has(key) ? "가져온 기록" : "",
        onClick: () => openFieldEditor("roll", field),
      }));
    }
    if (title) section.append(heading);
    section.append(card);
    root.append(section);
  }
  byId("roll-info-help").hidden = !rollIsEmpty();
  const unmatched = state.records
    .map((record) => record.n)
    .filter((number) => !state.items.some((item) => item.frame === number));
  const unmatchedLine = unmatched.length ? `맞는 컷이 없는 기록: ${compactNumbers(unmatched)}번` : "";
  byId("record-unmatched").textContent = unmatchedLine;
  byId("record-unmatched").hidden = !unmatchedLine;
  byId("example-record-import").hidden = !state.exampleActive;
}

function openRollInfo(returnScreen = state.screen) {
  state.returnScreen = returnScreen;
  renderRollInfo();
  showScreen("roll-info");
  if (!state.templateGuideSeen) showTemplateGuide();
}

function openMetaEditor(key, label) {
  const item = state.items[state.currentCut];
  const meta = cutMeta(item);
  state.editing = {
    scope: "meta", key, label, returnScreen: "cut", draft: key === "frame" ? String(item.frame) : meta[key] ?? "",
    currentFrame: key === "frame" ? item.frame : null,
  };
  renderFieldEditor();
  showScreen("field");
}

function openFieldEditor(scope, field) {
  const item = state.items[state.currentCut];
  let draft = "";
  let inherited = "";
  let hasCutValue = false;
  if (scope === "roll") {
    draft = state.roll[field.key] ?? "";
  } else {
    const presentation = resolveCutField(state.roll, item.importedRecord, cutValues(item), field.key);
    draft = cutValues(item)?.[field.key] ?? "";
    inherited = presentation.hasCutValue ? "" : presentation.value;
    hasCutValue = presentation.hasCutValue;
  }
  state.editing = {
    scope, field, key: field.key, label: field.label, returnScreen: scope === "roll" ? "roll-info" : "cut",
    draft, original: draft, inherited, hasCutValue,
  };
  renderFieldEditor();
  showScreen("field");
}

function openBulkFieldEditor(field) {
  state.editing = {
    scope: "bulk", field, key: field.key, label: field.label, returnScreen: "bulk-info",
    draft: state.bulkDraft[field.key] ?? "", original: state.bulkDraft[field.key] ?? "", inherited: "", hasCutValue: false,
  };
  renderFieldEditor();
  showScreen("field");
}

function openCommandEditor({ label, key, placeholder = "", inputMode = "text", onApply }) {
  state.editing = { scope: "command", key, label, returnScreen: "roll", draft: "", inherited: placeholder, inputMode, onApply };
  renderFieldEditor();
  showScreen("field");
}

function renderBulkInfo() {
  byId("bulk-info-title").textContent = `고른 ${state.bulkSelection.size}컷에 넣기`;
  const root = byId("bulk-info-rows");
  root.replaceChildren();
  for (const field of shootingFields) {
    const value = state.bulkDraft[field.key] ?? "";
    root.append(makeInfoRow({
      label: field.label, value, emptyText: "—", action: value.trim() ? "바꾸기" : "추가",
      onClick: () => openBulkFieldEditor(field),
    }));
  }
  byId("bulk-info-done").disabled = !Object.values(state.bulkDraft).some((value) => String(value).trim());
}

function shownBulkValues() {
  return Object.fromEntries(selectedBulkItems().map((item) => [
    item.cutId,
    Object.fromEntries(shootingFields.map((field) => [
      field.key, resolveCutField(state.roll, item.importedRecord, cutValues(item), field.key).value,
    ])),
  ]));
}

function saveBulkInfo(replaceExisting) {
  const plan = planBulkShootingInfo(shownBulkValues(), state.bulkDraft, replaceExisting);
  for (const [cutId, changes] of Object.entries(plan.assignments)) {
    const item = state.items.find((candidate) => candidate.cutId === cutId);
    if (!item) continue;
    Object.assign(ensureCutValues(item), changes);
  }
  state.bulkEditing = false;
  state.bulkSelection = new Set();
  state.bulkAfterAction = false;
  state.bulkDraft = {};
  invalidateShareSession();
  renderRoll();
  showScreen("roll");
  showBulkNotice(plan.resultText);
}

function requestBulkInfoSave() {
  const plan = planBulkShootingInfo(shownBulkValues(), state.bulkDraft, false);
  if (plan.collisionCutCount > 0) {
    showDialog({
      title: `이미 값이 있는 ${plan.collisionCutCount}컷도 바꿀까요?`, body: "",
      cancel: "아니요", confirm: "바꾸기",
      onCancel: () => saveBulkInfo(false), onConfirm: () => saveBulkInfo(true),
    });
  } else saveBulkInfo(false);
}

function renderFieldEditor() {
  const editing = state.editing;
  if (!editing) return;
  byId("field-title").textContent = editing.label;
  byId("field-input-label").textContent = editing.label;
  const input = byId("field-input");
  input.value = editing.draft;
  input.placeholder = editing.inherited || editing.field?.placeholder || "";
  input.inputMode = editing.inputMode ?? editing.field?.inputMode ?? (["focal", "frame"].includes(editing.key) ? "decimal" : "text");
  const helper = byId("field-helper");
  helper.textContent = editing.scope === "meta" && editing.key === "frame" ? FRAME_NUMBER_HELPER : "";
  helper.hidden = !helper.textContent;
  const choices = byId("field-choices");
  choices.replaceChildren();
  for (const choice of editing.field?.choices ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = choice;
    button.addEventListener("click", () => { input.value = choice; editing.draft = choice; updateFieldMessage(); });
    choices.append(button);
  }
  choices.hidden = choices.childElementCount === 0;
  byId("field-revert").hidden = !(editing.scope === "cut" && editing.hasCutValue);
  renderRecentValues();
  updateFieldMessage();
  requestAnimationFrame(() => input.focus());
}

function renderRecentValues() {
  const editing = state.editing;
  const values = editing.field?.recent ? (state.recent[editing.key] ?? []) : [];
  const section = byId("recent-section");
  const root = byId("recent-values");
  root.replaceChildren();
  for (const value of values.filter((candidate) => !(editing.field?.choices ?? []).includes(candidate))) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = value;
    button.addEventListener("click", () => {
      byId("field-input").value = value;
      editing.draft = value;
      finishFieldEdit(true);
    });
    root.append(button);
  }
  section.hidden = root.childElementCount === 0;
}

function isShootingDateEditor(editing) {
  return editing?.key === "date" && (editing.scope === "meta" || editing.scope === "command");
}

function shootingDateEditResult(raw) {
  const value = String(raw ?? "").trim();
  return { value, valid: value === "" || cleanShootingDate(value) === value };
}

function updateFieldMessage() {
  const editing = state.editing;
  const message = byId("field-message");
  const value = byId("field-input").value;
  editing.draft = value;
  const done = byId("field-done");
  if (editing.scope === "meta" && editing.key === "frame") {
    const result = evaluateFrameNumberEdit(
      value,
      editing.currentFrame,
      new Set(currentPositions().map(({ frame }) => frame)),
    );
    editing.validationMessage = frameNumberMessage(result.messageKey) ?? "";
    editing.validationValue = value;
    done.disabled = !result.completeEnabled;
  } else if (isShootingDateEditor(editing)) {
    const result = shootingDateEditResult(value);
    editing.validationMessage = result.valid ? "" : SHOOTING_DATE_INVALID_MESSAGE;
    editing.validationValue = value;
    done.disabled = !result.valid;
  } else {
    done.disabled = false;
  }
  if (editing.validationValue !== value) editing.validationMessage = "";
  if (editing.validationMessage) {
    message.textContent = editing.validationMessage;
    message.classList.add("error-text");
    message.hidden = false;
    return;
  }
  message.classList.remove("error-text");
  const reason = editing.field?.reason;
  if (reason && shouldShowExifReason(reason, value)) {
    message.textContent = sharedCopy("reason_text").text_ios;
    message.hidden = false;
  } else {
    message.textContent = "";
    message.hidden = true;
  }
}

function currentRelatedValue(key) {
  const editing = state.editing;
  if (editing.scope === "roll") return state.roll[key] ?? "";
  if (editing.scope === "bulk") return state.bulkDraft[key] ?? "";
  const item = state.items[state.currentCut];
  return resolveCutField(state.roll, item.importedRecord, cutValues(item), key).value;
}

function suggestionForEdit() {
  const editing = state.editing;
  if (editing.key !== "film" && editing.key !== "lens") return null;
  const previousLens = editing.key === "lens" ? editing.original : currentRelatedValue("lens");
  const previousFilm = editing.key === "film" ? editing.original : currentRelatedValue("film");
  return inputSuggestionAsk({
    previousLens,
    newLens: editing.key === "lens" ? editing.draft : previousLens,
    focal: currentRelatedValue("focal"),
    previousFilm,
    newFilm: editing.key === "film" ? editing.draft : previousFilm,
    manufacturer: currentRelatedValue("maker"),
    boxSpeed: currentRelatedValue("boxSpeed"),
  });
}

function applySuggestedValues(target, suggestion) {
  if (!suggestion) return;
  const values = { ...suggestion.fills, ...suggestion.changes };
  if (values.manufacturer) target.maker = values.manufacturer;
  if (values.boxSpeed) target.boxSpeed = values.boxSpeed;
  if (values.focal) target.focal = values.focal;
}

function applyFieldValue(value, extra = null) {
  const editing = state.editing;
  if (isShootingDateEditor(editing)) {
    const result = shootingDateEditResult(value);
    if (!result.valid) {
      editing.validationMessage = SHOOTING_DATE_INVALID_MESSAGE;
      editing.validationValue = value;
      updateFieldMessage();
      return;
    }
    value = result.value;
  }
  if (editing.scope === "command") {
    if (editing.onApply(value.trim()) === false) return;
  } else if (editing.scope === "meta") {
    const item = state.items[state.currentCut];
    const meta = cutMeta(item);
    if (editing.key === "name" || editing.key === "date") {
      meta[editing.key] = value.trim();
      meta[`${editing.key}Source`] = value.trim() ? "이 컷에만 입력" : "";
      if (editing.key === "date") meta.dateProvenance = value.trim()
        ? SHOOTING_DATE_PROVENANCE.user : SHOOTING_DATE_PROVENANCE.deleted;
    }
    if (editing.key === "frame") {
      const result = evaluateFrameNumberEdit(
        value,
        editing.currentFrame,
        new Set(currentPositions().map(({ frame }) => frame)),
      );
      if (!result.completeEnabled) {
        editing.validationMessage = frameNumberMessage(result.messageKey) ?? "";
        editing.validationValue = value;
        updateFieldMessage();
        return;
      }
      const positions = currentPositions().map((position) => position.cut === item.cutId
        ? { ...position, frame: result.value } : position);
      const problem = framePositionsProblem(positions);
      if (problem) {
        editing.validationMessage = problem;
        editing.validationValue = value;
        updateFieldMessage();
        return;
      }
      applyBulkPositions(positions);
    }
  } else if (editing.scope === "roll") {
    if (value.trim()) state.roll[editing.key] = value;
    else delete state.roll[editing.key];
    state.importedRollKeys.delete(editing.key);
    applySuggestedValues(state.roll, extra);
  } else if (editing.scope === "bulk") {
    if (value.trim()) state.bulkDraft[editing.key] = value.trim();
    else delete state.bulkDraft[editing.key];
    applySuggestedValues(state.bulkDraft, extra);
  } else {
    const item = state.items[state.currentCut];
    const record = ensureCutValues(item);
    if (value.trim()) record[editing.key] = value;
    else delete record[editing.key];
    applySuggestedValues(record, extra);
  }
  if (editing.field?.recent && value.trim()) {
    const values = state.recent[editing.key] ?? [];
    state.recent[editing.key] = [value.trim(), ...values.filter((candidate) => candidate !== value.trim())].slice(0, 5);
  }
  invalidateShareSession();
  refreshItems();
  if (editing.returnScreen === "roll-info") renderRollInfo();
  else if (editing.returnScreen === "bulk-info") renderBulkInfo();
  else if (editing.returnScreen === "roll") renderRoll();
  else renderCut();
  showScreen(editing.returnScreen);
  state.editing = null;
}

function finishFieldEdit(fromRecent = false) {
  const editing = state.editing;
  if (!editing) return;
  editing.draft = byId("field-input").value;
  if (editing.scope !== "command" && editing.scope !== "meta" && INTEGER_INPUT_LABELS[editing.key]) {
    const prepared = prepareIntegerFieldInput(editing.key, editing.draft, editing.original ?? "");
    if (!prepared.accepted) {
      editing.validationMessage = prepared.message;
      editing.validationValue = editing.draft;
      updateFieldMessage();
      return;
    }
    editing.draft = prepared.value;
  }
  const bulb = editing.key === "sh" ? normalizeBulb(editing.draft) : null;
  if (bulb && bulb !== editing.draft.trim()) {
    showDialog({
      title: `셔터를 ${bulb}로 바꿀까요?`, body: sharedCopy("dialog_body").text_ios,
      cancel: "아니요", confirm: "바꾸기",
      onCancel: () => applyFieldValue(editing.draft), onConfirm: () => applyFieldValue(bulb),
    });
    return;
  }
  const ask = suggestionForEdit();
  if (ask) {
    showDialog({
      title: ask.title, body: ask.body, cancel: "아니요", confirm: ask.accept,
      onCancel: () => applyFieldValue(editing.draft), onConfirm: () => applyFieldValue(editing.draft, ask),
    });
    return;
  }
  applyFieldValue(editing.draft);
  if (fromRecent) renderRecentValues();
}

function showDialog({ title, body, cancel, confirm, onCancel, onConfirm, onDismiss, dismissOnOutside = false }) {
  state.dialog = { onCancel, onConfirm, onDismiss, dismissOnOutside };
  byId("dialog-title").textContent = title;
  byId("dialog-body").textContent = body;
  byId("dialog-body").hidden = !body;
  byId("dialog-options").hidden = true;
  byId("dialog-options").replaceChildren();
  byId("dialog-cancel").hidden = false;
  byId("dialog-confirm").hidden = false;
  byId("dialog-cancel").textContent = cancel;
  byId("dialog-confirm").textContent = confirm;
  byId("dialog-layer").hidden = false;
  byId("dialog-confirm").focus();
}

function showOptionDialog(title, choices) {
  state.dialog = { onCancel: () => {} };
  byId("dialog-title").textContent = title;
  byId("dialog-body").hidden = true;
  const root = byId("dialog-options");
  root.replaceChildren();
  for (const choice of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = choice.label;
    button.addEventListener("click", () => {
      byId("dialog-layer").hidden = true;
      state.dialog = null;
      choice.action();
    });
    root.append(button);
  }
  root.hidden = false;
  byId("dialog-cancel").hidden = false;
  byId("dialog-cancel").textContent = "닫기";
  byId("dialog-confirm").hidden = true;
  byId("dialog-layer").hidden = false;
  root.querySelector("button")?.focus();
}

function closeDialog(action) {
  const dialog = state.dialog;
  byId("dialog-layer").hidden = true;
  state.dialog = null;
  byId("dialog-body").hidden = false;
  byId("dialog-options").hidden = true;
  byId("dialog-confirm").hidden = false;
  if (action === "confirm") dialog?.onConfirm?.();
  else if (action === "dismiss") dialog?.onDismiss?.();
  else dialog?.onCancel?.();
}

function openExampleSheet() {
  byId("example-sheet-layer").hidden = false;
  byId("example-sheet-close").focus();
}

function closeExampleSheet() {
  byId("example-sheet-layer").hidden = true;
}

function showTemplateGuide() {
  showDialog({
    title: "촬영 기록 불러오기 안내",
    body: "CSV, 마크다운, 텍스트 파일로 저장한 촬영 기록 메모를 읽어서 반영할 수 있어요.",
    cancel: "예시 파일 받기",
    confirm: "확인",
    dismissOnOutside: true,
    onCancel: () => { state.templateGuideSeen = true; openExampleSheet(); },
    onConfirm: () => { state.templateGuideSeen = true; },
    onDismiss: () => { state.templateGuideSeen = true; },
  });
}

function showBulkNotice(message) {
  if (state.bulkNoticeTimer) window.clearTimeout(state.bulkNoticeTimer);
  state.bulkMessage = message;
  byId("bulk-result").textContent = message;
  byId("bulk-result").hidden = !message;
  if (!message) return;
  placeBulkNoticeAboveActions();
  state.bulkNoticeTimer = window.setTimeout(() => {
    state.bulkMessage = "";
    byId("bulk-result").hidden = true;
    state.bulkNoticeTimer = null;
  }, 4000);
}

function placeBulkNoticeAboveActions() {
  const notice = byId("bulk-result");
  const screen = document.querySelector('[data-screen]:not([hidden])');
  const actions = screen?.querySelector(".bottom-bar");
  const bottom = actions ? Math.max(8, window.innerHeight - actions.getBoundingClientRect().top + 8) : 8;
  notice.style.bottom = `${Math.round(bottom)}px`;
}

async function renderPreview() {
  const token = ++state.previewToken;
  const question = byId("preview-question");
  const helper = byId("preview-helper");
  const largeApp = byId("large-photo-app");
  previewWrap.classList.remove("limit");
  largeApp.hidden = true;
  previewCanvas.hidden = true;
  question.hidden = false;
  helper.classList.toggle("visible", state.mode !== null);
  helper.setAttribute("aria-hidden", state.mode === null ? "true" : "false");
  if (state.mode === null || !state.items.length) {
    question.innerHTML = "사진 아래에 카메라·필름 같은 촬영 정보를 넣을 수 있어요.<br>아래에서 고르면 여기에 미리보기가 나와요.";
    return;
  }
  const fallback = state.items[0];
  const item = currentExportItems()[0] ?? { ...fallback, correction: photoCorrection(fallback) };
  if (state.mode !== "off" && !evaluateInformationFramePhotoLimit(item).allowed) {
    question.textContent = "이 사진은 웹에서 원본 크기 그대로 액자를 넣기엔 커요.";
    largeApp.hidden = !state.appPreviewAvailable.large;
    previewWrap.classList.add("limit");
    return;
  }
  try {
    let source;
    if (state.mode === "off") {
      const image = await createImageBitmap(photoBlob(item), { imageOrientation: "from-image" });
      const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      image.close();
      source = canvas;
    } else {
      const rendered = await renderInformationFrame(item, item.record, state.mode, item.frame, 0.9, state.rollFrameLabel, state.rgbHistogram);
      source = applyPaddingRatioCanvas(rendered.canvas, state.paddingRatio, rendered.geometry.photoY, rendered.geometry.photoHeight);
    }
    if (token !== state.previewToken) return;
    previewCanvas.width = source.width;
    previewCanvas.height = source.height;
    previewCanvas.getContext("2d").drawImage(source, 0, 0);
    question.hidden = true;
    previewCanvas.hidden = false;
  } catch (error) {
    if (token === state.previewToken) setStatus(error.message, true, exportStatus);
  }
}

function currentExportItems() {
  return state.items
    .filter((item) => state.exportSelection.has(item.frame))
    .map((item) => ({ ...item, correction: photoCorrection(item), cutName: cutMeta(item).name }));
}

function updateExportControls() {
  for (const input of document.querySelectorAll('input[name="frame-mode"]')) input.checked = input.value === state.mode;
  byId("roll-frame-row").hidden = state.mode === null || state.mode === "off";
  byId("rgb-histogram-row").hidden = !showsRGBHistogramControl(state.mode);
  byId("ratio-row").hidden = state.mode === null || state.mode === "off";
  byId("roll-frame-label").checked = state.rollFrameLabel;
  byId("rgb-histogram").checked = state.rgbHistogram;
  for (const button of document.querySelectorAll("[data-ratio]")) button.classList.toggle("selected", button.dataset.ratio === state.paddingRatio);
  for (const button of document.querySelectorAll("[data-format]")) button.classList.toggle("selected", button.dataset.format === state.exportFormat);
  for (const button of document.querySelectorAll("[data-quality]")) button.classList.toggle("selected", button.dataset.quality === state.exportQuality);
  for (const button of document.querySelectorAll("[data-digits]")) button.classList.toggle("selected", Number(button.dataset.digits) === state.exportDigits);
  const qualityRow = byId("quality-row");
  qualityRow.hidden = state.exportFormat === "png";
  const lossless = qualityRow.querySelector('[data-quality="lossless"]');
  lossless.hidden = state.exportFormat !== "webp";
  byId("quality-toggle").classList.toggle("four", state.exportFormat === "webp");
  byId("quality-toggle").classList.toggle("three", state.exportFormat !== "webp");
  const chosen = state.exportSelection.size;
  byId("selected-cut-count").textContent = `${chosen}컷 선택 (전체 ${state.items.length}컷)`;
  byId("toggle-all-cuts").textContent = chosen === state.items.length ? "전체 해제" : "전체 선택";
  const selected = currentExportItems();
  const blocked = selected.some(completenessBlocksExport);
  const blocker = state.mode === null
    ? "사진만·간단히·자세히 중에서 하나를 골라 주세요."
    : chosen === 0 ? "내보낼 컷을 골라 주세요."
      : blocked ? "스캔 파일을 열 수 없어요." : "";
  byId("export-blocker").textContent = blocker;
  exportButton.disabled = state.mode === null || chosen === 0;
  exportButton.textContent = `전체 ${chosen}장 내보내기`;
}

function renderExportCuts() {
  const root = byId("export-cut-list");
  root.replaceChildren();
  const token = ++state.thumbnailToken;
  for (const item of state.items) {
    const row = document.createElement("label");
    row.className = "export-cut-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.exportSelection.has(item.frame);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.exportSelection.add(item.frame); else state.exportSelection.delete(item.frame);
      updateExportControls();
      renderPreview();
    });
    const photo = document.createElement("span");
    photo.className = "export-cut-row-photo";
    renderPhoto(photo, item, 56, token, `${item.frame}번 컷 미리보기`);
    const text = document.createElement("span");
    text.className = "export-cut-row-text";
    const title = document.createElement("strong");
    title.textContent = `${item.frame}번 컷`;
    const file = document.createElement("small");
    file.textContent = item.name;
    text.append(title, file);
    row.append(checkbox, photo, text);
    root.append(row);
  }
  updateExportControls();
}

function probeWebpSupport() {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  canvas.toBlob((blob) => {
    state.webpSupported = blob?.type === "image/webp";
    byId("webp-app-badge").hidden = state.webpSupported;
  }, "image/webp");
}

function openExport(selectedCutIds = null) {
  state.returnScreen = state.screen === "cut" ? "cut" : "roll";
  refreshItems();
  state.mode = null;
  state.exportFormat = "jpeg";
  state.exportQuality = "high";
  state.exportDigits = 2;
  state.rollFrameLabel = false;
  state.rgbHistogram = false;
  state.paddingRatio = "original";
  state.exportSelection = new Set(state.returnScreen === "cut" ? [state.items[state.currentCut].frame]
    : selectedCutIds ? state.items.filter((item) => selectedCutIds.has(item.cutId)).map((item) => item.frame)
      : state.items.map((item) => item.frame));
  exportStatus.textContent = "";
  setExportReasons();
  renderExportCuts();
  renderPreview();
  showScreen("export");
  probeWebpSupport();
}

function openBulkEdit() {
  state.bulkEditing = true;
  state.bulkSelection = new Set();
  state.bulkAfterAction = false;
  state.bulkMessage = "";
  renderRoll();
  showScreen("roll");
}

function applyBulkPositions(positions) {
  const problem = framePositionsProblem(positions);
  if (problem) {
    showBulkNotice(problem);
    return false;
  }
  state.cutOrder = positions.map(({ cut }) => cut);
  state.frameByCut = Object.fromEntries(positions.map(({ cut, frame }) => [cut, frame]));
  refreshItems();
  reprojectTemplateDates();
  state.bulkAfterAction = true;
  state.bulkMessage = "";
  invalidateShareSession();
  renderRoll();
  return true;
}

function reprojectTemplateDates() {
  const projected = reprojectProviderShootingDates(
    state.items.map((item) => {
      const meta = cutMeta(item);
      return { cutId: item.cutId, frame: item.frame, date: meta.date, dateProvenance: meta.dateProvenance };
    }),
    state.records.map((record) => ({ frame: record.n, date: record.date ?? "" })),
  );
  for (const result of projected) {
    const meta = state.cutMeta[result.cutId];
    if (meta?.dateProvenance !== SHOOTING_DATE_PROVENANCE.provider) continue;
    meta.date = result.date;
    meta.dateSource = result.date ? "가져온 기록" : "";
  }
}

function rotateBulk(kind) {
  const selected = selectedBulkItems();
  for (const item of selected) {
    const current = photoCorrection(item);
    const next = { ...current };
    if (kind === "left") next.turns = (next.turns + 3) % 4;
    if (kind === "right") next.turns = (next.turns + 1) % 4;
    if (kind === "flip") next.flipped = !next.flipped;
    state.orientation[item.cutId] = next;
  }
  state.bulkAfterAction = true;
  state.bulkMessage = "";
  invalidateShareSession();
  const token = state.thumbnailToken;
  const photos = new Map([...cutList.querySelectorAll(".list-photo")].map((photo) => [photo.dataset.cutId, photo]));
  for (const item of selected) {
    const photo = photos.get(item.cutId);
    if (photo) renderPhoto(photo, item, 72, token, `${item.frame}번 컷 미리보기`);
  }
}

function openBulkNumberMenu() {
  const selected = [...state.bulkSelection];
  showOptionDialog("번호 바꾸기", [
    { label: "+1", action: () => applyBulkPositions(shiftSelection(currentPositions(), selected, 1)) },
    { label: "−1", action: () => applyBulkPositions(shiftSelection(currentPositions(), selected, -1)) },
    { label: "몇부터 다시 매기기", action: () => openCommandEditor({
      label: "컷 번호 다시 매기기", key: "frame", placeholder: "시작 번호", inputMode: "numeric",
      onApply: (value) => {
        const parsed = frameNumberInput(value);
        if (parsed.message) {
          state.editing.validationMessage = parsed.message;
          state.editing.validationValue = value;
          updateFieldMessage();
          return false;
        }
        const positions = renumberSelection(currentPositions(), selected, parsed.value);
        const problem = framePositionsProblem(positions);
        if (problem) {
          state.editing.validationMessage = problem;
          state.editing.validationValue = value;
          updateFieldMessage();
          return false;
        }
        return applyBulkPositions(positions);
      },
    }) },
  ]);
}

function openBulkMoveMenu() {
  const selected = [...state.bulkSelection];
  showOptionDialog("옮기기", [
    { label: "맨 앞으로", action: () => applyBulkPositions(moveSelection(currentPositions(), selected, 0)) },
    { label: "맨 뒤로", action: () => applyBulkPositions(moveSelection(currentPositions(), selected, state.items.length)) },
    { label: "몇 번 컷 뒤로…", action: () => openCommandEditor({
      label: "옮기기", key: "move", placeholder: "컷 번호", inputMode: "numeric",
      onApply: (value) => {
        const target = currentPositions().find(({ frame }) => frame === Number(value));
        if (!target) return;
        const remaining = currentPositions().filter(({ cut }) => !state.bulkSelection.has(cut));
        const destination = remaining.findIndex(({ cut }) => cut === target.cut);
        applyBulkPositions(moveSelection(currentPositions(), selected, destination + 1));
      },
    }) },
  ]);
}

function openBulkDateEditor() {
  const selected = [...state.bulkSelection];
  openCommandEditor({
    label: selected.length > 1 ? `촬영일 지정 (컷 ${selected.length}개)` : "촬영일",
    key: "date", placeholder: "YYYY-MM-DD", inputMode: "numeric",
    onApply: (value) => {
      for (const item of state.items.filter((candidate) => selected.includes(candidate.cutId))) {
        const meta = cutMeta(item);
        meta.date = value;
        meta.dateSource = value ? "이 컷에만 입력" : "";
        meta.dateProvenance = value ? SHOOTING_DATE_PROVENANCE.user : SHOOTING_DATE_PROVENANCE.deleted;
      }
      state.bulkAfterAction = true;
      state.bulkMessage = "";
    },
  });
}

function contactHeaderParts() {
  const left = [rollNameInput.value.trim() || defaultRollName(), state.roll.camera, state.roll.film]
    .map((value) => String(value ?? "").trim()).filter(Boolean).join(" · ");
  const dates = state.items.map((item) => cutMeta(item).date).filter(Boolean).sort();
  const dateText = dates.length ? (dates[0] === dates.at(-1)
    ? `${dates[0].replaceAll("-", ".")}.`
    : `${dates[0].replaceAll("-", ".")}. - ${dates.at(-1).replaceAll("-", ".")}.`) : "";
  return { left, right: [dateText, `${state.items.length}컷`].filter(Boolean).join(" · ") };
}

async function renderContact() {
  const token = ++state.previewToken;
  state.contactRender = null;
  state.contactFile = null;
  updateContactControls();
  refreshItems();
  byId("contact-roll-name").textContent = rollNameInput.value.trim() || defaultRollName();
  byId("contact-loading").hidden = false;
  byId("contact-canvas").hidden = true;
  byId("contact-limit").hidden = true;
  const limit = evaluateContactSheetLimit(state.items.length, state.contactHeader);
  if (!limit.allowed) {
    byId("contact-loading").hidden = true;
    byId("contact-limit").hidden = false;
    byId("contact-app-preview").hidden = !state.appPreviewAvailable.contact;
    state.contactRender = null;
    updateContactControls();
    return;
  }
  const result = await renderContactSheet(state.items, {
    header: state.contactHeader ? contactHeaderParts() : null,
    corrections: state.orientation,
  });
  if (token !== state.previewToken || state.screen !== "contact") return;
  state.contactRender = result;
  const canvas = byId("contact-canvas");
  canvas.width = result.canvas.width;
  canvas.height = result.canvas.height;
  canvas.getContext("2d").drawImage(result.canvas, 0, 0);
  canvas.hidden = false;
  byId("contact-loading").hidden = true;
  byId("contact-result").textContent = state.contactMessage;
  updateContactControls();
}

function updateContactControls() {
  for (const button of document.querySelectorAll("[data-contact-format]")) button.classList.toggle("selected", button.dataset.contactFormat === state.contactFormat);
  for (const button of document.querySelectorAll("[data-contact-quality]")) button.classList.toggle("selected", button.dataset.contactQuality === state.contactQuality);
  byId("contact-quality-row").hidden = state.contactFormat === "png";
  byId("contact-header-enabled").checked = state.contactHeader;
  const disabled = !state.contactRender?.canvas;
  byId("contact-save").disabled = disabled;
  byId("contact-share").disabled = disabled;
}

function setContactResult(message) {
  state.contactMessage = message;
  byId("contact-result").textContent = message;
}

async function makeContactFile(download = false) {
  if (!state.contactRender?.canvas) return null;
  const started = performance.now();
  const quality = { high: 0.92, balanced: 0.82, small: 0.68 }[state.contactQuality] ?? 0.92;
  const blob = await contactSheetBlob(state.contactRender.canvas, state.contactFormat, quality);
  const extension = { jpeg: "jpg", webp: "webp", png: "png" }[state.contactFormat];
  const name = `${rollNameInput.value.trim() || defaultRollName()}_contact.${extension}`;
  const elapsedMs = performance.now() - started;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (download) downloadBytes(bytes, name, blob.type);
  state.contactFile = { blob, name, elapsedMs };
  setContactResult(state.exampleActive ? `웹 모아 보기 · ${name}` : `웹 모아 보기 · ${(elapsedMs / 1000).toFixed(2)}초 · ${name}`);
  return state.contactFile;
}

async function openContactSheet() {
  state.contactFormat = "jpeg";
  state.contactQuality = "high";
  state.contactHeader = true;
  state.contactFile = null;
  setContactResult("");
  showScreen("contact");
  probeWebpSupport();
  await renderContact();
}

async function receiveZip(file, { askRollInfo = true } = {}) {
  try {
    setStatus("ZIP을 읽고 있어요.", false, startStatus);
    const photos = await readPhotoZipBlob(file);
    thumbnailCache.clear();
    state.photos = photos;
    state.importFailures = photos.failures ?? [];
    state.exampleActive = false;
    state.exampleRecordBytes = null;
    state.cutOrder = [];
    state.frameByCut = {};
    state.cutValues = [];
    state.cutMeta = {};
    state.orientation = {};
    state.bulkEditing = false;
    state.bulkSelection = new Set();
    state.rollAskPending = askRollInfo;
    invalidateShareSession();
    renderRoll();
    showScreen("roll");
    if (state.rollAskPending && photos.length > 0 && rollIsEmpty()) {
      state.rollAskPending = false;
      showDialog({
        title: "롤 정보를 넣을까요?",
        body: "카메라·필름 같은 값을 한 번 넣으면 모든 컷에 들어가요.\n몰라도 괜찮아요. 안 넣어도 사진은 그대로 내보낼 수 있어요.",
        cancel: "나중에", confirm: "롤 정보 넣기",
        onCancel: () => {}, onConfirm: () => openRollInfo("roll"),
      });
    }
    return true;
  } catch (error) {
    thumbnailCache.clear();
    state.photos = [];
    refreshItems();
    showScreen("start");
    setStatus(error.message, true, startStatus, error.kind, error.limit);
    return false;
  }
}

function numberFromExampleName(name) {
  const value = Number(String(name).match(/(\d+)(?=\.[^.]+$)/)?.[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

async function startHanriverExample() {
  const button = byId("shifted-demo");
  button.disabled = true;
  setStatus("합성 예시를 열고 있어요.", false, startStatus);
  try {
    const { hanriverRollExampleBytes } = await import("./examples/hanriver-roll.js");
    const { zipBytes, recordBytes } = hanriverRollExampleBytes();
    const opened = await receiveZip(new File([zipBytes], "hanriver-roll.zip", { type: "application/zip" }), { askRollInfo: false });
    if (!opened) return;
    state.exampleActive = true;
    state.exampleRecordBytes = recordBytes;
    state.frameByCut = Object.fromEntries(state.photos.map((photo) => [photo.name, numberFromExampleName(photo.name)]));
    refreshItems();
    renderRoll();
  } catch (error) {
    showScreen("start");
    setStatus(error.message, true, startStatus);
  } finally {
    button.disabled = false;
  }
}

function renderRecordConfirmation() {
  const pending = state.pendingRecord;
  if (!pending) return;
  const { parsed, fileName, unreadRaw } = pending;
  byId("record-confirm-name").textContent = fileName;
  const rollRoot = byId("record-roll-values");
  rollRoot.replaceChildren();
  for (const [key, label] of TEMPLATE_ROLL_FIELDS) {
    const row = document.createElement("div");
    row.className = "template-line";
    const name = document.createElement("span");
    name.textContent = label;
    const value = document.createElement("span");
    value.textContent = parsed.roll[key] ?? "—";
    row.append(name, value);
    rollRoot.append(row);
  }

  const cutRoot = byId("record-cut-values");
  cutRoot.replaceChildren();
  for (const cut of parsed.cuts) {
    const row = document.createElement("div");
    row.className = "template-line";
    row.textContent = templateCutLine(cut);
    cutRoot.append(row);
  }

  const noticeRoot = byId("record-confirm-notices");
  noticeRoot.replaceChildren();
  const rejected = cutNameRejectedLine(parsed.cuts.filter((cut) => cut.cutNameRejected).map((cut) => cut.n));
  const missing = rollMissingNumberLine(parsed.cuts.map((cut) => cut.n), state.items.map((item) => item.frame));
  const notices = [
    rejected,
    unknownColumnsLine(parsed.unknownColumns),
    parsed.unread.length ? "읽지 못한 줄은 메모에 남겼어요." : null,
    ...templateConfirmationNoticeLines(parsed.confirmations?.map((confirmation) => confirmation.kind)),
    missing,
  ].filter(Boolean);
  for (const text of notices) {
    const line = document.createElement("p");
    line.textContent = text;
    noticeRoot.append(line);
  }

  const unreadRoot = byId("record-unread-lines");
  unreadRoot.replaceChildren();
  for (const entry of unreadRaw) {
    const line = document.createElement("div");
    line.textContent = `${entry.line}: ${entry.text}`;
    unreadRoot.append(line);
  }
  byId("record-confirm").disabled = false;
}

function confirmRecordImport() {
  const pending = state.pendingRecord;
  if (!pending) return;
  const { parsed, fileName } = pending;
  const importedRoll = { ...parsed.roll };
  if (importedRoll.name) {
    rollNameInput.value = importedRoll.name;
    delete importedRoll.name;
  }
  state.roll = { ...state.roll, ...importedRoll };
  state.importedRollKeys = new Set(Object.keys(importedRoll));
  state.records = parsed.cuts;
  state.recordFileName = fileName;
  refreshItems();
  for (const item of state.items) {
    const meta = cutMeta(item);
    if (item.importedRecord?.cutName && !meta.name) {
      meta.name = item.importedRecord.cutName;
      meta.nameSource = "가져온 기록";
    }
    if (meta.dateProvenance === SHOOTING_DATE_PROVENANCE.none) meta.dateProvenance = SHOOTING_DATE_PROVENANCE.provider;
  }
  reprojectTemplateDates();
  invalidateShareSession();
  byId("record-name").textContent = `${fileName} · ${parsed.cuts.length}컷을 읽었어요.`;
  byId("record-name").classList.remove("error-text");
  state.pendingRecord = null;
  renderRollInfo();
  showScreen("roll-info");
}

async function receiveRecord(file) {
  try {
    const text = await file.text();
    const parsed = file.name.toLowerCase().endsWith(".csv") ? parseCsvRecord(text) : parseMarkdownRecord(text);
    state.pendingRecord = {
      fileName: file.name,
      parsed,
      unreadRaw: recordUnreadEntries(parsed, text),
    };
    renderRecordConfirmation();
    showScreen("record-confirm");
  } catch (error) {
    state.pendingRecord = null;
    byId("record-name").textContent = error.message;
    byId("record-name").classList.add("error-text");
    showScreen("roll-info");
  } finally {
    recordInput.value = "";
  }
}

async function buildOutput() {
  const rollName = rollNameInput.value || defaultRollName();
  const quality = { high: 0.92, balanced: 0.82, small: 0.68 }[state.exportQuality] ?? 0.92;
  return exportConfiguredZip(currentExportItems(), {
    rollName, mode: state.mode, format: state.exportFormat, quality,
    width: state.exportDigits, rollFrameLabel: state.rollFrameLabel,
    rgbHistogram: state.mode === "off" ? false : state.rgbHistogram,
    paddingRatio: state.mode === "off" ? "original" : state.paddingRatio,
  });
}

function openAppPreview(kind) {
  const preview = appPreviews[kind];
  if (!preview || !state.appPreviewAvailable[kind]) return;
  byId("app-preview-title").textContent = preview.title;
  byId("app-preview-image").src = preview.image;
  byId("app-preview-caption").textContent = preview.caption;
  byId("app-preview-layer").hidden = false;
  byId("app-preview-close").focus();
}

const RESULT_PREVIEW_EDGE = 112;

/** Result rows show a small canvas drawn once per file (decoded at thumbnail size), not the full-size result. */
function makeResultPreview(file) {
  return (async () => {
    const dimensions = await shownPhotoDimensions(file.blob, file.width, file.height, file.type === "image/jpeg" ? "jpeg" : "other");
    const { bitmap } = await makeThumbnailBitmap(file.blob, { maxEdge: RESULT_PREVIEW_EDGE, dimensions });
    try {
      const scale = Math.min(RESULT_PREVIEW_EDGE / bitmap.width, RESULT_PREVIEW_EDGE / bitmap.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas;
    } finally {
      bitmap.close?.();
    }
  })();
}

function showResultPreview(file, slot) {
  if (file.previewReleased) return;
  file.preview ??= makeResultPreview(file);
  file.preview.then((canvas) => {
    if (file.previewReleased || !slot.isConnected) return;
    slot.replaceChildren(canvas);
  }, () => {});
}

/** Called when the result screen is left or replaced: previews and the result files are let go. */
function releaseResult(result) {
  for (const file of result?.files ?? []) {
    file.previewReleased = true;
    file.preview?.then((canvas) => { canvas.width = 0; canvas.height = 0; }, () => {});
    file.preview = null;
  }
}

function renderResult() {
  const result = state.result;
  byId("result-title").textContent = `사진 ${result.files.length}장을 내려받았어요.`;
  // Measured time only for the user's own ZIP; a built-in example says nothing about their device.
  byId("export-elapsed").hidden = state.exampleActive;
  byId("export-elapsed").textContent = state.exampleActive ? "" : `롤 전체 내보내기 · ${(result.elapsedMs / 1000).toFixed(2)}초`;
  const chosen = result.files.filter((file) => file.selected).length;
  byId("result-files-title").textContent = `공유할 파일 · ${chosen}개 선택`;
  byId("toggle-all-results").textContent = chosen === result.files.length ? "전체 해제" : "전체 선택";
  const root = byId("result-file-list");
  root.replaceChildren();
  for (const file of result.files) {
    const row = document.createElement("label");
    row.className = "result-file-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = file.selected;
    checkbox.addEventListener("change", () => { file.selected = checkbox.checked; renderResult(); });
    const thumb = document.createElement("span");
    thumb.className = "result-thumb";
    showResultPreview(file, thumb);
    const text = document.createElement("span");
    text.className = "result-file-text";
    const name = document.createElement("strong");
    name.textContent = file.name;
    const detail = document.createElement("small");
    detail.textContent = `${file.type.replace("image/", "").toUpperCase()} · ${Math.max(1, Math.round(file.size / 1024))}KB`;
    text.append(name, detail);
    row.append(checkbox, thumb, text);
    root.append(row);
  }
  shareProgress.hidden = true;
  updateShareAvailability();
}

zipInput.addEventListener("change", async () => {
  const file = zipInput.files[0] ?? null;
  try {
    if (file) await receiveZip(file);
  } finally {
    zipInput.value = "";
  }
});
recordInput.addEventListener("change", () => recordInput.files[0] && receiveRecord(recordInput.files[0]));
byId("shifted-demo").addEventListener("click", startHanriverExample);
byId("record-import").addEventListener("click", () => recordInput.click());
byId("example-record-import").addEventListener("click", () => {
  if (state.exampleActive && state.exampleRecordBytes) {
    receiveRecord(new File([state.exampleRecordBytes], "hanriver_shooting_record.csv", { type: "text/csv" }));
  }
});
byId("record-examples").addEventListener("click", openExampleSheet);
byId("record-guide-info").addEventListener("click", showTemplateGuide);
byId("record-cancel").addEventListener("click", () => { state.pendingRecord = null; renderRollInfo(); showScreen("roll-info"); });
byId("record-confirm").addEventListener("click", confirmRecordImport);
byId("example-sheet-close").addEventListener("click", closeExampleSheet);
byId("example-sheet-layer").addEventListener("click", (event) => { if (event.target === byId("example-sheet-layer")) closeExampleSheet(); });
byId("bulk-result").addEventListener("click", () => showBulkNotice(""));
for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add("is-over"); });
}
for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove("is-over"); });
}
dropZone.addEventListener("drop", (event) => event.dataTransfer.files[0] && receiveZip(event.dataTransfer.files[0]));

for (const button of document.querySelectorAll("[data-presentation]")) {
  button.addEventListener("click", () => { state.presentation = button.dataset.presentation; renderRoll(); });
}
for (const button of document.querySelectorAll("[data-columns]")) {
  button.addEventListener("click", () => { state.columns = Number(button.dataset.columns); renderRoll(); });
}
for (const button of document.querySelectorAll("[data-open-export]")) button.addEventListener("click", () => openExport());
for (const button of document.querySelectorAll("[data-open-roll-info]")) button.addEventListener("click", () => openRollInfo("cut"));
for (const button of document.querySelectorAll("[data-go-start]")) button.addEventListener("click", () => showScreen("start"));

byId("roll-info-button").addEventListener("click", () => openRollInfo("roll"));
byId("roll-menu").addEventListener("click", () => showOptionDialog("롤 메뉴", [
  {
    label: "순서대로 번호 다시 매기기",
    action: () => showDialog({
      title: "지금 순서대로 1번부터 번호를 다시 매길까요?",
      body: "",
      cancel: "취소",
      confirm: "확인",
      onCancel: () => {},
      onConfirm: () => {
        applyBulkPositions(renumberByOrder(currentPositions()));
        renderRoll();
        showScreen("roll");
      },
    }),
  },
]));
byId("open-bulk-edit").addEventListener("click", openBulkEdit);
byId("open-contact-sheet").addEventListener("click", openContactSheet);
byId("bulk-toggle-all").addEventListener("click", () => {
  state.bulkSelection = state.bulkSelection.size === state.items.length ? new Set() : new Set(state.items.map((item) => item.cutId));
  state.bulkAfterAction = false;
  state.bulkMessage = "";
  renderRoll();
});
function finishBulkEdit() {
  state.bulkEditing = false;
  state.bulkSelection = new Set();
  state.bulkMessage = "";
  renderRoll();
}
byId("bulk-header-back").addEventListener("click", finishBulkEdit);
byId("bulk-finish").addEventListener("click", finishBulkEdit);
byId("bulk-export").addEventListener("click", () => openExport(new Set(state.bulkSelection)));
byId("bulk-shooting-info").addEventListener("click", () => {
  state.bulkDraft = {};
  renderBulkInfo();
  showScreen("bulk-info");
});
byId("bulk-info-back").addEventListener("click", () => { state.bulkDraft = {}; renderRoll(); showScreen("roll"); });
byId("bulk-info-done").addEventListener("click", requestBulkInfoSave);
byId("bulk-number").addEventListener("click", openBulkNumberMenu);
byId("bulk-date").addEventListener("click", openBulkDateEditor);
byId("bulk-move").addEventListener("click", openBulkMoveMenu);
byId("bulk-reverse").addEventListener("click", () => applyBulkPositions(reverseSelection(currentPositions(), [...state.bulkSelection])));
for (const button of document.querySelectorAll("[data-bulk-orientation]")) {
  button.addEventListener("click", () => rotateBulk(button.dataset.bulkOrientation));
}
byId("cut-back").addEventListener("click", () => { renderRoll(); showScreen("roll"); });
byId("roll-info-back").addEventListener("click", () => showScreen(state.returnScreen));
byId("roll-info-done").addEventListener("click", () => { renderRoll(); if (state.returnScreen === "cut") renderCut(); showScreen(state.returnScreen); });
byId("export-back").addEventListener("click", () => showScreen(state.returnScreen));
byId("contact-back").addEventListener("click", () => { renderRoll(); showScreen("roll"); });
byId("field-back").addEventListener("click", () => { const screen = state.editing?.returnScreen ?? "roll"; state.editing = null; showScreen(screen); });
byId("field-done").addEventListener("click", () => finishFieldEdit(false));
byId("field-input").addEventListener("input", updateFieldMessage);
byId("field-revert").addEventListener("click", () => {
  const editing = state.editing;
  if (!editing || editing.scope !== "cut") return;
  const item = state.items[state.currentCut];
  delete ensureCutValues(item)[editing.key];
  editing.draft = "";
  editing.hasCutValue = false;
  renderFieldEditor();
  invalidateShareSession();
});
byId("previous-cut").addEventListener("click", () => { if (state.currentCut > 0) { state.currentCut -= 1; renderCut(); window.scrollTo(0, 0); } });
byId("next-cut").addEventListener("click", () => { if (state.currentCut < state.items.length - 1) { state.currentCut += 1; renderCut(); window.scrollTo(0, 0); } });
byId("replace-scan-button").addEventListener("click", () => {
  showBulkNotice("");
  showDialog({
    title: "이 컷의 스캔을 교체할까요?",
    body: "회전·반전은 새로 맞춰야 해요.\n이전에 내보낸 파일은 그대로예요.",
    cancel: "취소",
    confirm: "교체하기",
    onCancel: () => {},
    onConfirm: () => replaceScanInput.click(),
  });
});
replaceScanInput.addEventListener("change", async () => {
  const current = state.items[state.currentCut];
  const file = replaceScanInput.files[0] ?? null;
  try {
    const staged = await stageScanReplacement(file);
    const replacement = applyScanReplacement(current, staged);
    if (!replacement.changed) return;
    state.photos[current.originalIndex] = replacement.photo;
    delete state.orientation[current.cutId];
    thumbnailCache.clear();
    invalidateShareSession();
    renderCut();
    showBulkNotice(replacement.message);
  } catch {
    renderCut();
    showBulkNotice(SCAN_REPLACEMENT_READ_FAILURE);
  } finally {
    replaceScanInput.value = "";
  }
});
for (const button of document.querySelectorAll("[data-orientation]")) {
  button.addEventListener("click", () => {
    const item = state.items[state.currentCut];
    const correction = photoCorrection(item);
    if (button.dataset.orientation === "left") correction.turns = (correction.turns + 3) % 4;
    if (button.dataset.orientation === "right") correction.turns = (correction.turns + 1) % 4;
    if (button.dataset.orientation === "flip") correction.flipped = !correction.flipped;
    state.orientation[item.cutId] = correction;
    renderCut();
  });
}
byId("dialog-cancel").addEventListener("click", () => closeDialog("cancel"));
byId("dialog-confirm").addEventListener("click", () => closeDialog("confirm"));
byId("dialog-layer").addEventListener("click", (event) => {
  if (event.target === byId("dialog-layer") && state.dialog?.dismissOnOutside) closeDialog("dismiss");
});

for (const input of document.querySelectorAll('input[name="frame-mode"]')) {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    state.mode = input.value;
    invalidateShareSession();
    updateExportControls();
    renderPreview();
  });
}

for (const button of document.querySelectorAll("[data-format]")) {
  button.addEventListener("click", () => {
    if (button.dataset.format === "webp" && state.webpSupported === false) { openAppPreview("webp"); return; }
    state.exportFormat = button.dataset.format;
    if (state.exportFormat === "png") state.exportQuality = "high";
    updateExportControls();
  });
}
for (const button of document.querySelectorAll("[data-contact-format]")) {
  button.addEventListener("click", () => {
    if (button.dataset.contactFormat === "webp" && state.webpSupported === false) { openAppPreview("webp"); return; }
    state.contactFormat = button.dataset.contactFormat;
    state.contactFile = null;
    updateContactControls();
  });
}
for (const button of document.querySelectorAll("[data-contact-quality]")) {
  button.addEventListener("click", () => { state.contactQuality = button.dataset.contactQuality; state.contactFile = null; updateContactControls(); });
}
byId("contact-header-enabled").addEventListener("change", async (event) => { state.contactHeader = event.target.checked; await renderContact(); });
byId("contact-save").addEventListener("click", async () => {
  try { await makeContactFile(true); } catch (error) { setContactResult(error.message); }
});
byId("contact-share").addEventListener("click", async () => {
  try {
    const result = state.contactFile ?? await makeContactFile(false);
    const file = new File([result.blob], result.name, { type: result.blob.type });
    if (!navigator.canShare?.({ files: [file] })) throw new Error("이 브라우저에서는 모아 보기 파일을 공유할 수 없어요. 이미지로 저장해 주세요.");
    await navigator.share({ files: [file] });
    setContactResult("");
    showBulkNotice("사진 1장을 보냈어요.");
  } catch (error) {
    setContactResult(error.name === "AbortError" ? "공유를 취소했어요." : error.message);
  }
});
for (const button of document.querySelectorAll("[data-quality]")) {
  button.addEventListener("click", () => {
    if (button.dataset.quality === "lossless") { openAppPreview("webp"); return; }
    state.exportQuality = button.dataset.quality;
    updateExportControls();
  });
}
for (const button of document.querySelectorAll("[data-digits]")) {
  button.addEventListener("click", () => { state.exportDigits = Number(button.dataset.digits); updateExportControls(); });
}
byId("roll-frame-label").addEventListener("change", (event) => {
  state.rollFrameLabel = event.target.checked;
  renderPreview();
});
byId("rgb-histogram").addEventListener("change", (event) => {
  state.rgbHistogram = event.target.checked;
  renderPreview();
});
for (const button of document.querySelectorAll("[data-ratio]")) {
  button.addEventListener("click", () => { state.paddingRatio = button.dataset.ratio; updateExportControls(); renderPreview(); });
}
byId("toggle-all-cuts").addEventListener("click", () => {
  state.exportSelection = state.exportSelection.size === state.items.length ? new Set() : new Set(state.items.map((item) => item.frame));
  renderExportCuts();
  renderPreview();
});

exportButton.addEventListener("click", async () => {
  try {
    exportButton.disabled = true;
    setExportReasons();
    const selected = currentExportItems();
    reassessUndetermined(selected);
    if (selected.some(completenessBlocksExport)) {
      throw new Error("스캔 파일을 열 수 없어 내보내지 않았어요.");
    }
    setStatus("내보낼 사진을 만들고 있어요.", false, exportStatus);
    const started = performance.now();
    const rollName = rollNameInput.value || defaultRollName();
    const output = await buildOutput();
    const archiveName = makeExportArchiveFilename(rollName);
    if (archiveName.result !== "name") throw new Error("내보낼 파일 이름을 만들지 못했어요.");
    downloadBytes(output.zip, archiveName.name);
    const elapsedMs = performance.now() - started;
    setExportReasons(output.photoOnlyFrames);
    releaseResult(state.result);
    state.result = {
      files: output.files.map((file) => ({ ...file, selected: true })),
      elapsedMs, returnScreen: state.returnScreen, delivery: "download", shared: 0,
    };
    renderResult();
    showScreen("result");
  } catch (error) {
    setStatus(error.message, true, exportStatus);
  } finally {
    updateExportControls();
  }
});

shareButton.addEventListener("click", async () => {
  try {
    shareButton.disabled = true;
    if (!state.shareSession) {
      const files = makeShareFiles(state.result.files.filter((file) => file.selected));
      const groups = groupShareFiles(files);
      if (!groups) {
        shareProgress.textContent = "이 브라우저에서는 사진 파일을 공유할 수 없어요. ZIP 내려받기를 이용해 주세요.";
        shareProgress.hidden = false;
        return;
      }
      state.shareSession = { groups, groupIndex: 0, shared: 0, total: files.length };
    }
    const session = state.shareSession;
    const files = session.groups[session.groupIndex];
    await navigator.share({ files });
    session.groupIndex += 1;
    session.shared += files.length;
    state.result.delivery = "share";
    state.result.shared = session.shared;
    showBulkNotice(`사진 ${session.shared}장을 보냈어요.`);
    const progress = `${session.total}장 중 ${session.shared}장을 넘겼어요.`;
    shareProgress.textContent = progress;
    shareProgress.hidden = false;
    if (session.groupIndex < session.groups.length) shareButton.textContent = "다음 묶음 사진첩에 저장";
    else {
      state.shareSession = null;
      shareButton.textContent = "사진첩에 다시 저장";
    }
  } catch (error) {
    shareProgress.textContent = error.name === "AbortError" ? "공유를 취소했어요." : error.message;
    shareProgress.hidden = false;
  } finally {
    updateShareAvailability();
  }
});

byId("toggle-all-results").addEventListener("click", () => {
  const select = !state.result.files.every((file) => file.selected);
  for (const file of state.result.files) file.selected = select;
  renderResult();
});
byId("result-done").addEventListener("click", () => {
  const screen = state.result?.returnScreen ?? "roll";
  releaseResult(state.result);
  state.result = null;
  invalidateShareSession();
  if (screen === "roll") renderRoll(); else renderCut();
  showScreen(screen);
});
for (const button of document.querySelectorAll("[data-app-preview]")) button.addEventListener("click", () => openAppPreview(button.dataset.appPreview));
byId("app-preview-close").addEventListener("click", () => { byId("app-preview-layer").hidden = true; });
window.addEventListener("pageshow", () => { if (state.screen === "result") updateShareAvailability(); });
window.addEventListener("pagehide", () => thumbnailCache.clear());

if (new URLSearchParams(location.search).get("demo") === "1") {
  state.photos = ["scan_1.jpg", "scan_2.jpg", "scan_10.jpg"].map((name) => ({ name, bytes: new Uint8Array() }));
  state.importFailures = [];
  state.roll = { camera: "합성 카메라", lens: "50mm", film: "합성 필름", ei: "400" };
  state.records = [
    { n: 1, ap: "f/5.6", sh: "1/250", focal: "50", ev: "+0.0" },
    { n: 2, ap: "f/2.8", sh: "1/60", focal: "50" },
    { n: 3, ap: "f/8", sh: "1/500", focal: "50", ev: "-0.5" },
  ];
  state.cutValues = [{ cutId: "scan_1.jpg", n: 1, camera: "컷 전용 카메라" }];
  renderRoll();
  showScreen("roll");
}
