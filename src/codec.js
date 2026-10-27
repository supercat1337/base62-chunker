// @ts-check

import { resolveConfig } from './config.js';
import { formatChunk, parseChunk } from './chunk.js';
import { chunksFromLines, decodeText, joinChunks } from './decode.js';
import { encodeText, generateSessionId, splitText } from './encode.js';
import { analyzeItems, analyzeLines, completeSessions, incompleteSessions } from './analyze.js';

/**
 * Create a self-consistent codec: every method on the returned object uses
 * the same resolved config for encoding and decoding, so mismatched-config
 * bugs are impossible by construction.
 *
 * @public
 * @param {import("./types.js").ChunkConfig} [config]
 * @returns {import("./types.js").Codec}
 */
export function createCodec(config = {}) {
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
