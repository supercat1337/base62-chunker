// @ts-check

import { LOG2_BASE62, randomBase62 } from './base62.js';
import { DEFAULT_CONFIG, resolveConfig } from './config.js';
import { formatChunk, validateSessionId } from './chunk.js';

/**
 * Generate a fresh base62 session id of `config.sessionLength` characters.
 *
 * @public
 * @param {import("./types.js").ResolvedConfig} [config]
 * @returns {string}
 */
export function generateSessionId(config = DEFAULT_CONFIG) {
    return randomBase62(config.sessionLength);
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
export function splitText(text, options = {}) {
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
export function encodeText(text, options = {}) {
    const config = options.config ? resolveConfig(options.config) : DEFAULT_CONFIG;
    return splitText(text, { ...options, config }).map(c => formatChunk(c, config));
}
