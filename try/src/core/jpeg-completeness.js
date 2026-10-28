// Byte-only JPEG Scan completeness judgement, ported from the Android/iOS assessors at app ee2e05d8.
// No pixels or coefficient magnitudes are retained. Progressive state is capped at 64 MiB.

export const JPEG_COMPLETENESS = Object.freeze({
  COMPLETE: "COMPLETE",
  INCOMPLETE: "INCOMPLETE",
  NOT_JPEG: "NOT_JPEG",
  UNDETERMINED: "UNDETERMINED",
});

export const MAX_PROGRESSIVE_STATE_BYTES = 64 * 1024 * 1024;

const EOF = -1;
const SHORT = -2;

class Source {
  constructor(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError("JPEG bytes must be a Uint8Array");
    this.bytes = bytes;
    this.position = 0;
  }

  read() {
    return this.position < this.bytes.length ? this.bytes[this.position++] : EOF;
  }

  readFully(count) {
    if (count < 0 || this.position + count > this.bytes.length) return null;
    const value = this.bytes.subarray(this.position, this.position + count);
    this.position += count;
    return value;
  }
}

class HuffmanTable {
  constructor(counts, symbols) {
    this.symbols = symbols;
    this.minCode = new Int32Array(17);
    this.maxCode = new Int32Array(18);
    this.maxCode.fill(-1);
    this.valuePointer = new Int32Array(17);
    let code = 0;
    let symbolIndex = 0;
    for (let length = 1; length <= 16; length += 1) {
      this.valuePointer[length] = symbolIndex;
      this.minCode[length] = code;
      code += counts[length - 1];
      symbolIndex += counts[length - 1];
      this.maxCode[length] = counts[length - 1] === 0 ? -1 : code - 1;
      code <<= 1;
    }
  }
}

class Bits {
  constructor(source) {
    this.source = source;
    this.current = 0;
    this.count = 0;
    this.marker = 0;
  }

  reset() {
    this.current = 0;
    this.count = 0;
  }

  bit() {
    if (this.count === 0) {
      if (this.marker !== 0) return EOF;
      let byte = this.source.read();
      if (byte < 0) {
        this.marker = EOF;
        return EOF;
      }
      if (byte === 0xff) {
        let next = this.source.read();
        while (next === 0xff) next = this.source.read();
        if (next < 0) {
          this.marker = EOF;
          return EOF;
        }
        if (next === 0x00) byte = 0xff;
        else {
          this.marker = next;
          return EOF;
        }
      }
      this.current = byte;
      this.count = 8;
    }
    this.count -= 1;
    return (this.current >> this.count) & 1;
  }

  skipToMarker() {
    let skipped = 0;
    this.count = 0;
    if (this.marker !== 0) return 0;
    while (true) {
      const byte = this.source.read();
      if (byte < 0) {
        this.marker = EOF;
        return skipped;
      }
      if (byte !== 0xff) {
        skipped += 1;
        continue;
      }
      let next = this.source.read();
      while (next === 0xff) next = this.source.read();
      if (next < 0) {
        this.marker = EOF;
        return skipped;
      }
      if (next === 0x00) {
        skipped += 2;
        continue;
      }
      this.marker = next;
      return skipped;
    }
  }

  consumeMarker() {
    const marker = this.marker;
    this.marker = 0;
    return marker;
  }

  expectRestart(expected = null) {
    this.count = 0;
    if (this.marker === 0) this.skipToMarker();
    const matches = expected === null
      ? this.marker >= 0xd0 && this.marker <= 0xd7
      : this.marker === 0xd0 + (expected & 7);
    if (matches) this.marker = 0;
    return matches;
  }
}

function ceilDiv(value, divisor) {
  return Math.floor((value + divisor - 1) / divisor);
}

function progressiveState(frame) {
  let bytes = 0;
  const byId = new Map();
  for (const component of frame.components) {
    const paddedWidth = frame.mcuColumns * component.h;
    const paddedHeight = frame.mcuRows * component.v;
    const blocks = paddedWidth * paddedHeight;
    if (!Number.isSafeInteger(blocks) || blocks > Math.floor((MAX_PROGRESSIVE_STATE_BYTES - bytes) / 8)) return null;
    bytes += blocks * 8;
    const coverage = new Int8Array(64);
    coverage.fill(-1);
    byId.set(component.id, {
      component,
      paddedWidth,
      actualWidth: ceilDiv(frame.width * component.h, frame.hMax * 8),
      nonzero: new BigUint64Array(blocks),
      coverage,
    });
  }
  return { byId };
}

