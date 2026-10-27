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

/**
 * Base62 alphabet: digits, uppercase, lowercase. Every string produced by
 * this package consists only of these 62 characters, so output is safe for
 * transports that restrict payloads to `[0-9A-Za-z]`.
 * @public
 */
export declare const ALPHABET: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Non-throwing report produced by {@link analyzeLines}.
 *
 * @public
 */
export declare interface AnalysisResult {
    /** `true` if every session is complete and no line is malformed. */
    ok: boolean;
    /** Per-session analyses, sorted by `sessionId`. */
    sessions: SessionAnalysis[];
    /** Lines whose session id could not be recovered at all. */
    malformed: ChunkIssue[];
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
export declare function analyzeItems<T>(items: T[], options: AnalyzeItemsOptions<T>): ItemizedAnalysisResult<T>;

/**
 * Options for {@link analyzeItems}.
 * @public
 */
export declare interface AnalyzeItemsOptions<T> {
    /** Extract the base62 line from an item. */
    getLine: (item: T, index: number) => string;
    /** Optional wire-format override; must match the encoder. */
    config?: ChunkConfig;
}

/**
 * Accumulator for one session during a single `analyzeLines` pass.
 * @internal
 * @typedef {object} Bucket@typedef {object} Bucket
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
export declare function analyzeLines(lines: string[], options?: AnalyzeOptions): AnalysisResult;

/**
 * Options for {@link analyzeLines}.
 * @public
 */
export declare interface AnalyzeOptions {
    /**
     * Must match the config used to encode the lines.
     */
    config?: ChunkConfig;
}

/**
 * Logical chunk of a payload. Carries everything needed to serialize it to
 * a base62 line (via {@link formatChunk}) or to reassemble the original
 * text (via {@link joinChunks}).
 *
 * @public
 */
export declare interface Chunk {
    /**
     * Base62 session id, identical across all chunks of one payload. Length
     * equals `config.sessionLength` (6 characters by default).
     */
    session: string;
    /**
     * 0-based chunk index. Always strictly less than {@link Chunk.total}.
     */
    index: number;
    /**
     * Total number of chunks in the payload. Same value across all chunks of
     * one session.
     */
    total: number;
    /**
     * Payload bytes for this chunk (UTF-8 for text). The number of bytes is
     * `bytes.length`; it is written into the count field of the encoded line.
     */
    bytes: Uint8Array;
}

/**
 * Partial configuration for the wire format. Omitted fields inherit
 * defaults — `sessionLength: 6`, `checksum: "crc16"`.
 *
 * @public
 */
export declare interface ChunkConfig {
    /**
     * Base62 session id length.
     *
     * Larger = safer against cross-session collisions; smaller = more payload
     * per line. Approximate birthday-collision thresholds:
     *
     * - `6` → ~240 K concurrent sessions
     * - `7` → ~2.2 M concurrent sessions
     * - `8` → ~17 M concurrent sessions
     *
     * @defaultValue 6
     */
    sessionLength?: 4 | 5 | 6 | 7 | 8;
    /**
     * Checksum algorithm applied to each chunk's payload.
     *
     * - `"none"`  — no checksum (0 header chars)
     * - `"crc8"`  — CRC-8/MAXIM (2 header chars)
     * - `"crc16"` — CRC-16/CCITT (3 header chars)
     *
     * @defaultValue "crc16"
     */
    checksum?: 'none' | 'crc8' | 'crc16';
}

/**
 * A single problem detected in an array of encoded lines. Used both for
 * line-level issues (`report.malformed`) and per-chunk payload decode
 * failures (`SessionAnalysis.errors`).
 *
 * @public
 */
export declare interface ChunkIssue {
    /** 0-based index of the offending line in the input array. */
    line: number;
    /** Human-readable description of what is wrong with the line. */
    reason: string;
}

/**
 * Parse lines into chunks. Throws on the first malformed line.
 *
 * @public
 * @param {string[]} lines
 * @param {import("./types.js").ResolvedConfig} [config]
 * @returns {import("./types.js").Chunk[]}
 */
export declare function chunksFromLines(lines: string[], config?: ResolvedConfig): Chunk[];

/**
 * Self-consistent bundle returned by {@link createCodec}. Every method on
 * the returned object uses the same resolved config, so encode/decode
 * mismatches are impossible by construction.
 *
 * @public
 */
export declare interface Codec {
    /** Resolved config shared by all methods. */
    config: ResolvedConfig;
    /** Shortcut for `config.metaLength`. */
    metaLen: number;
    /** Split text into base62-only lines. */
    encodeText: (text: string, options?: Omit<EncodeOptions, 'config'>) => string[];
    /** Reassemble text from base62-only lines. Throws on any inconsistency. */
    decodeText: (lines: string[]) => string;
    /** Split text into {@link Chunk} structures. */
    splitText: (text: string, options?: Omit<EncodeOptions, 'config'>) => Chunk[];
    /** Reassemble text from {@link Chunk} structures. */
    joinChunks: (chunks: Chunk[]) => string;
    /** Parse a single line into a {@link Chunk}. */
    parseChunk: (line: string) => Chunk;
    /** Serialize a {@link Chunk} into a base62 line. */
    formatChunk: (chunk: Chunk) => string;
    /** Parse lines into chunks (throws on the first malformed line). */
    chunksFromLines: (lines: string[]) => Chunk[];
    /** Non-throwing integrity analysis. */
    analyzeLines: (lines: string[]) => AnalysisResult;
    /** Non-throwing integrity analysis over arbitrary items; `config` is
     *  supplied by the codec, so it cannot diverge from encode/decode. */
    analyzeItems: <T>(items: T[], options: Omit<AnalyzeItemsOptions<T>, 'config'>) => ItemizedAnalysisResult<T>;
    /** Filter the report down to complete sessions. */
    completeSessions: (report: AnalysisResult) => SessionAnalysis[];
    /** Filter the report down to incomplete sessions. */
    incompleteSessions: (report: AnalysisResult) => SessionAnalysis[];
    /** Generate a fresh base62 session id of `config.sessionLength` characters. */
    generateSessionId: () => string;
}

/**
 * Filter the report down to complete sessions.
 *
 * @public
 * @param {import("./types.js").AnalysisResult} report
 * @returns {import("./types.js").SessionAnalysis[]}
 */
export declare function completeSessions(report: AnalysisResult): SessionAnalysis[];

/**
 * Create a self-consistent codec: every method on the returned object uses
 * the same resolved config for encoding and decoding, so mismatched-config
 * bugs are impossible by construction.
 *
 * @public
 * @param {import("./types.js").ChunkConfig} [config]
 * @returns {import("./types.js").Codec}
 */
export declare function createCodec(config?: ChunkConfig): Codec;

/**
 * Options for {@link decodeText}.
 * @public
 */
export declare interface DecodeOptions {
    /**
     * Must match the config used to encode the lines, otherwise the checksum
     * or the header parse fails.
     */
    config?: ChunkConfig;
}

/**
 * Decode encoded lines back to the original text.
 *
 * @public
 * @param {string[]} lines
 * @param {import("./types.js").DecodeOptions} [options]
 * @returns {string}
 */
export declare function decodeText(lines: string[], options?: DecodeOptions): string;

/**
 * Default configuration: 6-char session, CRC16, 17-char header.
 * @public
 */
export declare const DEFAULT_CONFIG: ResolvedConfig;

/**
 * Options for {@link splitText} and {@link encodeText}.
 *
 * If `bytesPerChunk` is set, it takes precedence over `maxLen`. Otherwise
 * the chunk size is derived from `maxLen − config.metaLength` and rounded
 * down so the base62 payload never exceeds the character budget.
 *
 * @public
 */
export declare interface EncodeOptions {
    /**
     * Maximum encoded line length in base62 characters (metadata included).
     * @defaultValue 63
     */
    maxLen?: number;
    /**
     * Explicit chunk size in bytes. Overrides `maxLen` when both are set.
     */
    bytesPerChunk?: number;
    /**
     * Fixed session id. Its length must equal `config.sessionLength`.
     * A random id is generated when omitted.
     */
    sessionId?: string;
    /**
     * Override the default wire format. Omitted fields inherit defaults.
     */
    config?: ChunkConfig;
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
export declare function encodeText(text: string, options?: EncodeOptions): string[];

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
export declare function formatChunk(chunk: Chunk, config?: ResolvedConfig): string;

/**
 * Generate a fresh base62 session id of `config.sessionLength` characters.
 *
 * @public
 * @param {import("./types.js").ResolvedConfig} [config]
 * @returns {string}
 */
export declare function generateSessionId(config?: ResolvedConfig): string;

/**
 * Filter the report down to incomplete sessions.
 *
 * @public
 * @param {import("./types.js").AnalysisResult} report
 * @returns {import("./types.js").SessionAnalysis[]}
 */
export declare function incompleteSessions(report: AnalysisResult): SessionAnalysis[];

/**
 * Non-throwing report produced by {@link analyzeItems}. Same shape as
 * {@link AnalysisResult}, but every chunk, malformed entry, and decode
 * error carries the source item that produced it.
 *
 * `sessions[i].items[j]` is the source object that produced
 * `sessions[i].chunks[j]` — same order, same length.
 *
 * @public
 */
export declare interface ItemizedAnalysisResult<T> extends AnalysisResult {
    /** Per-session analyses with source items attached. */
    sessions: ItemizedSessionAnalysis<T>[];
    /** Lines whose session id could not be recovered, each tagged with its source item. */
    malformed: ItemizedChunkIssue<T>[];
}

/**
 * Issue attached to a specific source item.
 * @public
 */
export declare interface ItemizedChunkIssue<T> extends ChunkIssue {
    /** The original item that produced this line. */
    item: T;
}

/**
 * Per-session analysis with a parallel `items` array.
 *
 * `sessions[i].items[j]` is the source item that produced
 * `sessions[i].chunks[j]` — same order, same length.
 *
 * @public
 */
export declare interface ItemizedSessionAnalysis<T> extends SessionAnalysis {
    /** Source items parallel to `chunks`. */
    items: T[];
    /** Per-chunk decode failures, each tagged with its source item. */
    errors: ItemizedChunkIssue<T>[];
}

/**
 * Reassemble the original text from an unordered array of chunks.
 *
 * @public
 * @param {import("./types.js").Chunk[]} chunks
 * @returns {string}
 * @throws {TypeError | Error}
 */
export declare function joinChunks(chunks: Chunk[]): string;

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
export declare function parseChunk(line: string, config?: ResolvedConfig): Chunk;

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
export declare function resolveConfig(partial?: ChunkConfig): ResolvedConfig;

/**
 * Fully-resolved configuration with derived fields pre-computed. Produced
 * by {@link resolveConfig}; {@link DEFAULT_CONFIG} is the package default.
 *
 * @public
 */
export declare interface ResolvedConfig {
    /** Resolved session id length. */
    sessionLength: 4 | 5 | 6 | 7 | 8;
    /** Resolved checksum algorithm. */
    checksum: 'none' | 'crc8' | 'crc16';
    /** Base62 characters reserved for the CRC field (`0`, `2`, or `3`). */
    crcLength: number;
    /** Base62 characters reserved for the chunk index (fixed at `3`). */
    indexLength: 3;
    /** Base62 characters reserved for the total count (fixed at `3`). */
    totalLength: 3;
    /** Base62 characters reserved for the byte count (fixed at `2`). */
    countLength: 2;
    /** Total header length in base62 chars: `sessionLength + 3 + 3 + 2 + crcLength`. */
    metaLength: number;
    /** Highest supported chunk index (`62³ − 1 = 238 327`). */
    maxIndex: number;
    /** Highest supported total count (`62³ − 1 = 238 327`). */
    maxTotal: number;
    /** Highest supported per-chunk payload (`62² − 1 = 3 843` bytes). */
    maxByteCount: number;
}

/**
 * Analysis of one session found in an array of encoded lines.
 *
 * `complete: true` means every index in `[0, expectedTotal)` is present
 * exactly once, all chunks agree on `total`, and no line in this session
 * failed to decode. `chunks` is populated even when incomplete, so partial
 * payloads can be persisted.
 *
 * @public
 */
export declare interface SessionAnalysis {
    /** Session id read from the 8-/6-/…-char header prefix. */
    sessionId: string;
    /** `true` when the session is intact and fully recoverable. */
    complete: boolean;
    /** Best-guess chunk count, or `null` if chunks disagree or none parsed. */
    expectedTotal: number | null;
    /** `true` if chunks disagree on `total`, or nothing could be parsed. */
    totalMismatch: boolean;
    /** Successfully decoded chunks, sorted by `index`. */
    chunks: Chunk[];
    /** Indices that appear at least once, sorted. */
    present: number[];
    /** Indices in `[0, expectedTotal)` that never appeared. */
    missing: number[];
    /** Indices that appear more than once. */
    duplicates: number[];
    /** Lines whose session was recovered but whose payload failed to parse. */
    errors: ChunkIssue[];
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
export declare function splitText(text: string, options?: EncodeOptions): Chunk[];

export { }
