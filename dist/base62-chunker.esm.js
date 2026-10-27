// @ts-check

/**
 * Base62 alphabet: digits, uppercase, lowercase. Every string produced by
 * this package consists only of these 62 characters, so output is safe for
 * transports that restrict payloads to `[0-9A-Za-z]`.
 * @public
 */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Letters-only alphabet: `A-Z` then `a-z`. Used as the first-character
 * source for session ids, so that encoded lines never begin with a digit.
 * @internal
 */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Radix used by all base62 conversions. @internal */
const RADIX = 62n;

/** log2(62) — converts base62 character capacity into byte capacity. @internal */
const LOG2_BASE62 = Math.log2(62);

/**
 * Reverse lookup: ASCII code -> base62 digit, or -1 for invalid bytes.
 * Built once at module load.
 * @internal
 * @type {Int8Array}
 */
const CHAR_VALUE = (() => {
    const table = new Int8Array(128).fill(-1);
    for (let i = 0; i < ALPHABET.length; i += 1) {
        table[ALPHABET.charCodeAt(i)] = i;
    }
    return table;
})();

/**
 * Encode a non-negative integer into a fixed-width base62 string.
 * Zero-padded on the left.
 *
 * @internal
 * @param {number} value  Non-negative safe integer.
 * @param {number} width  Exact output length in characters.
 * @returns {string}
 * @throws {RangeError} If `value` does not fit into `width` base62 digits.
 */
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
    return chars.join('');
}

/**
 * Decode a base62 string into a non-negative integer.
 *
 * @internal
 * @param {string} str
 * @returns {number}
 * @throws {Error} If `str` contains characters outside the base62 alphabet.
 */
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

/**
 * Encode a byte array as a base62 string using a big-endian bigint.
 *
 * Leading zero bytes are *not* preserved — the caller must know the original
 * byte count and restore the zeros after decoding. An empty array encodes
 * to an empty string.
 *
 * @internal
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBase62(bytes) {
    if (bytes.length === 0) return '';
    let acc = 0n;
    for (let i = 0; i < bytes.length; i += 1) {
        acc = (acc << 8n) | BigInt(bytes[i]);
    }
    let out = '';
    while (acc > 0n) {
        out = ALPHABET[Number(acc % RADIX)] + out;
        acc /= RADIX;
    }
    return out;
}

/**
 * Decode a base62 string into exactly `expectedLength` bytes.
 *
 * Leading zero bytes dropped during encoding are restored automatically.
 *
 * @internal
 * @param {string} str
 * @param {number} expectedLength  Number of bytes to restore.
 * @returns {Uint8Array}
 * @throws {Error} On invalid characters or byte-count mismatch.
 */
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
    /** @type {number[]} */
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

/**
 * Draw `count` uniformly random characters from `alphabet`.
 *
 * Uses `crypto.getRandomValues` with rejection sampling: bytes at or above
 * `floor(256 / n) * n` are discarded, so every character is drawn with
 * probability `1 / n` (no modulo bias).
 *
 * @internal
 * @param {string} alphabet
 * @param {number} count
 * @returns {string[]}
 */
