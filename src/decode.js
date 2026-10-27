// @ts-check

import { DEFAULT_CONFIG, resolveConfig } from './config.js';
import { parseChunk } from './chunk.js';

/**
 * Reassemble the original text from an unordered array of chunks.
 *
 * @public
 * @param {import("./types.js").Chunk[]} chunks
 * @returns {string}
 * @throws {TypeError | Error}
 */
export function joinChunks(chunks) {
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
export function chunksFromLines(lines, config = DEFAULT_CONFIG) {
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
export function decodeText(lines, options = {}) {
    const config = options.config ? resolveConfig(options.config) : DEFAULT_CONFIG;
    return joinChunks(chunksFromLines(lines, config));
}
