// @ts-check

import { DEFAULT_CONFIG, resolveConfig } from './config.js';
import { parseChunk } from './chunk.js';

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
export function analyzeLines(lines, options = {}) {
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
export function completeSessions(report) {
    return report.sessions.filter(s => s.complete);
}

/**
 * Filter the report down to incomplete sessions.
 *
 * @public
 * @param {import("./types.js").AnalysisResult} report
 * @returns {import("./types.js").SessionAnalysis[]}
 */
export function incompleteSessions(report) {
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
export function analyzeItems(items, options) {
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