function randomChars(alphabet, count) {
    const n = alphabet.length;
    const limit = Math.floor(256 / n) * n;
    /** @type {string[]} */
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

/**
 * Generate a cryptographically random string of `length` characters.
 *
 * Without a `firstCharAlphabet` argument, every character comes from the
 * base62 alphabet. When `firstCharAlphabet` is provided, the first
 * character is drawn from it instead — this is used to make session ids
 * start with a letter, so encoded lines never begin with a digit.
 *
 * @internal
 * @param {number} length
 * @param {string} [firstCharAlphabet]
 * @returns {string}
 */
function randomBase62(length, firstCharAlphabet = ALPHABET) {
    if (length === 0) return '';
    const first = randomChars(firstCharAlphabet, 1)[0];
    return first + randomChars(ALPHABET, length - 1).join('');
}

// @ts-check

/**
 * Layout widths of the metadata header. Fixed at 3/3/2 so the wire format
 * stays stable across configs; only `sessionLength` and `checksum` are
 * caller-configurable.
 * @internal
 */
const LAYOUT = Object.freeze({
  indexLength: 3,
  totalLength: 3,
  countLength: 2,
});

/**
 * How many base62 characters each checksum algorithm needs.
 * @internal
 * @type {Readonly<Record<"none" | "crc8" | "crc16", number>>}
 */
const CHECKSUM_LENGTHS = Object.freeze({
  none: 0,
  crc8: 2,
  crc16: 3,
});

/**
 * Resolve a possibly-partial config into a frozen, fully-specified one.
 * All layout widths are filled in; derived values (`crcLength`,
 * `metaLength`, `maxIndex`, `maxTotal`, `maxByteCount`) are computed once.
 *
 * @public
 * @param {import("./types.js").ChunkConfig} [partial]
 * @returns {import("./types.js").ResolvedConfig}
 * @throws {RangeError} If `sessionLength` or `checksum` are out of range.
 */
function resolveConfig(partial = {}) {
  const sessionLength = partial.sessionLength ?? 6;
  if (
    !Number.isInteger(sessionLength) ||
    sessionLength < 4 ||
    sessionLength > 8
  ) {
    throw new RangeError(
      `sessionLength must be an integer in [4, 8], got ${sessionLength}`,
    );
  }

  const checksum = partial.checksum ?? "crc16";
  if (checksum !== "none" && checksum !== "crc8" && checksum !== "crc16") {
    throw new RangeError(
      `checksum must be "none", "crc8", or "crc16", got ${JSON.stringify(checksum)}`,
    );
  }

  const crcLength = CHECKSUM_LENGTHS[checksum];

  const metaLength =
    sessionLength +
    LAYOUT.indexLength +
    LAYOUT.totalLength +
    LAYOUT.countLength +
    crcLength;

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
    maxByteCount: 62 ** LAYOUT.countLength - 1,
  });
}

/**
 * Default configuration: 6-char session, CRC16, 17-char header.
 * @public
 */
const DEFAULT_CONFIG = resolveConfig();

// @ts-check

/**
 * CRC16-CCITT (poly 0x1021, init 0xFFFF). Standard for short messages —
 * detects all single/double-bit errors, all odd-bit errors, and bursts up
 * to 16 bits.
 * @internal
 */
const CRC16_TABLE = (() => {
    const table = new Uint16Array(256);
    for (let i = 0; i < 256; i += 1) {
        let crc = i << 8;
        for (let j = 0; j < 8; j += 1) {
            crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
        }
        table[i] = crc & 0xffff;
    }
    return table;
})();

/**
 * CRC-8/MAXIM-DOW table (reflected).
 *
 * Parameters: poly=0x31, init=0x00, refin=true, refout=true, xorout=0x00.
 * The reflected polynomial is 0x8C (0x31 with bits reversed), so the LFSR
 * shifts right and XORs with 0x8C on the low bit. `check` for
 * "123456789" is 0xA1.
 *
 * @internal
 */
const CRC8_TABLE = (() => {
    const table = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) {
        let crc = i;
        for (let j = 0; j < 8; j += 1) {
            crc = crc & 1 ? (crc >>> 1) ^ 0x8c : crc >>> 1;
        }
        table[i] = crc;
    }
    return table;
})();

/**
 * Compute CRC16-CCITT of `bytes`.
 * @internal
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function crc16(bytes) {
    let crc = 0xffff;
    for (let i = 0; i < bytes.length; i += 1) {
        crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ bytes[i]) & 0xff]) & 0xffff;
    }
    return crc;
}

/**
 * Compute CRC-8/MAXIM-DOW of `bytes`.
 * @internal
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function crc8(bytes) {
    let crc = 0;
    for (let i = 0; i < bytes.length; i += 1) {
        crc = CRC8_TABLE[crc ^ bytes[i]];
    }
    return crc;
}

/**
 * Dispatch by algorithm name.
 * @internal
 * @param {Uint8Array} bytes
 * @param {"crc8" | "crc16"} algorithm
 * @returns {number}
 */
function computeChecksum(bytes, algorithm) {
    if (algorithm === 'crc16') return crc16(bytes);
    if (algorithm === 'crc8') return crc8(bytes);
    throw new Error(`Unknown checksum algorithm: ${algorithm}`);
}

