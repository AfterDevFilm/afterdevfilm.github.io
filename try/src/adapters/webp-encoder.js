const WEBP_ERROR_MESSAGE = "이 브라우저에서는 WebP를 만들 수 없어요.";
const WASM_SHA256 = "4d438a73dfe550d608d6b89eee34ea9374d58d3ffa0355218766281fc9a76c22";
const WASM_URL = new URL("../vendor/wasm-webp-0.1.0/webp-wasm.wasm", import.meta.url);
const WORKER_URL = new URL("./webp-encoder.worker.js", import.meta.url);

let clientPromise;
let verifiedWasm;
let verifiedWasmPromise;
let nextRequestId = 0;

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function verifiedWasmBytes() {
  if (verifiedWasm) return verifiedWasm;
  if (!verifiedWasmPromise) {
    verifiedWasmPromise = (async () => {
      const response = await fetch(WASM_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(WEBP_ERROR_MESSAGE);
      const bytes = await response.arrayBuffer();
      const actual = hex(await crypto.subtle.digest("SHA-256", bytes));
      if (actual !== WASM_SHA256) throw new Error(WEBP_ERROR_MESSAGE);
      return bytes;
    })();
  }
  const pendingWasm = verifiedWasmPromise;
  try {
    verifiedWasm = await pendingWasm;
    return verifiedWasm;
  } catch (error) {
    if (verifiedWasmPromise === pendingWasm) verifiedWasmPromise = undefined;
    throw error;
  }
}

function makeClient(worker) {
  const pending = new Map();
  let terminated = false;
  const rejectPending = () => {
    for (const { reject } of pending.values()) reject(new Error(WEBP_ERROR_MESSAGE));
    pending.clear();
  };
  worker.addEventListener("error", rejectPending);
  worker.addEventListener("messageerror", rejectPending);
  worker.addEventListener("message", ({ data }) => {
    const request = pending.get(data?.id);
    if (!request) return;
    pending.delete(data.id);
    if (!data.ok) request.reject(new Error(WEBP_ERROR_MESSAGE));
    else request.resolve(data);
  });
  return {
    request(message, transfers = []) {
      const id = ++nextRequestId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          worker.postMessage({ id, ...message }, transfers);
        } catch {
          pending.delete(id);
          reject(new Error(WEBP_ERROR_MESSAGE));
        }
      });
    },
    terminate() {
      if (terminated) return;
      terminated = true;
      rejectPending();
      worker.terminate();
    },
  };
}

function releaseEncoderClient() {
  const pendingClient = clientPromise;
  clientPromise = undefined;
  if (pendingClient) void pendingClient.then((client) => client.terminate(), () => {});
}

async function encoderClient() {
  if (!clientPromise) {
    const pendingClient = (async () => {
      const wasmBytes = (await verifiedWasmBytes()).slice(0);
      const worker = new Worker(WORKER_URL, { type: "module" });
      const client = makeClient(worker);
      try {
        await client.request({ operation: "init", wasmBytes }, [wasmBytes]);
        return client;
      } catch (error) {
        client.terminate();
        throw error;
      }
    })();
    clientPromise = pendingClient;
    try {
      return await pendingClient;
    } catch (error) {
      if (clientPromise === pendingClient) clientPromise = undefined;
      throw error;
    }
  }
  return clientPromise;
}

export async function webpEncoderReady() {
  try {
    await encoderClient();
    return true;
  } catch {
    releaseEncoderClient();
    return false;
  }
}

export async function encodeWebp(rgba, width, height, { quality = 0.85, lossless = false } = {}) {
  if (!(rgba instanceof Uint8ClampedArray)
      || !Number.isInteger(width) || width <= 0
      || !Number.isInteger(height) || height <= 0
      || rgba.length !== width * height * 4
      || !Number.isFinite(quality)) {
    throw new Error(WEBP_ERROR_MESSAGE);
  }
  const workerBytes = new Uint8ClampedArray(rgba);
  const normalizedQuality = Math.max(0, Math.min(100, quality <= 1 ? quality * 100 : quality));
  try {
    const client = await encoderClient();
    const response = await client.request({
      operation: "encode",
      rgba: workerBytes,
      width,
      height,
      quality: normalizedQuality,
      lossless: Boolean(lossless),
    }, [workerBytes.buffer]);
    return new Uint8Array(response.bytes);
  } catch {
    throw new Error(WEBP_ERROR_MESSAGE);
  }
}

export function releaseWebpEncoder() {
  releaseEncoderClient();
}
