export const THUMBNAIL_MAX_EDGE = 512;
export const THUMBNAIL_CACHE_MAX_BYTES = 64 * 1024 * 1024;
export const SOURCE_DECODE_CONCURRENCY = 4;
// Measured in headless Chrome: "low" (and "pixelated") let the decoder shrink the JPEG while reading it; "medium" and
// "high" decode the whole picture first and keep it in Chrome's image cache (about 500 MiB for 78 photos).
const DECODE_RESIZE_QUALITY = "low";

function disposeEntry(entry, closeBitmap, revokeObjectURL) {
  if (entry.bitmap) closeBitmap(entry.bitmap);
  if (entry.objectUrl) revokeObjectURL(entry.objectUrl);
}

export class ThumbnailBitmapCache {
  constructor({
    maxBytes = THUMBNAIL_CACHE_MAX_BYTES,
    closeBitmap = (bitmap) => bitmap.close(),
    revokeObjectURL = (url) => URL.revokeObjectURL(url),
  } = {}) {
    this.maxBytes = maxBytes;
    this.closeBitmap = closeBitmap;
    this.revokeObjectURL = revokeObjectURL;
    this.entries = new Map();
    this.byteSize = 0;
  }

  async get(key, load) {
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.promise;
    }

    const entry = { bitmap: null, byteSize: 0, objectUrl: null, promise: null };
    entry.promise = Promise.resolve().then(load).then((loaded) => {
      if (this.entries.get(key) !== entry) {
        disposeEntry(loaded, this.closeBitmap, this.revokeObjectURL);
        throw new Error("미리보기 캐시가 바뀌었어요.");
      }
      entry.bitmap = loaded.bitmap;
      entry.byteSize = loaded.byteSize;
      entry.objectUrl = loaded.objectUrl ?? null;
      entry.sourceWidth = loaded.sourceWidth;
      entry.sourceHeight = loaded.sourceHeight;
      this.byteSize += entry.byteSize;
      this.evictToLimit(key);
      return entry;
    }).catch((error) => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, entry);
    return entry.promise;
  }

  evictToLimit(protectedKey) {
    for (const [key, entry] of this.entries) {
      if (this.byteSize <= this.maxBytes) break;
      if (key === protectedKey || !entry.bitmap) continue;
      this.entries.delete(key);
      this.byteSize -= entry.byteSize;
      disposeEntry(entry, this.closeBitmap, this.revokeObjectURL);
    }
  }

  clear() {
    const entries = [...this.entries.values()];
    this.entries.clear();
    this.byteSize = 0;
    for (const entry of entries) {
      if (entry.bitmap) disposeEntry(entry, this.closeBitmap, this.revokeObjectURL);
    }
  }
}

/** At most `limit` source photos are decoded at the same time; the rest wait their turn in order. */
export class DecodeLimiter {
  constructor(limit = SOURCE_DECODE_CONCURRENCY) {
    this.limit = limit;
    this.active = 0;
    this.waiting = [];
    this.peak = 0;
  }

  async run(task) {
    if (this.active >= this.limit) await new Promise((resolve) => this.waiting.push(resolve));
    else this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next(); // the slot is handed straight to the next waiter
      else this.active -= 1;
    }
  }
}

export const sourceDecodeLimiter = new DecodeLimiter();

const resizeSupport = new WeakMap();

/**
 * Feature detection (not a user-agent check): ask the browser to decode a 2x2 canvas at 1x1. A browser that
 * ignores the resize options returns a 2x2 bitmap, and then thumbnails take the older decode-then-shrink path.
 */
export function supportsDecodeResize(createBitmap) {
  if (!resizeSupport.has(createBitmap)) {
    resizeSupport.set(createBitmap, (async () => {
      try {
        const probe = document.createElement("canvas");
        probe.width = 2;
        probe.height = 2;
        const bitmap = await createBitmap(probe, { resizeWidth: 1, resizeQuality: DECODE_RESIZE_QUALITY });
        const supported = bitmap.width === 1;
        bitmap.close?.();
        probe.width = probe.height = 0;
        return supported;
      } catch {
        return false;
      }
    })());
  }
  return resizeSupport.get(createBitmap);
}

/**
 * Shrinks while decoding when the browser can (`createImageBitmap` resize options), so the full-size picture is
 * never turned into pixels. `dimensions` is the picture's width/height as shown (after the EXIF turn); without it,
 * or without browser support, it decodes full size and shrinks afterwards. `blob` may be a function that makes the
 * Blob, which then runs only once this photo has its decode slot.
 */
export async function makeThumbnailBitmap(blob, {
  maxEdge = THUMBNAIL_MAX_EDGE,
  createBitmap = (...args) => createImageBitmap(...args),
  dimensions = null,
  limiter = sourceDecodeLimiter,
} = {}) {
  const resizeAtDecode = dimensions?.width > 0 && dimensions?.height > 0 && await supportsDecodeResize(createBitmap);
  return limiter.run(async () => {
    const input = typeof blob === "function" ? blob() : blob;
    if (resizeAtDecode) {
      const longEdge = Math.max(dimensions.width, dimensions.height);
      if (longEdge <= maxEdge) {
        const bitmap = await createBitmap(input, { imageOrientation: "from-image" });
        return { bitmap, byteSize: bitmap.width * bitmap.height * 4, sourceWidth: bitmap.width, sourceHeight: bitmap.height };
      }
      // One side only: the browser keeps the picture's proportions, so a wrong guess can never stretch it.
      const sizing = dimensions.width >= dimensions.height ? { resizeWidth: maxEdge } : { resizeHeight: maxEdge };
      const bitmap = await createBitmap(input, { imageOrientation: "from-image", resizeQuality: DECODE_RESIZE_QUALITY, ...sizing });
      return { bitmap, byteSize: bitmap.width * bitmap.height * 4, sourceWidth: bitmap.width, sourceHeight: bitmap.height };
    }
    return decodeFullThenShrink(input, maxEdge, createBitmap);
  });
}

async function decodeFullThenShrink(blob, maxEdge, createBitmap) {
  const source = await createBitmap(blob, { imageOrientation: "from-image" });
  const scale = Math.min(maxEdge / Math.max(source.width, source.height), 1);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  if (width === source.width && height === source.height) {
    return {
      bitmap: source,
      byteSize: width * height * 4,
      sourceWidth: source.width,
      sourceHeight: source.height,
    };
  }
  try {
    const bitmap = await createBitmap(source, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
    return {
      bitmap,
      byteSize: width * height * 4,
      sourceWidth: source.width,
      sourceHeight: source.height,
    };
  } finally {
    source.close();
  }
}

export async function renderCachedThumbnail({ cache, key, load, canvas, maximum, correction }) {
  const entry = await cache.get(key, load);
  const sideways = Math.abs(correction.turns) % 2 === 1;
  const sourceWidth = sideways ? entry.sourceHeight : entry.sourceWidth;
  const sourceHeight = sideways ? entry.sourceWidth : entry.sourceHeight;
  const scale = Math.min(maximum / sourceWidth, maximum / sourceHeight, 1);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.translate(width / 2, height / 2);
  context.scale(correction.flipped ? -1 : 1, 1);
  context.rotate(correction.turns * Math.PI / 2);
  const drawWidth = sideways ? height : width;
  const drawHeight = sideways ? width : height;
  context.drawImage(entry.bitmap, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  return { width, height };
}