// @ts-check


/**
 * Validate a session id against the resolved config.
 *
 * A valid session id must be exactly `config.sessionLength` base62
 * characters long and start with a letter — this guarantees that the
 * encoded line never begins with a digit.
 *
 * @internal
 * @param {string} sessionId
 * @param {import("./types.js").ResolvedConfig} [config]
 * @returns {void}
 * @throws {RangeError} If the length, the alphabet, or the first character
 *                      are wrong.
 */
function validateSessionId(sessionId, config = DEFAULT_CONFIG) {
    if (typeof sessionId !== 'string' || sessionId.length !== config.sessionLength) {
        throw new RangeError(`sessionId must be a ${config.sessionLength}-character string`);
    }
    if (!/^[0-9A-Za-z]+$/.test(sessionId)) {
        throw new RangeError('sessionId must contain only base62 characters');
    }
    if (!/^[A-Za-z]/.test(sessionId)) {
        throw new RangeError('sessionId must start with a letter (A-Z, a-z)');
    }
}

/**
 * Parsed metadata header of an encoded line. Internal helper — not part of
 * the public API.
 * @internal
 * @typedef {object} ChunkHeader
 * @property {string} session
 * @property {number} index
 * @property {number} total
 * @property {number} byteCount
 * @property {number} checksumValue
 */

/**
 * Parse only the metadata header of a line.
 * @internal
 * @param {string} line
 * @param {import("./types.js").ResolvedConfig} [config]
 * @returns {ChunkHeader}
 */
function parseHeader(line, config = DEFAULT_CONFIG) {
    if (typeof line !== 'string') {
        throw new TypeError('line must be a string');
    }
    if (line.length < config.metaLength) {
        throw new Error(`Line is shorter than the metadata header (${config.metaLength})`);
    }
    if (!/^[0-9A-Za-z]+$/.test(line)) {
        throw new Error('Line contains non-base62 characters');
    }
    if (!/^[A-Za-z]/.test(line)) {
        throw new Error('Line must start with a letter (A-Z, a-z)');
    }

    let pos = 0;
    const session = line.slice(pos, (pos += config.sessionLength));
    const index = decodeNumber(line.slice(pos, (pos += config.indexLength)));
    const total = decodeNumber(line.slice(pos, (pos += config.totalLength)));
    const byteCount = decodeNumber(line.slice(pos, (pos += config.countLength)));
    const checksumValue =
        config.crcLength > 0 ? decodeNumber(line.slice(pos, (pos += config.crcLength))) : 0;

    if (total < 1) {
        throw new Error(`Invalid total (${total}); must be >= 1`);
    }
    if (index >= total) {
        throw new Error(`Chunk index (${index}) is out of range [0, ${total})`);
    }
    return { session, index, total, byteCount, checksumValue };
}

/**
 * Parse one encoded line into a chunk. Validates the checksum according to
 * `config.checksum` and throws on mismatch.
 *
 * @public
 * @param {string} line
 * @param {import("./types.js").ResolvedConfig} [config]
 * @returns {import("./types.js").Chunk}
 * @throws {TypeError | Error}
 */
function parseChunk(line, config = DEFAULT_CONFIG) {
    const { session, index, total, byteCount, checksumValue } = parseHeader(line, config);
    const bytes = base62ToBytes(line.slice(config.metaLength), byteCount);

    if (config.checksum !== 'none') {
        const actual = computeChecksum(bytes, config.checksum);
        if (actual !== checksumValue) {
            throw new Error(`Checksum mismatch: expected ${checksumValue}, got ${actual}`);
        }
    }

    return { session, index, total, bytes };
}

/**
 * Serialize a chunk into a single base62 line, appending the checksum
 * required by `config.checksum`.
 *
 * @public
 * @param {import("./types.js").Chunk} chunk
 * @param {import("./types.js").ResolvedConfig} [config]
 * @returns {string}
 * @throws {TypeError | RangeError}
 */
