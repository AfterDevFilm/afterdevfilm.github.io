import WebpModule from "../vendor/wasm-webp-0.1.0/webp-wasm.js";

let modulePromise;

self.addEventListener("message", async ({ data }) => {
  const { id, operation } = data ?? {};
  try {
    if (operation === "init") {
      if (modulePromise) throw new Error("already initialized");
      modulePromise = WebpModule({ wasmBinary: data.wasmBytes });
      await modulePromise;
      self.postMessage({ id, ok: true });
      return;
    }
    if (operation === "encode" && modulePromise) {
      const module = await modulePromise;
      const encoded = await module.encode(data.rgba, data.width, data.height, true, {
        quality: data.quality,
        lossless: data.lossless ? 1 : 0,
      });
      const bytes = Uint8Array.from(encoded);
      self.postMessage({ id, ok: true, bytes: bytes.buffer }, [bytes.buffer]);
      return;
    }
    throw new Error("not initialized");
  } catch {
    self.postMessage({ id, ok: false });
  }
});
