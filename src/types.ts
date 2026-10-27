// @ts-check

/**
 * Logical chunk of a payload. Carries everything needed to serialize it to
 * a base62 line (via {@link formatChunk}) or to reassemble the original
 * text (via {@link joinChunks}).
 *
 * @public
 */
export interface Chunk {
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
export interface ChunkConfig {
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
 * Fully-resolved configuration with derived fields pre-computed. Produced
 * by {@link resolveConfig}; {@link DEFAULT_CONFIG} is the package default.
 *
 * @public
 */
export interface ResolvedConfig {
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
 * Options for {@link splitText} and {@link encodeText}.
 *
 * If `bytesPerChunk` is set, it takes precedence over `maxLen`. Otherwise
 * the chunk size is derived from `maxLen − config.metaLength` and rounded
 * down so the base62 payload never exceeds the character budget.
 *
 * @public
 */
export interface EncodeOptions {
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
 * Options for {@link decodeText}.
 * @public
 */
export interface DecodeOptions {
    /**
     * Must match the config used to encode the lines, otherwise the checksum
     * or the header parse fails.
     */
    config?: ChunkConfig;
}

/**
 * Options for {@link analyzeLines}.
 * @public
 */
export interface AnalyzeOptions {
    /**
     * Must match the config used to encode the lines.
     */
    config?: ChunkConfig;
}

/**
 * A single problem detected in an array of encoded lines. Used both for
 * line-level issues (`report.malformed`) and per-chunk payload decode
 * failures (`SessionAnalysis.errors`).
 *
 * @public
 */
export interface ChunkIssue {
    /** 0-based index of the offending line in the input array. */
    line: number;
    /** Human-readable description of what is wrong with the line. */
    reason: string;
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
export interface SessionAnalysis {
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
 * Non-throwing report produced by {@link analyzeLines}.
 *
 * @public
 */
export interface AnalysisResult {
    /** `true` if every session is complete and no line is malformed. */
    ok: boolean;
    /** Per-session analyses, sorted by `sessionId`. */
    sessions: SessionAnalysis[];
    /** Lines whose session id could not be recovered at all. */
    malformed: ChunkIssue[];
}

/**
 * Self-consistent bundle returned by {@link createCodec}. Every method on
 * the returned object uses the same resolved config, so encode/decode
 * mismatches are impossible by construction.
 *
 * @public
 */
export interface Codec {
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
    analyzeItems: <T>(
        items: T[],
        options: Omit<AnalyzeItemsOptions<T>, 'config'>
    ) => ItemizedAnalysisResult<T>;
    /** Filter the report down to complete sessions. */
    completeSessions: (report: AnalysisResult) => SessionAnalysis[];
    /** Filter the report down to incomplete sessions. */
    incompleteSessions: (report: AnalysisResult) => SessionAnalysis[];
    /** Generate a fresh base62 session id of `config.sessionLength` characters. */
    generateSessionId: () => string;
}

/**
 * Issue attached to a specific source item.
 * @public
 */
export interface ItemizedChunkIssue<T> extends ChunkIssue {
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
export interface ItemizedSessionAnalysis<T> extends SessionAnalysis {
    /** Source items parallel to `chunks`. */
    items: T[];
    /** Per-chunk decode failures, each tagged with its source item. */
    errors: ItemizedChunkIssue<T>[];
}

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
export interface ItemizedAnalysisResult<T> extends AnalysisResult {
    /** Per-session analyses with source items attached. */
    sessions: ItemizedSessionAnalysis<T>[];

    /** Lines whose session id could not be recovered, each tagged with its source item. */
    malformed: ItemizedChunkIssue<T>[];
}

/**
 * Options for {@link analyzeItems}.
 * @public
 */
export interface AnalyzeItemsOptions<T> {
    /** Extract the base62 line from an item. */
    getLine: (item: T, index: number) => string;
    /** Optional wire-format override; must match the encoder. */
    config?: ChunkConfig;
}