function formatChunk(chunk, config = DEFAULT_CONFIG) {
    if (!chunk || typeof chunk !== 'object') {
        throw new TypeError('chunk must be an object');
    }
    const { session, index, total, bytes } = chunk;
    if (!(bytes instanceof Uint8Array)) {
        throw new TypeError('chunk.bytes must be a Uint8Array');
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

    const checksumValue = config.checksum !== 'none' ? computeChecksum(bytes, config.checksum) : 0;

    const header =
        session +
        encodeNumber(index, config.indexLength) +
        encodeNumber(total, config.totalLength) +
        encodeNumber(bytes.length, config.countLength) +
        (config.crcLength > 0 ? encodeNumber(checksumValue, config.crcLength) : '');

    return header + bytesToBase62(bytes);
}

// @ts-check


/**
 * Reassemble the original text from an unordered array of chunks.
 *
 * @public
 * @param {import("./types.js").Chunk[]} chunks
 * @returns {string}
 * @throws {TypeError | Error}
 */
function joinChunks(chunks) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
        throw new TypeError('Expected a non-empty array of chunks');
    }

    for (let i = 0; i < chunks.length; i += 1) {
        const c = chunks[i];
        if (!c || typeof c !== 'object') {
            throw new TypeError(`Chunk ${i} is not an object`);
        }
        if (!(c.bytes instanceof Uint8Array)) {
            throw new TypeError(`Chunk ${i}.bytes is not a Uint8Array`);
        }
    }

    const { session, total } = chunks[0];
    for (const c of chunks) {
        if (c.session !== session) throw new Error('Session id mismatch');
        if (c.total !== total) throw new Error('Total chunks mismatch');
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

/**
 * Parse lines into chunks. Throws on the first malformed line.
 *
 * @public
 * @param {string[]} lines
 * @param {import("./types.js").ResolvedConfig} [config]
 * @returns {import("./types.js").Chunk[]}
 */
function chunksFromLines(lines, config = DEFAULT_CONFIG) {
    if (!Array.isArray(lines) || lines.length === 0) {
        throw new TypeError('Expected a non-empty array of lines');
    }
    return lines.map(line => parseChunk(line, config));
}

/**
 * Decode encoded lines back to the original text.
 *
 * @public
 * @param {string[]} lines
 * @param {import("./types.js").DecodeOptions} [options]
 * @returns {string}
 */
function decodeText(lines, options = {}) {
    const config = options.config ? resolveConfig(options.config) : DEFAULT_CONFIG;
    return joinChunks(chunksFromLines(lines, config));
}

// @ts-check


/**
 * Generate a fresh base62 session id of `config.sessionLength` characters.
 *
 * The first character is always a letter (`A-Z` or `a-z`), so encoded
 * lines never start with a digit. Every remaining character is drawn from
 * the full base62 alphabet.
 *
 * @public
 * @param {import("./types.js").ResolvedConfig} [config]
 * @returns {string}
 */
function generateSessionId(config = DEFAULT_CONFIG) {
    return randomBase62(config.sessionLength, LETTERS);
}

/**
 * Validate or generate the session id for a payload.
 *
 * @internal
 * @param {string | undefined} sessionId
 * @param {import("./types.js").ResolvedConfig} config
 * @returns {string}
 * @throws {RangeError} If `sessionId` is supplied but does not match
 *                      `config.sessionLength` or the base62 alphabet.
 */
function resolveSessionId(sessionId, config) {
    if (sessionId === undefined) return generateSessionId(config);
    validateSessionId(sessionId, config);
    return sessionId;
}

/**
 * @internal
 * @param {import("./types.js").EncodeOptions} options
 * @param {import("./types.js").ResolvedConfig} config
 * @returns {number}
 */
function resolveBytesPerChunk({ maxLen = 63, bytesPerChunk }, config) {
    if (bytesPerChunk !== undefined) {
        if (!Number.isInteger(bytesPerChunk) || bytesPerChunk < 1) {
            throw new RangeError('bytesPerChunk must be a positive integer');
        }
        if (bytesPerChunk > config.maxByteCount) {
            throw new RangeError(
                `bytesPerChunk (${bytesPerChunk}) exceeds the ${config.maxByteCount}-byte limit`
            );
        }
        return bytesPerChunk;
    }
    if (!Number.isInteger(maxLen)) {
        throw new TypeError('maxLen must be an integer');
    }
    if (maxLen <= config.metaLength) {
        throw new RangeError(
            `maxLen (${maxLen}) must be greater than META_LEN (${config.metaLength})`
        );
    }
    const payloadChars = maxLen - config.metaLength;
    const n = Math.floor((payloadChars * LOG2_BASE62) / 8);
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

/**
 * Split plain text into an array of chunk structures.
 *
 * @public
 * @param {string} text
 * @param {import("./types.js").EncodeOptions} [options]
 * @returns {import("./types.js").Chunk[]}
 * @throws {TypeError | RangeError}
 */
function splitText(text, options = {}) {
    if (typeof text !== 'string') {
        throw new TypeError('text must be a string');
    }
    const config = options.config ? resolveConfig(options.config) : DEFAULT_CONFIG;
    const bytesPerChunk = resolveBytesPerChunk(options, config);
    const session = resolveSessionId(options.sessionId, config);

    const allBytes = new TextEncoder().encode(text);
    const total = allBytes.length === 0 ? 1 : Math.ceil(allBytes.length / bytesPerChunk);
    if (total > config.maxTotal) {
        throw new RangeError(`Text too large: ${total} chunks exceed the ${config.maxTotal} limit`);
    }

    /** @type {import("./types.js").Chunk[]} */
    const chunks = [];
    for (let i = 0; i < total; i += 1) {
        const start = i * bytesPerChunk;
        const end = Math.min(start + bytesPerChunk, allBytes.length);
        chunks.push({
            session,
            index: i,
            total,
            bytes: allBytes.slice(start, end),
        });
    }
    return chunks;
}

/**
 * Split text into an array of base62-only lines.
 * Convenience wrapper around `splitText(...).map(formatChunk)`.
 *
 * @public
 * @param {string} text
 * @param {import("./types.js").EncodeOptions} [options]
 * @returns {string[]}
 */
function encodeText(text, options = {}) {
    const config = options.config ? resolveConfig(options.config) : DEFAULT_CONFIG;
    return splitText(text, { ...options, config }).map(c => formatChunk(c, config));
}

// @ts-check


/**
 * Most-frequent value in `values`. Returns `null` for empty input or a tied
 * vote.
 * @internal
 * @param {number[]} values
 * @returns {number | null}
 */
function mode(values) {
    if (values.length === 0) return null;
    /** @type {Map<number, number>} */
    const counts = new Map();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    let bestCount = 0;
    /** @type {number | null} */
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

/**
 * A session id must start with a letter (A-Z, a-z) and consist only of
 * base62 characters. This guarantees that encoded lines never begin with
 * a digit. Both `analyzeLines` and `analyzeItems` use this exact regex —
 * they must not diverge.
 * @internal
 */
const SESSION_PREFIX_RE = /^[A-Za-z][0-9A-Za-z]*$/;

/**
 * Accumulator for one session during a single `analyzeLines` pass.
 * @internal
 * @typedef {object} Bucket
 * @property {string} sessionId
 * @property {import("./types.js").Chunk[]} chunks
 * @property {import("./types.js").ChunkIssue[]} errors
 */

/**
 * Analyze an array of encoded lines, grouping by session and reporting
 * completeness per session.
 *
 * Never throws on malformed input: bad lines, missing chunks, duplicates,
 * total mismatches, and checksum failures are surfaced in the returned
 * report. Only a non-array `lines` argument raises `TypeError`.
 *
 * @public
 * @param {string[]} lines
 * @param {import("./types.js").AnalyzeOptions} [options]
 * @returns {import("./types.js").AnalysisResult}
 * @throws {TypeError} If `lines` is not an array.
 */
function analyzeLines(lines, options = {}) {
    if (!Array.isArray(lines)) {
        throw new TypeError('Expected an array of lines');
    }
    const config = options.config ? resolveConfig(options.config) : DEFAULT_CONFIG;

    /** @type {import("./types.js").ChunkIssue[]} */
    const malformed = [];
    /** @type {Map<string, Bucket>} */
    const buckets = new Map();

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];

        if (typeof line !== 'string' || line.length < config.sessionLength) {
            malformed.push({ line: i, reason: 'line is too short or not a string' });
            continue;
        }

        const sessionId = line.slice(0, config.sessionLength);
        if (!SESSION_PREFIX_RE.test(sessionId)) {
            malformed.push({ line: i, reason: 'invalid session prefix' });
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
                reason: err instanceof Error ? err.message : String(err),
            });
        }
    }

    /** @type {import("./types.js").SessionAnalysis[]} */
    const sessions = [];

    for (const bucket of buckets.values()) {
        const expectedTotal = mode(bucket.chunks.map(c => c.total));

        /** @type {Map<number, number>} */
        const indexCount = new Map();
        for (const chunk of bucket.chunks) {
            indexCount.set(chunk.index, (indexCount.get(chunk.index) ?? 0) + 1);
        }

        const present = [...indexCount.keys()].sort((a, b) => a - b);
        const duplicates = present.filter(idx => (indexCount.get(idx) ?? 0) > 1);

        /** @type {number[]} */
        const missing = [];
        if (expectedTotal !== null) {
            for (let idx = 0; idx < expectedTotal; idx += 1) {
                if (!indexCount.has(idx)) missing.push(idx);
            }
        }

        const totalMismatch =
            expectedTotal === null || bucket.chunks.some(c => c.total !== expectedTotal);

        const complete =
            bucket.errors.length === 0 &&
            !totalMismatch &&
            missing.length === 0 &&
            duplicates.length === 0 &&
            bucket.chunks.length === expectedTotal;

        sessions.push({
            sessionId: bucket.sessionId,
            complete,
            expectedTotal,
            totalMismatch,
            chunks: [...bucket.chunks].sort((a, b) => a.index - b.index),
            present,
            missing,
            duplicates,
            errors: bucket.errors,
        });
    }

    sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId));

    const ok = malformed.length === 0 && sessions.every(s => s.complete);
    return { ok, sessions, malformed };
}

