const STANDARD_ISO = new Set([
  6, 8, 10, 12, 16, 20, 25, 32, 40, 50, 64, 80, 100, 125, 160, 200, 250, 320,
  400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400,
]);

const BRAND_SPELLINGS = [
  "Lomography", "Kosmo Foto", "Dubblefilm", "AgfaPhoto", "CineStill", "Reflx Lab",
  "Fujifilm", "Kentmere", "Ferrania", "Shanghai", "Polaroid", "Silberra", "Revolog",
  "Ilford", "Harman", "Rollei", "Yodica", "Kodak", "로모그래피", "Svema", "아그파포토",
  "Lucky", "폴라로이드", "리플렉스랩", "코스모포토", "Washi", "Marix", "후지필름",
  "Fuji", "Lomo", "ORWO", "켄트미어", "Foma", "Agfa", "Adox", "페라니아",
  "시네스틸", "더블필름", "리볼로그", "스베마", "오르오", "오르보", "일포드", "아그파",
  "롤라이", "아독스", "상하이", "JCH", "실베라", "요디카", "마릭스", "코닥", "후지",
  "올보", "하만", "포마", "럭키", "와시",
].sort((left, right) => right.length - left.length);

function isLatin(character) {
  return /[A-Za-z]/.test(character ?? "");
}

function isHangul(character) {
  return /[\u3131-\u318e\uac00-\ud7a3]/.test(character ?? "");
}

function sameScriptLetter(left, right) {
  return (isLatin(left) && isLatin(right)) || (isHangul(left) && isHangul(right));
}

function typedBrand(film) {
  for (let start = 0; start < film.length; start += 1) {
    for (const spelling of BRAND_SPELLINGS) {
      const candidate = film.slice(start, start + spelling.length);
      if (candidate.localeCompare(spelling, undefined, { sensitivity: "accent" }) !== 0) continue;
      const end = start + spelling.length;
      if (start > 0 && sameScriptLetter(film[start - 1], spelling[0])) continue;
      if (end < film.length && sameScriptLetter(film[end], spelling.at(-1))) continue;
      return candidate;
    }
  }
  return null;
}

export function filmSuggestion(film) {
  const text = String(film ?? "");
  const manufacturer = typedBrand(text);
  const boxIso = [...text.matchAll(/\d+/g)]
    .map((match) => Number(match[0]))
    .find((value) => STANDARD_ISO.has(value)) ?? null;
  return { manufacturer, boxIso };
}

export function lensFocalSuggestion(lens) {
  const text = String(lens ?? "");
  const matches = [...text.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*mm/gi)];
  if (!matches.length) return null;
  for (const match of matches) {
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    if (/\d\s*[-–~]\s*$/.test(before) || /^\s*[-–~]\s*\d/.test(after)) return null;
  }
  const values = [...new Set(matches.map((match) => Number(match[1])))];
  if (values.length !== 1 || values[0] <= 0 || values[0] > 2000) return null;
  return values[0];
}

function focalText(value) {
  return Number.isInteger(value) ? String(value) : String(value);
}

function numericEqual(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return String(left).trim() !== "" && String(right).trim() !== ""
    && Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber;
}

export function inputSuggestionAsk({
  previousLens = "", newLens = "", focal = "",
  previousFilm = "", newFilm = "", manufacturer = "", boxSpeed = "",
}) {
  const fills = [];
  const changes = [];
  const offer = (field, value, current, labels, equal) => {
    const shown = String(current ?? "").trim();
    if (!shown) fills.push({ field, value, ...labels });
    else if (!equal(shown, value)) changes.push({ field, value, current: shown, ...labels });
  };

  if (String(previousFilm).trim() !== String(newFilm).trim()) {
    const suggestion = filmSuggestion(newFilm);
    if (suggestion.manufacturer !== null) {
      offer("manufacturer", suggestion.manufacturer, manufacturer, { fillLabel: "제조사", changeLabel: "제조사" }, (left, right) => left === right);
    }
    if (suggestion.boxIso !== null) {
      offer("boxSpeed", String(suggestion.boxIso), boxSpeed, { fillLabel: "박스 감도", changeLabel: "박스 감도" }, numericEqual);
    }
  }
  if (String(previousLens).trim() !== String(newLens).trim()) {
    const focalValue = lensFocalSuggestion(newLens);
    if (focalValue !== null) {
      offer("focal", focalText(focalValue), focal, { fillLabel: "초점거리(mm)", changeLabel: "초점거리" }, numericEqual);
    }
  }
  if (!fills.length && !changes.length) return null;

  const fillValues = Object.fromEntries(fills.map(({ field, value }) => [field, value]));
  const changeValues = Object.fromEntries(changes.map(({ field, value }) => [field, value]));
  const title = changes.length === 0 ? "아래 값을 채울까요?" : "아래 값으로 바꿀까요?";
  const body = [
    ...fills.map(({ fillLabel, value }) => changes.length
      ? `${fillLabel} (비어 있음) → ${value}`
      : `${fillLabel}: ${value}`),
    ...changes.map(({ changeLabel, current, value }) => `${changeLabel} ${current} → ${value}`),
  ].join("\n");
  return {
    title,
    accept: changes.length ? "바꾸기" : "채우기",
    body,
    fills: fillValues,
    changes: changeValues,
  };
}

export function filmFillAsk(film, currentManufacturer = "", currentBoxSpeed = "") {
  const suggestion = filmSuggestion(film);
  const manufacturer = currentManufacturer.trim() ? null : suggestion.manufacturer;
  const boxSpeed = currentBoxSpeed.trim() || suggestion.boxIso === null ? null : String(suggestion.boxIso);
  if (manufacturer === null && boxSpeed === null) return null;
  return {
    body: [manufacturer && `제조사: ${manufacturer}`, boxSpeed && `박스 감도: ${boxSpeed}`].filter(Boolean).join("\n"),
    manufacturer,
    boxSpeed,
  };
}

export function lensFillAsk(lens, currentFocal = "") {
  if (currentFocal.trim()) return null;
  const focal = lensFocalSuggestion(lens);
  if (focal === null) return null;
  return { body: `초점거리(mm): ${focalText(focal)}`, focal: focalText(focal) };
}
