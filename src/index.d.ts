/**
 * Split any text into base62-only lines with embedded metadata, transport
 * them safely, and reassemble the original on the other side — with a
 * structured integrity report that never throws.
 *
 * @remarks
 * Every output line contains only `[0-9A-Za-z]`, carries its own session
 * id, chunk index, total count, and a CRC checksum, so lines can be sent
 * through narrow channels (SMS, QR, LoRa, URL parameters), arrive out of
 * order, or get duplicated — and the receiver can still tell exactly what
 * is complete and what is missing.
 *
 * The package exposes three top-level flows:
 *
 * - {@link encodeText} / {@link splitText} — text → base62 lines / chunks.
 * - {@link decodeText} / {@link joinChunks} — lines / chunks → text
 *   (throwing).
 * - {@link analyzeLines} — lines → {@link AnalysisResult}
 *   (non-throwing integrity report).
 *
 * The wire format is controlled by {@link ChunkConfig}. Defaults are
 * `{ sessionLength: 6, checksum: "crc16" }` — a 17-char header that still
 * fits 34 bytes of payload per line at `maxLen = 63`. Use
 * {@link createCodec} to bundle encode and decode with the same resolved
 * config, or {@link resolveConfig} to inspect the effective layout.
 *
 * @packageDocumentation
 */

export { ALPHABET } from './base62.js';
export { DEFAULT_CONFIG, resolveConfig } from './config.js';
export { formatChunk, parseChunk } from './chunk.js';
export { createCodec } from './codec.js';
export { encodeText, generateSessionId, splitText } from './encode.js';
export { chunksFromLines, decodeText, joinChunks } from './decode.js';
export { analyzeLines, completeSessions, incompleteSessions, analyzeItems } from './analyze.js';

export type {
    AnalysisResult,
    AnalyzeOptions,
    Chunk,
    ChunkConfig,
    ChunkIssue,
    Codec,
    DecodeOptions,
    EncodeOptions,
    ResolvedConfig,
    SessionAnalysis,
    AnalyzeItemsOptions,
    ItemizedAnalysisResult,
    ItemizedChunkIssue,
    ItemizedSessionAnalysis,
} from './types.js';
