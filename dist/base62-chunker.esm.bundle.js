// src/base62.js
var ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
var LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
var RADIX = 62n;
var LOG2_BASE62 = Math.log2(62);
var CHAR_VALUE = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i += 1) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();
function encodeNumber(value, width) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`Expected non-negative integer, got ${value}`);
  }
  let acc = value;
  const chars = new Array(width);
  for (let i = width - 1; i >= 0; i -= 1) {
    chars[i] = ALPHABET[acc % 62];
    acc = Math.floor(acc / 62);
  }
  if (acc > 0) {
    throw new RangeError(`Value ${value} does not fit into ${width} base62 characters`);
  }
  return chars.join("");
}
function decodeNumber(str) {
  let acc = 0;
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    const value = code < 128 ? CHAR_VALUE[code] : -1;
    if (value < 0) {
      throw new Error(`Invalid base62 character: ${JSON.stringify(str[i])}`);
    }
    acc = acc * 62 + value;
  }
  return acc;
}
function bytesToBase62(bytes) {
  if (bytes.length === 0) return "";
  let acc = 0n;
  for (let i = 0; i < bytes.length; i += 1) {
    acc = acc << 8n | BigInt(bytes[i]);
  }
  let out = "";
  while (acc > 0n) {
    out = ALPHABET[Number(acc % RADIX)] + out;
    acc /= RADIX;
  }
  return out;
}
function base62ToBytes(str, expectedLength) {
  let acc = 0n;
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    const value = code < 128 ? CHAR_VALUE[code] : -1;
    if (value < 0) {
      throw new Error(`Invalid base62 character: ${JSON.stringify(str[i])}`);
    }
    acc = acc * RADIX + BigInt(value);
  }
  const bytes = [];
  while (acc > 0n) {
    bytes.unshift(Number(acc & 0xffn));
    acc >>= 8n;
  }
  while (bytes.length < expectedLength) {
    bytes.unshift(0);
  }
  if (bytes.length !== expectedLength) {
    throw new Error(`Byte count mismatch: expected ${expectedLength}, got ${bytes.length}`);
  }
  return Uint8Array.from(bytes);
}
function randomChars(alphabet, count) {
  const n = alphabet.length;
  const limit = Math.floor(256 / n) * n;
  const out = [];
  const batch = new Uint8Array(Math.max(16, count * 2));
  while (out.length < count) {
    globalThis.crypto.getRandomValues(batch);
    for (let i = 0; i < batch.length && out.length < count; i += 1) {
      if (batch[i] < limit) {
        out.push(alphabet[batch[i] % n]);
      }
    }
  }
  return out;
}
function randomBase62(length, firstCharAlphabet = ALPHABET) {
  if (length === 0) return "";
  const first = randomChars(firstCharAlphabet, 1)[0];
  return first + randomChars(ALPHABET, length - 1).join("");
}

// src/config.js
var LAYOUT = Object.freeze({
  indexLength: 3,
  totalLength: 3,
  countLength: 2
});
var CHECKSUM_LENGTHS = Object.freeze({
  none: 0,
  crc8: 2,
  crc16: 3
});
function resolveConfig(partial = {}) {
  const sessionLength = partial.sessionLength ?? 6;
  if (!Number.isInteger(sessionLength) || sessionLength < 4 || sessionLength > 8) {
    throw new RangeError(
      `sessionLength must be an integer in [4, 8], got ${sessionLength}`
    );
  }
  const checksum = partial.checksum ?? "crc16";
  if (checksum !== "none" && checksum !== "crc8" && checksum !== "crc16") {
    throw new RangeError(
      `checksum must be "none", "crc8", or "crc16", got ${JSON.stringify(checksum)}`
    );
  }
  const crcLength = CHECKSUM_LENGTHS[checksum];
  const metaLength = sessionLength + LAYOUT.indexLength + LAYOUT.totalLength + LAYOUT.countLength + crcLength;
  return Object.freeze({
    sessionLength,
    checksum,
    crcLength,
    indexLength: LAYOUT.indexLength,
    totalLength: LAYOUT.totalLength,
    countLength: LAYOUT.countLength,
    metaLength,
    maxIndex: 62 ** LAYOUT.indexLength - 1,
    maxTotal: 62 ** LAYOUT.totalLength - 1,
    maxByteCount: 62 ** LAYOUT.countLength - 1
  });
}
var DEFAULT_CONFIG = resolveConfig();