/**
 * Filter the report down to complete sessions.
 *
 * @public
 * @param {import("./types.js").AnalysisResult} report
 * @returns {import("./types.js").SessionAnalysis[]}
 */
function completeSessions(report) {
    return report.sessions.filter(s => s.complete);
}

/**
 * Filter the report down to incomplete sessions.
 *
 * @public
 * @param {import("./types.js").AnalysisResult} report
 * @returns {import("./types.js").SessionAnalysis[]}
 */
function incompleteSessions(report) {
    return report.sessions.filter(s => !s.complete);
}

/**
 * Analyze an array of arbitrary items by extracting base62 lines from them
 * and grouping by session id — exactly like {@link analyzeLines}, but keeps
 * the source items attached to the result.
 *
 * For each session, `items` is parallel to `chunks`: `items[i]` is the
 * object that produced `chunks[i]`. `malformed` and `errors` entries carry
 * the offending item as `.item`.
 *
 * Never throws on bad data. Only a non-array `items` or a non-function
 * `getLine` raises `TypeError`.
 *
 * @example
 *   const rows = await db.select("SELECT id, chunk FROM chunks");
 *   const report = analyzeItems(rows, { getLine: (r) => r.chunk });
 *
 *   for (const s of report.sessions) {
 *     if (s.complete) {
 *       saveComplete(s.sessionId, joinChunks(s.chunks));
 *       await db.deleteByIds("chunks", s.items.map((r) => r.id));
 *     }
 *   }
 *
 * @public
 * @template T
 * @param {T[]} items
 * @param {import("./types.js").AnalyzeItemsOptions<T>} options
 * @returns {import("./types.js").ItemizedAnalysisResult<T>}
 * @throws {TypeError} If `items` is not an array or `getLine` is not a function.
 */
