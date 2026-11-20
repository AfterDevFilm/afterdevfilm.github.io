export function decodeTemplateBytes(bytes) {
  for (const encoding of ["utf-8", "euc-kr"]) {
    try {
      return { state: "READ", text: new TextDecoder(encoding, { fatal: true }).decode(bytes), encoding };
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  return { state: "UNREADABLE", text: null, encoding: null };
}
