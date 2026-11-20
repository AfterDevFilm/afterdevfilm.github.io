const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function canShareFiles(navigatorObject, files) {
  try {
    return navigatorObject.canShare({ files });
  } catch {
    return false;
  }
}

export function supportsJpegFileShare(navigatorObject = globalThis.navigator, FileClass = globalThis.File) {
  if (typeof navigatorObject?.share !== "function" || typeof navigatorObject?.canShare !== "function" || !FileClass) return false;
  const probe = new FileClass([JPEG_BYTES], "photo.jpg", { type: "image/jpeg" });
  return canShareFiles(navigatorObject, [probe]);
}

export function makeJpegShareFiles(files, FileClass = globalThis.File) {
  if (!FileClass) throw new Error("이 브라우저에서는 사진 파일을 공유할 수 없어요.");
  return files.map((file) => {
    if (!/\.jpe?g$/i.test(file.name)) throw new Error("JPEG 사진만 사진첩으로 넘길 수 있어요. ZIP으로 저장해 주세요.");
    return new FileClass([file.blob ?? file.bytes], file.name, { type: "image/jpeg" });
  });
}

export function makeShareFiles(files, FileClass = globalThis.File) {
  if (!FileClass) throw new Error("이 브라우저에서는 사진 파일을 공유할 수 없어요.");
  return files.map((file) => {
    const type = file.type ?? (/\.webp$/i.test(file.name) ? "image/webp" : /\.png$/i.test(file.name) ? "image/png" : "image/jpeg");
    return new FileClass([file.blob ?? file.bytes], file.name, { type });
  });
}

export function groupShareFiles(files, navigatorObject = globalThis.navigator) {
  const groups = [];
  let offset = 0;
  while (offset < files.length) {
    let count = files.length - offset;
    while (count > 0 && !canShareFiles(navigatorObject, files.slice(offset, offset + count))) count -= 1;
    if (count === 0) return null;
    groups.push(files.slice(offset, offset + count));
    offset += count;
  }
  return groups;
}