function analyzeItems(items, options) {
    if (!Array.isArray(items)) {
        throw new TypeError('Expected an array of items');
    }
    const { getLine, config: userConfig } = options;
    if (typeof getLine !== 'function') {
        throw new TypeError('getLine must be a function');
    }
    const config = userConfig ? resolveConfig(userConfig) : DEFAULT_CONFIG;

    /**
     * @internal
     * @typedef {object} ItemBucket
     * @property {string} sessionId
     * @property {{ chunk: import("./types.js").Chunk, item: T }[]} entries
     * @property {import("./types.js").ItemizedChunkIssue<T>[]} errors
     */

    /** @type {import("./types.js").ItemizedChunkIssue<T>[]} */
    const malformed = [];
    /** @type {Map<string, ItemBucket>} */
    const buckets = new Map();

    for (let i = 0; i < items.length; i += 1) {
        const item = items[i];

        let line;
        try {
            line = getLine(item, i);
        } catch (err) {
            malformed.push({
                item,
                line: i,
                reason: `getLine threw: ${err instanceof Error ? err.message : String(err)}`,
            });
            continue;
        }

        if (typeof line !== 'string' || line.length < config.sessionLength) {
            malformed.push({
                item,
                line: i,
                reason: 'line is too short or not a string',
            });
            continue;
        }

        const sessionId = line.slice(0, config.sessionLength);
        if (!SESSION_PREFIX_RE.test(sessionId)) {
            malformed.push({ item, line: i, reason: 'invalid session prefix' });
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
                reason: err instanceof Error ? err.message : String(err),
            });
        }
    }

    /** @type {import("./types.js").ItemizedSessionAnalysis<T>[]} */
    const sessions = [];

    for (const bucket of buckets.values()) {
        const chunksArr = bucket.entries.map(e => e.chunk);
        const expectedTotal = mode(chunksArr.map(c => c.total));

        /** @type {Map<number, number>} */
        const indexCount = new Map();
        for (const c of chunksArr) {
            indexCount.set(c.index, (indexCount.get(c.index) ?? 0) + 1);
        }
        const present = [...indexCount.keys()].sort((a, b) => a - b);
        const duplicates = present.filter(idx => (indexCount.get(idx) ?? 0) > 1);

        /** @type {number[]} */
        const missing = [];
        if (expectedTotal !== null) {
            for (let idx = 0; idx < expectedTotal; idx += 1) {
                if (!indexCount.has(idx)) missing.push(idx);
            }
        }

        const totalMismatch =
            expectedTotal === null || chunksArr.some(c => c.total !== expectedTotal);

        const complete =
            bucket.errors.length === 0 &&
            !totalMismatch &&
            missing.length === 0 &&
            duplicates.length === 0 &&
            chunksArr.length === expectedTotal;

        // Sort entries once — both `chunks` and `items` come out in lockstep.
        const sorted = [...bucket.entries].sort((a, b) => a.chunk.index - b.chunk.index);

        sessions.push({
            sessionId: bucket.sessionId,
            complete,
            expectedTotal,
            totalMismatch,
            chunks: sorted.map(e => e.chunk),
            items: sorted.map(e => e.item),
            present,
            missing,
            duplicates,
            errors: bucket.errors,
        });
    }

    sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    const ok = malformed.length === 0 && sessions.every(s => s.complete);
    return { ok, sessions, malformed };
}