// src/crc.js
var CRC16_TABLE = (() => {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i << 8;
    for (let j = 0; j < 8; j += 1) {
      crc = crc & 32768 ? crc << 1 ^ 4129 : crc << 1;
    }
    table[i] = crc & 65535;
  }
  return table;
})();
var CRC8_TABLE = (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let j = 0; j < 8; j += 1) {
      crc = crc & 1 ? crc >>> 1 ^ 140 : crc >>> 1;
    }
    table[i] = crc;
  }
  return table;
})();
function crc16(bytes) {
  let crc = 65535;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc << 8 ^ CRC16_TABLE[(crc >> 8 ^ bytes[i]) & 255]) & 65535;
  }
  return crc;
}
function crc8(bytes) {
  let crc = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC8_TABLE[crc ^ bytes[i]];
  }
  return crc;
}
function computeChecksum(bytes, algorithm) {
  if (algorithm === "crc16") return crc16(bytes);
  if (algorithm === "crc8") return crc8(bytes);
  throw new Error(`Unknown checksum algorithm: ${algorithm}`);
}

// src/chunk.js
function validateSessionId(sessionId, config = DEFAULT_CONFIG) {
  if (typeof sessionId !== "string" || sessionId.length !== config.sessionLength) {
    throw new RangeError(`sessionId must be a ${config.sessionLength}-character string`);
  }
  if (!/^[0-9A-Za-z]+$/.test(sessionId)) {
    throw new RangeError("sessionId must contain only base62 characters");
  }
  if (!/^[A-Za-z]/.test(sessionId)) {
    throw new RangeError("sessionId must start with a letter (A-Z, a-z)");
  }
}
function parseHeader(line, config = DEFAULT_CONFIG) {
  if (typeof line !== "string") {
    throw new TypeError("line must be a string");
  }
  if (line.length < config.metaLength) {
    throw new Error(`Line is shorter than the metadata header (${config.metaLength})`);
  }
  if (!/^[0-9A-Za-z]+$/.test(line)) {
    throw new Error("Line contains non-base62 characters");
  }
  if (!/^[A-Za-z]/.test(line)) {
    throw new Error("Line must start with a letter (A-Z, a-z)");
  }
  let pos = 0;
  const session = line.slice(pos, pos += config.sessionLength);
  const index = decodeNumber(line.slice(pos, pos += config.indexLength));
  const total = decodeNumber(line.slice(pos, pos += config.totalLength));
  const byteCount = decodeNumber(line.slice(pos, pos += config.countLength));
  const checksumValue = config.crcLength > 0 ? decodeNumber(line.slice(pos, pos += config.crcLength)) : 0;
  if (total < 1) {
    throw new Error(`Invalid total (${total}); must be >= 1`);
  }
  if (index >= total) {
    throw new Error(`Chunk index (${index}) is out of range [0, ${total})`);
  }
  return { session, index, total, byteCount, checksumValue };
}
function parseChunk(line, config = DEFAULT_CONFIG) {
  const { session, index, total, byteCount, checksumValue } = parseHeader(line, config);
  const bytes = base62ToBytes(line.slice(config.metaLength), byteCount);
  if (config.checksum !== "none") {
    const actual = computeChecksum(bytes, config.checksum);
    if (actual !== checksumValue) {
      throw new Error(`Checksum mismatch: expected ${checksumValue}, got ${actual}`);
    }
  }
  return { session, index, total, bytes };
}
function formatChunk(chunk, config = DEFAULT_CONFIG) {
  if (!chunk || typeof chunk !== "object") {
    throw new TypeError("chunk must be an object");
  }
  const { session, index, total, bytes } = chunk;
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("chunk.bytes must be a Uint8Array");
  }
  validateSessionId(session, config);
  if (!Number.isInteger(index) || index < 0 || index > config.maxIndex) {
    throw new RangeError(`index must be in [0, ${config.maxIndex}], got ${index}`);
  }
  if (!Number.isInteger(total) || total < 1 || total > config.maxTotal) {
    throw new RangeError(`total must be in [1, ${config.maxTotal}], got ${total}`);
  }
  if (index >= total) {
    throw new RangeError(`index (${index}) must be less than total (${total})`);
  }
  if (bytes.length > config.maxByteCount) {
    throw new RangeError(
      `bytes.length (${bytes.length}) exceeds the ${config.maxByteCount}-byte limit`
    );
  }
  const checksumValue = config.checksum !== "none" ? computeChecksum(bytes, config.checksum) : 0;
  const header = session + encodeNumber(index, config.indexLength) + encodeNumber(total, config.totalLength) + encodeNumber(bytes.length, config.countLength) + (config.crcLength > 0 ? encodeNumber(checksumValue, config.crcLength) : "");
  return header + bytesToBase62(bytes);
}