class Walker {
  constructor(bytes) {
    this.source = new Source(bytes);
    this.bits = new Bits(this.source);
    this.dcTables = Array(4).fill(null);
    this.acTables = Array(4).fill(null);
    this.frame = null;
    this.progressive = null;
    this.restartInterval = 0;
    this.scans = 0;
    this.allVerified = true;
    this.supplied = new Set();
  }

  assessment(result, reason = null, entropyVerified = false) {
    return { result, reason, entropyVerified };
  }

  incomplete(reason) {
    return this.assessment(JPEG_COMPLETENESS.INCOMPLETE, reason, false);
  }

  run() {
    if (this.source.read() !== 0xff || this.source.read() !== 0xd8) {
      return this.assessment(JPEG_COMPLETENESS.NOT_JPEG);
    }
    let pendingMarker = 0;
    while (true) {
      const marker = pendingMarker !== 0 ? pendingMarker : this.nextMarker();
      pendingMarker = 0;
      if (marker < 0) return this.incomplete("ENDED_BEFORE_EOI");
      if (marker === 0xd9) {
        if (this.scans === 0) return this.incomplete("NO_SCAN");
        if (this.missingComponents()) return this.incomplete("COMPONENT_NOT_SUPPLIED");
        if (this.missingProgressiveCoverage()) return this.incomplete("PROGRESSIVE_COVERAGE_INCOMPLETE");
        return this.assessment(JPEG_COMPLETENESS.COMPLETE, null, this.allVerified && this.scans > 0);
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8) || marker === 0x00 || marker === 0xff) continue;
      const length = this.readLength();
      if (length === null) return this.incomplete("ENDED_BEFORE_EOI");
      const payload = this.source.readFully(length - 2);
      if (payload === null) return this.incomplete("ENDED_BEFORE_EOI");
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) this.parseFrame(marker, payload);
      else if (marker === 0xc4) this.parseHuffman(payload);
      else if (marker === 0xdd && payload.length >= 2) this.restartInterval = (payload[0] << 8) | payload[1];
      else if (marker === 0xda) {
        this.scans += 1;
        const next = this.scan(payload);
        if (next === EOF) return this.incomplete("ENDED_BEFORE_EOI");
        if (next === SHORT) return this.incomplete("ENTROPY_SHORT");
        pendingMarker = next;
      } else if ((marker === 0xc3 || (marker >= 0xc5 && marker <= 0xcf)) && marker !== 0xc8 && marker !== 0xcc) {
        this.frame = null;
        this.progressive = null;
        this.allVerified = false;
      }
    }
  }

  nextMarker() {
    while (true) {
      let byte = this.source.read();
      if (byte < 0) return EOF;
      if (byte !== 0xff) continue;
      byte = this.source.read();
      while (byte === 0xff) byte = this.source.read();
      if (byte < 0) return EOF;
      if (byte !== 0x00) return byte;
    }
  }

  readLength() {
    const high = this.source.read();
    const low = this.source.read();
    if (high < 0 || low < 0) return null;
    return Math.max(2, (high << 8) | low);
  }

  parseFrame(marker, payload) {
    if (payload.length < 6) {
      this.frame = null;
      this.progressive = null;
      this.allVerified = false;
      return;
    }
    const precision = payload[0];
    const height = (payload[1] << 8) | payload[2];
    const width = (payload[3] << 8) | payload[4];
    const count = payload[5];
    if (count === 0 || payload.length < 6 + 3 * count) {
      this.frame = null;
      this.progressive = null;
      this.allVerified = false;
      return;
    }
    const components = Array.from({ length: count }, (_, index) => {
      const sampling = payload[7 + index * 3];
      return { id: payload[6 + index * 3], h: Math.max(1, sampling >> 4), v: Math.max(1, sampling & 15) };
    });
    const hMax = Math.max(...components.map((component) => component.h));
    const vMax = Math.max(...components.map((component) => component.v));
    const sequentialHuffman = marker !== 0xc2 && precision === 8 && height > 0 && width > 0;
    const progressiveHuffman = marker === 0xc2 && precision === 8 && height > 0 && width > 0;
    this.frame = {
      precision, height, width, components, hMax, vMax, sequentialHuffman, progressiveHuffman,
      mcuColumns: ceilDiv(width, 8 * hMax),
      mcuRows: ceilDiv(height, 8 * vMax),
    };
    this.progressive = progressiveHuffman ? progressiveState(this.frame) : null;
    if (progressiveHuffman && this.progressive === null) this.allVerified = false;
    this.supplied.clear();
  }

  parseHuffman(payload) {
    let offset = 0;
    while (offset + 17 <= payload.length) {
      const tableClass = payload[offset] >> 4;
      const tableId = payload[offset] & 15;
      const counts = payload.subarray(offset + 1, offset + 17);
      const total = counts.reduce((sum, value) => sum + value, 0);
      if (offset + 17 + total > payload.length || tableId > 3 || tableClass > 1) return;
      const table = new HuffmanTable(counts, payload.slice(offset + 17, offset + 17 + total));
      if (tableClass === 0) this.dcTables[tableId] = table;
      else this.acTables[tableId] = table;
      offset += 17 + total;
    }
  }

  scan(header) {
    this.bits.reset();
    const frame = this.frame;
    if (frame?.progressiveHuffman) {
      if (this.progressive === null) {
        this.allVerified = false;
        this.bits.skipToMarker();
        return this.bits.consumeMarker();
      }
      return this.scanProgressive(frame, this.progressive, header);
    }
    if (!frame?.sequentialHuffman || !this.verifiableScan(frame, header)) {
      this.allVerified = false;
      this.bits.skipToMarker();
      return this.bits.consumeMarker();
    }
    const scanComponentCount = header[0];
    const components = [];
    for (let index = 0; index < scanComponentCount; index += 1) {
      const id = header[1 + index * 2];
      const selectors = header[2 + index * 2];
      components.push({
        component: frame.components.find((candidate) => candidate.id === id),
        dc: this.dcTables[selectors >> 4],
        ac: this.acTables[selectors & 15],
      });
    }
    if (components.some((entry) => !entry.component || !entry.dc || !entry.ac)) {
      this.allVerified = false;
      this.bits.skipToMarker();
      return this.bits.consumeMarker();
    }
    const mcuCount = this.geometry(frame, components.map((entry) => entry.component));
    let sinceRestart = 0;
    for (let mcu = 0; mcu < mcuCount; mcu += 1) {
      if (this.restartInterval > 0 && sinceRestart === this.restartInterval) {
        if (!this.bits.expectRestart()) return this.shortOrEof();
        sinceRestart = 0;
      }
      for (const entry of components) {
        const blocks = scanComponentCount > 1 ? entry.component.h * entry.component.v : 1;
        for (let block = 0; block < blocks; block += 1) {
          if (!this.decodeBlock(entry.dc, entry.ac)) return this.shortOrEof();
        }
      }
      sinceRestart += 1;
    }
    for (const entry of components) this.supplied.add(entry.component.id);
    this.bits.skipToMarker();
    return this.bits.consumeMarker();
  }

  scanProgressive(frame, state, header) {
    if (header.length === 0) return SHORT;
    const scanComponentCount = header[0];
    if (scanComponentCount < 1 || scanComponentCount > 4 || header.length < 1 + scanComponentCount * 2 + 3) return SHORT;
    const ss = header[1 + scanComponentCount * 2];
    const se = header[2 + scanComponentCount * 2];
    const approximation = header[3 + scanComponentCount * 2];
    const ah = approximation >> 4;
    const al = approximation & 15;
    const isDc = ss === 0 && se === 0;
    if ((!isDc && (scanComponentCount !== 1 || ss < 1 || ss > 63 || se < ss || se > 63)) || (isDc && (ss !== 0 || se !== 0))) return SHORT;
    if (ah !== 0 && ah !== al + 1) return SHORT;

    const components = [];
    for (let index = 0; index < scanComponentCount; index += 1) {
      const id = header[1 + index * 2];
      const selectors = header[2 + index * 2];
      if ((selectors >> 4) > 3 || (selectors & 15) > 3) return SHORT;
      const componentState = state.byId.get(id);
      if (!componentState) return SHORT;
      components.push({ state: componentState, dc: this.dcTables[selectors >> 4], ac: this.acTables[selectors & 15] });
    }
    for (const entry of components) {
      for (let coefficient = ss; coefficient <= se; coefficient += 1) {
        if (ah === 0 ? entry.state.coverage[coefficient] !== -1 : entry.state.coverage[coefficient] !== ah) return SHORT;
      }
    }
    if (isDc && ah === 0 && components.some((entry) => !entry.dc)) return SHORT;
    if (!isDc && components.some((entry) => !entry.ac)) return SHORT;

    const mcuCount = this.geometry(frame, components.map((entry) => entry.state.component));
    let sinceRestart = 0;
    let expectedRestart = 0;
    let eobRun = 0;
    for (let mcu = 0; mcu < mcuCount; mcu += 1) {
      if (this.restartInterval > 0 && sinceRestart === this.restartInterval) {
        if (eobRun !== 0 || !this.bits.expectRestart(expectedRestart)) return this.shortOrEof();
        expectedRestart = (expectedRestart + 1) & 7;
        sinceRestart = 0;
      }
      for (const entry of components) {
        const component = entry.state.component;
        const blocks = scanComponentCount > 1 ? component.h * component.v : 1;
        for (let block = 0; block < blocks; block += 1) {
          const blockIndex = this.progressiveBlockIndex(frame, entry.state, scanComponentCount, mcu, block);
          const mask = entry.state.nonzero[blockIndex];
          let decoded;
          if (isDc && ah === 0) decoded = this.decodeDcFirst(entry.dc, mask);
          else if (isDc) decoded = this.decodeDcRefine(mask);
          else if (ah === 0) decoded = this.decodeAcFirst(entry.ac, mask, ss, se, eobRun);
          else decoded = this.decodeAcRefine(entry.ac, mask, ss, se, eobRun);
          if (decoded === null) return this.shortOrEof();
          entry.state.nonzero[blockIndex] = decoded.mask;
          eobRun = decoded.eobRun;
        }
      }
      sinceRestart += 1;
    }
    if (eobRun !== 0) return SHORT;
    for (const entry of components) {
      for (let coefficient = ss; coefficient <= se; coefficient += 1) entry.state.coverage[coefficient] = al;
    }
    this.bits.skipToMarker();
    return this.bits.consumeMarker();
  }

  progressiveBlockIndex(frame, state, scanComponentCount, mcu, block) {
    if (scanComponentCount === 1) return Math.floor(mcu / state.actualWidth) * state.paddedWidth + (mcu % state.actualWidth);
    const mcuX = mcu % frame.mcuColumns;
    const mcuY = Math.floor(mcu / frame.mcuColumns);
    const blockX = block % state.component.h;
    const blockY = Math.floor(block / state.component.h);
    return (mcuY * state.component.v + blockY) * state.paddedWidth + mcuX * state.component.h + blockX;
  }

  decodeDcFirst(table, mask) {
    const size = this.decodeSymbol(table);
    if (size < 0 || size > 15 || !this.skipBits(size)) return null;
    return { mask: size === 0 ? mask : mask | 1n, eobRun: 0 };
  }

  decodeDcRefine(mask) {
    const bit = this.bits.bit();
    return bit < 0 ? null : { mask: bit === 0 ? mask : mask | 1n, eobRun: 0 };
  }

  decodeAcFirst(table, initialMask, ss, se, initialEobRun) {
    let mask = initialMask;
    let eobRun = initialEobRun;
    if (eobRun > 0) return { mask, eobRun: eobRun - 1 };
    let coefficient = ss;
    while (coefficient <= se) {
      const rs = this.decodeSymbol(table);
      if (rs < 0) return null;
      const run = rs >> 4;
      const size = rs & 15;
      if (size === 0) {
        if (run === 15) {
          coefficient += 16;
          if (coefficient > se + 1) return null;
          continue;
        }
        const extra = this.readBits(run);
        if (extra === null) return null;
        eobRun = (1 << run) + extra - 1;
        return { mask, eobRun };
      }
      if (size < 1 || size > 15) return null;
      coefficient += run;
      if (coefficient > se || this.readBits(size) === null) return null;
      mask |= 1n << BigInt(coefficient);
      coefficient += 1;
    }
    return { mask, eobRun };
  }

  decodeAcRefine(table, initialMask, ss, se, initialEobRun) {
    let mask = initialMask;
    let eobRun = initialEobRun;
    let coefficient = ss;
    if (eobRun === 0) {
      while (coefficient <= se) {
        const rs = this.decodeSymbol(table);
        if (rs < 0) return null;
        let run = rs >> 4;
        const size = rs & 15;
        let newCoefficient = false;
        if (size === 0) {
          if (run < 15) {
            const extra = this.readBits(run);
            if (extra === null) return null;
            eobRun = (1 << run) + extra;
            break;
          }
        } else {
          if (size !== 1 || this.bits.bit() < 0) return null;
          newCoefficient = true;
        }
        let reachedTargetZero = false;
        while (coefficient <= se) {
          if ((mask & (1n << BigInt(coefficient))) !== 0n) {
            if (this.bits.bit() < 0) return null;
          } else {
            run -= 1;
            if (run < 0) {
              reachedTargetZero = true;
              break;
            }
          }
          coefficient += 1;
        }
        if (!reachedTargetZero) return null;
        if (newCoefficient) mask |= 1n << BigInt(coefficient);
        coefficient += 1;
      }
    }
    if (eobRun > 0) {
      while (coefficient <= se) {
        if ((mask & (1n << BigInt(coefficient))) !== 0n && this.bits.bit() < 0) return null;
        coefficient += 1;
      }
      eobRun -= 1;
    }
    return { mask, eobRun };
  }

  missingComponents() {
    return Boolean(this.frame?.sequentialHuffman && this.allVerified
      && this.frame.components.some((component) => !this.supplied.has(component.id)));
  }

  missingProgressiveCoverage() {
    if (!this.frame?.progressiveHuffman || !this.allVerified || !this.progressive) return false;
    return [...this.progressive.byId.values()].some((entry) => entry.coverage.some((value) => value !== 0));
  }

  verifiableScan(frame, header) {
    if (header.length === 0) return false;
    const count = header[0];
    if (count < 1 || count > 4 || header.length < 1 + count * 2 + 3) return false;
    if (header[1 + count * 2] !== 0 || header[2 + count * 2] !== 63 || header[3 + count * 2] !== 0) return false;
    for (let index = 0; index < count; index += 1) {
      if (!frame.components.some((component) => component.id === header[1 + index * 2])) return false;
    }
    return true;
  }

  geometry(frame, scanComponents) {
    if (scanComponents.length === 1) {
      const component = scanComponents[0];
      const width = ceilDiv(frame.width * component.h, frame.hMax);
      const height = ceilDiv(frame.height * component.v, frame.vMax);
      return ceilDiv(width, 8) * ceilDiv(height, 8);
    }
    return ceilDiv(frame.width, 8 * frame.hMax) * ceilDiv(frame.height, 8 * frame.vMax);
  }

  decodeBlock(dc, ac) {
    const dcSize = this.decodeSymbol(dc);
    if (dcSize < 0 || (dcSize > 0 && !this.skipBits(dcSize))) return false;
    let coefficient = 1;
    while (coefficient < 64) {
      const rs = this.decodeSymbol(ac);
      if (rs < 0) return false;
      const run = rs >> 4;
      const size = rs & 15;
      if (size !== 0) {
        coefficient += run;
        if (!this.skipBits(size)) return false;
        coefficient += 1;
      } else {
        if (run !== 15) break;
        coefficient += 16;
      }
    }
    return true;
  }

  decodeSymbol(table) {
    let code = this.bits.bit();
    if (code < 0) return EOF;
    let length = 1;
    while (code > table.maxCode[length]) {
      length += 1;
      if (length > 16) return EOF;
      const bit = this.bits.bit();
      if (bit < 0) return EOF;
      code = (code << 1) | bit;
    }
    const index = table.valuePointer[length] + code - table.minCode[length];
    return index >= 0 && index < table.symbols.length ? table.symbols[index] : EOF;
  }

  readBits(count) {
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      const bit = this.bits.bit();
      if (bit < 0) return null;
      value = (value << 1) | bit;
    }
    return value;
  }

  skipBits(count) {
    for (let index = 0; index < count; index += 1) if (this.bits.bit() < 0) return false;
    return true;
  }

  shortOrEof() {
    return this.bits.marker === EOF ? EOF : SHORT;
  }
}

export function assessJpegCompleteness(bytes) {
  return new Walker(bytes).run();
}

export function judgeJpegCompleteness(bytes) {
  const assessment = assessJpegCompleteness(bytes);
  return {
    ...assessment,
    state: assessment.result === JPEG_COMPLETENESS.COMPLETE && !assessment.entropyVerified
      ? JPEG_COMPLETENESS.UNDETERMINED
      : assessment.result,
  };
}