// @ts-check


/**
 * Create a self-consistent codec: every method on the returned object uses
 * the same resolved config for encoding and decoding, so mismatched-config
 * bugs are impossible by construction.
 *
 * @public
 * @param {import("./types.js").ChunkConfig} [config]
 * @returns {import("./types.js").Codec}
 */
function createCodec(config = {}) {
    const resolved = resolveConfig(config);
    return {
        config: resolved,
        metaLen: resolved.metaLength,
        encodeText: (text, options = {}) => encodeText(text, { ...options, config: resolved }),
        decodeText: lines => decodeText(lines, { config: resolved }),
        splitText: (text, options = {}) => splitText(text, { ...options, config: resolved }),
        joinChunks,
        parseChunk: line => parseChunk(line, resolved),
        formatChunk: chunk => formatChunk(chunk, resolved),
        chunksFromLines: lines => chunksFromLines(lines, resolved),
        analyzeLines: lines => analyzeLines(lines, { config: resolved }),
        analyzeItems: (items, options) => analyzeItems(items, { ...options, config: resolved }),
        completeSessions,
        incompleteSessions,
        generateSessionId: () => generateSessionId(resolved),
    };
}

export { ALPHABET, DEFAULT_CONFIG, analyzeItems, analyzeLines, chunksFromLines, completeSessions, createCodec, decodeText, encodeText, formatChunk, generateSessionId, incompleteSessions, joinChunks, parseChunk, resolveConfig, splitText };