// src/decode.js
function joinChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new TypeError("Expected a non-empty array of chunks");
  }
  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i];
    if (!c || typeof c !== "object") {
      throw new TypeError(`Chunk ${i} is not an object`);
    }
    if (!(c.bytes instanceof Uint8Array)) {
      throw new TypeError(`Chunk ${i}.bytes is not a Uint8Array`);
    }
  }
  const { session, total } = chunks[0];
  for (const c of chunks) {
    if (c.session !== session) throw new Error("Session id mismatch");
    if (c.total !== total) throw new Error("Total chunks mismatch");
  }
  if (chunks.length !== total) {
    throw new Error(`Expected ${total} chunks, received ${chunks.length}`);
  }
  const sorted = [...chunks].sort((a, b) => a.index - b.index);
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i].index !== i) {
      throw new Error(`Missing chunk with index ${i}`);
    }
  }
  let totalLen = 0;
  for (const c of sorted) totalLen += c.bytes.length;
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of sorted) {
    out.set(c.bytes, offset);
    offset += c.bytes.length;
  }
  return new TextDecoder().decode(out);
}
function chunksFromLines(lines, config = DEFAULT_CONFIG) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new TypeError("Expected a non-empty array of lines");
  }
  return lines.map((line) => parseChunk(line, config));
}
function decodeText(lines, options = {}) {
  const config = options.config ? resolveConfig(options.config) : DEFAULT_CONFIG;
  return joinChunks(chunksFromLines(lines, config));
}

// src/encode.js
function generateSessionId(config = DEFAULT_CONFIG) {
  return randomBase62(config.sessionLength, LETTERS);
}
function resolveSessionId(sessionId, config) {
  if (sessionId === void 0) return generateSessionId(config);
  validateSessionId(sessionId, config);
  return sessionId;
}
function resolveBytesPerChunk({ maxLen = 63, bytesPerChunk }, config) {
  if (bytesPerChunk !== void 0) {
    if (!Number.isInteger(bytesPerChunk) || bytesPerChunk < 1) {
      throw new RangeError("bytesPerChunk must be a positive integer");
    }
    if (bytesPerChunk > config.maxByteCount) {
      throw new RangeError(
        `bytesPerChunk (${bytesPerChunk}) exceeds the ${config.maxByteCount}-byte limit`
      );
    }
    return bytesPerChunk;
  }
  if (!Number.isInteger(maxLen)) {
    throw new TypeError("maxLen must be an integer");
  }
  if (maxLen <= config.metaLength) {
    throw new RangeError(
      `maxLen (${maxLen}) must be greater than META_LEN (${config.metaLength})`
    );
  }
  const payloadChars = maxLen - config.metaLength;
  const n = Math.floor(payloadChars * LOG2_BASE62 / 8);
  if (n < 1) {
    throw new RangeError(`maxLen (${maxLen}) is too small for any payload`);
  }
  if (n > config.maxByteCount) {
    throw new RangeError(
      `maxLen (${maxLen}) is too large: ${n} bytes/chunk exceeds ${config.maxByteCount}`
    );
  }
  return n;
}
function splitText(text, options = {}) {
  if (typeof text !== "string") {
    throw new TypeError("text must be a string");
  }
  const config = options.config ? resolveConfig(options.config) : DEFAULT_CONFIG;
  const bytesPerChunk = resolveBytesPerChunk(options, config);
  const session = resolveSessionId(options.sessionId, config);
  const allBytes = new TextEncoder().encode(text);
  const total = allBytes.length === 0 ? 1 : Math.ceil(allBytes.length / bytesPerChunk);
  if (total > config.maxTotal) {
    throw new RangeError(`Text too large: ${total} chunks exceed the ${config.maxTotal} limit`);
  }
  const chunks = [];
  for (let i = 0; i < total; i += 1) {
    const start = i * bytesPerChunk;
    const end = Math.min(start + bytesPerChunk, allBytes.length);
    chunks.push({
      session,
      index: i,
      total,
      bytes: allBytes.slice(start, end)
    });
  }
  return chunks;
}
function encodeText(text, options = {}) {
  const config = options.config ? resolveConfig(options.config) : DEFAULT_CONFIG;
  return splitText(text, { ...options, config }).map((c) => formatChunk(c, config));
}

// src/analyze.js
function mode(values) {
  if (values.length === 0) return null;
  const counts = /* @__PURE__ */ new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let bestCount = 0;
  let best = null;
  let tie = false;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = value;
      tie = false;
    } else if (count === bestCount) {
      tie = true;
    }
  }
  return tie ? null : best;
}
var SESSION_PREFIX_RE = /^[A-Za-z][0-9A-Za-z]*$/;
function analyzeLines(lines, options = {}) {
  if (!Array.isArray(lines)) {
    throw new TypeError("Expected an array of lines");
  }
  const config = options.config ? resolveConfig(options.config) : DEFAULT_CONFIG;
  const malformed = [];
  const buckets = /* @__PURE__ */ new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (typeof line !== "string" || line.length < config.sessionLength) {
      malformed.push({ line: i, reason: "line is too short or not a string" });
      continue;
    }
    const sessionId = line.slice(0, config.sessionLength);
    if (!SESSION_PREFIX_RE.test(sessionId)) {
      malformed.push({ line: i, reason: "invalid session prefix" });
      continue;
    }
    let bucket = buckets.get(sessionId);
    if (!bucket) {
      bucket = { sessionId, chunks: [], errors: [] };
      buckets.set(sessionId, bucket);
    }
    try {
      bucket.chunks.push(parseChunk(line, config));
    } catch (err) {
      bucket.errors.push({
        line: i,
        reason: err instanceof Error ? err.message : String(err)
      });
    }
  }
  const sessions = [];
  for (const bucket of buckets.values()) {
    const expectedTotal = mode(bucket.chunks.map((c) => c.total));
    const indexCount = /* @__PURE__ */ new Map();
    for (const chunk of bucket.chunks) {
      indexCount.set(chunk.index, (indexCount.get(chunk.index) ?? 0) + 1);
    }
    const present = [...indexCount.keys()].sort((a, b) => a - b);
    const duplicates = present.filter((idx) => (indexCount.get(idx) ?? 0) > 1);
    const missing = [];
    if (expectedTotal !== null) {
      for (let idx = 0; idx < expectedTotal; idx += 1) {
        if (!indexCount.has(idx)) missing.push(idx);
      }
    }
    const totalMismatch = expectedTotal === null || bucket.chunks.some((c) => c.total !== expectedTotal);
    const complete = bucket.errors.length === 0 && !totalMismatch && missing.length === 0 && duplicates.length === 0 && bucket.chunks.length === expectedTotal;
    sessions.push({
      sessionId: bucket.sessionId,
      complete,
      expectedTotal,
      totalMismatch,
      chunks: [...bucket.chunks].sort((a, b) => a.index - b.index),
      present,
      missing,
      duplicates,
      errors: bucket.errors
    });
  }
  sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  const ok = malformed.length === 0 && sessions.every((s) => s.complete);
  return { ok, sessions, malformed };
}
function completeSessions(report) {
  return report.sessions.filter((s) => s.complete);
}
function incompleteSessions(report) {
  return report.sessions.filter((s) => !s.complete);
}
function analyzeItems(items, options) {
  if (!Array.isArray(items)) {
    throw new TypeError("Expected an array of items");
  }
  const { getLine, config: userConfig } = options;
  if (typeof getLine !== "function") {
    throw new TypeError("getLine must be a function");
  }
  const config = userConfig ? resolveConfig(userConfig) : DEFAULT_CONFIG;
  const malformed = [];
  const buckets = /* @__PURE__ */ new Map();
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    let line;
    try {
      line = getLine(item, i);
    } catch (err) {
      malformed.push({
        item,
        line: i,
        reason: `getLine threw: ${err instanceof Error ? err.message : String(err)}`
      });
      continue;
    }
    if (typeof line !== "string" || line.length < config.sessionLength) {
      malformed.push({
        item,
        line: i,
        reason: "line is too short or not a string"
      });
      continue;
    }
    const sessionId = line.slice(0, config.sessionLength);
    if (!SESSION_PREFIX_RE.test(sessionId)) {
      malformed.push({ item, line: i, reason: "invalid session prefix" });
      continue;
    }
    let bucket = buckets.get(sessionId);
    if (!bucket) {
      bucket = { sessionId, entries: [], errors: [] };
      buckets.set(sessionId, bucket);
    }
    try {
      const chunk = parseChunk(line, config);
      bucket.entries.push({ chunk, item });
    } catch (err) {
      bucket.errors.push({
        item,
        line: i,
        reason: err instanceof Error ? err.message : String(err)
      });
    }
  }
  const sessions = [];
  for (const bucket of buckets.values()) {
    const chunksArr = bucket.entries.map((e) => e.chunk);
    const expectedTotal = mode(chunksArr.map((c) => c.total));
    const indexCount = /* @__PURE__ */ new Map();
    for (const c of chunksArr) {
      indexCount.set(c.index, (indexCount.get(c.index) ?? 0) + 1);
    }
    const present = [...indexCount.keys()].sort((a, b) => a - b);
    const duplicates = present.filter((idx) => (indexCount.get(idx) ?? 0) > 1);
    const missing = [];
    if (expectedTotal !== null) {
      for (let idx = 0; idx < expectedTotal; idx += 1) {
        if (!indexCount.has(idx)) missing.push(idx);
      }
    }
    const totalMismatch = expectedTotal === null || chunksArr.some((c) => c.total !== expectedTotal);
    const complete = bucket.errors.length === 0 && !totalMismatch && missing.length === 0 && duplicates.length === 0 && chunksArr.length === expectedTotal;
    const sorted = [...bucket.entries].sort((a, b) => a.chunk.index - b.chunk.index);
    sessions.push({
      sessionId: bucket.sessionId,
      complete,
      expectedTotal,
      totalMismatch,
      chunks: sorted.map((e) => e.chunk),
      items: sorted.map((e) => e.item),
      present,
      missing,
      duplicates,
      errors: bucket.errors
    });
  }
  sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  const ok = malformed.length === 0 && sessions.every((s) => s.complete);
  return { ok, sessions, malformed };
}

// src/codec.js
function createCodec(config = {}) {
  const resolved = resolveConfig(config);
  return {
    config: resolved,
    metaLen: resolved.metaLength,
    encodeText: (text, options = {}) => encodeText(text, { ...options, config: resolved }),
    decodeText: (lines) => decodeText(lines, { config: resolved }),
    splitText: (text, options = {}) => splitText(text, { ...options, config: resolved }),
    joinChunks,
    parseChunk: (line) => parseChunk(line, resolved),
    formatChunk: (chunk) => formatChunk(chunk, resolved),
    chunksFromLines: (lines) => chunksFromLines(lines, resolved),
    analyzeLines: (lines) => analyzeLines(lines, { config: resolved }),
    analyzeItems: (items, options) => analyzeItems(items, { ...options, config: resolved }),
    completeSessions,
    incompleteSessions,
    generateSessionId: () => generateSessionId(resolved)
  };
}
export {
  ALPHABET,
  DEFAULT_CONFIG,
  analyzeItems,
  analyzeLines,
  chunksFromLines,
  completeSessions,
  createCodec,
  decodeText,
  encodeText,
  formatChunk,
  generateSessionId,
  incompleteSessions,
  joinChunks,
  parseChunk,
  resolveConfig,
  splitText
};
