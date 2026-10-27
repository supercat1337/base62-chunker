# @supercat1337/base62-chunker

> Split any text into base62-only lines with embedded metadata, transport them safely, and reassemble the original on the other side — with a structured integrity report that never throws.

[![npm version](https://badge.fury.io/js/%40supercat1337%2Fbase62-chunker.svg)](https://www.npmjs.com/package/@supercat1337/base62-chunker)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.txt)

---

## Installation

```sh
npm install @supercat1337/base62-chunker
```

Requires Node.js ≥ 19 (for `globalThis.crypto.getRandomValues`) or any modern browser / edge runtime.

## Quick start

**Client side** — split text into base62-only lines:

```js
import { generateSessionId, splitText, formatChunk } from '@supercat1337/base62-chunker';

const sessionId = generateSessionId(); // 'aB3xK9' — 6 chars by default
const chunks = splitText(text, { sessionId, maxLen: 63 });
const lines = chunks.map(formatChunk); // ['aB3xK9000...', ...]

await sendToServer(lines);
```

**Server side** — analyze what arrived, then reassemble complete sessions:

```js
import { analyzeLines, joinChunks } from '@supercat1337/base62-chunker';

const lines = await loadLinesFromQueue();
const report = analyzeLines(lines); // never throws

for (const session of report.sessions) {
    if (session.complete) {
        const text = joinChunks(session.chunks);
        await saveComplete(session.sessionId, text);
    } else {
        await savePartial(session.sessionId, {
            chunks: session.chunks, // partial Chunk[] — safe to persist
            missing: session.missing, // e.g. [2, 5, 6]
            duplicates: session.duplicates,
            errors: session.errors,
        });
    }
}

// Lines whose session id could not even be recovered:
if (report.malformed.length > 0) {
    console.error('malformed:', report.malformed);
}
```

Every output line contains only `[0-9A-Za-z]`, so it is safe to pass through transports that reject whitespace, punctuation, or non-ASCII.

## When to use it

Short formula: **send arbitrary text over a channel that accepts only `[0-9A-Za-z]` and/or limits line length — and, on the other side, know exactly what arrived and what is missing.**

### Transport over narrow channels

- **SMS / USSD / legacy APIs with a per-message limit.** 160 characters per SMS, part of them consumed by the header. Base62 guarantees no `%2B`, `+`, `/`, `=` — nothing that requires escaping in URLs, JSON strings, or XML attributes.
- **Chat bots (Telegram, Slack, Discord).** A user sends a long text to the bot; the bot splits it into several messages; messages can arrive out of order, be duplicated by retries, or get lost. `analyzeLines` on the server shows which indices are missing, and the bot can re-send exactly those.
- **QR codes / barcodes.** One QR per chunk, a document = a set of QRs. Base62 survives scanners that mishandle Unicode or special characters.
- **LoRa / Meshtastic / ham radio.** Hard packet-size and alphabet limits, and packets get dropped. The embedded metadata is exactly what is needed: "session X, chunk 3 of 17, 34 bytes".
- **URL parameters and deep links.** `https://example.com/?payload=aB3xK9000...` — base62 needs no percent-encoding, and the link stays readable and short. For comparison, base64 in URLs requires `+` → `-`, `/` → `_`, and stripping `=`.

### Unordered and unreliable delivery

- **Queues (SQS, RabbitMQ, Kafka), workers, coordination.** Several workers produce pieces of one document, publish to a queue, a consumer collects them. Order is not guaranteed, duplicates are possible — but `sessionId` + `index` + `total` in every line allow you to:
    - demultiplex several sessions mixed in one queue;
    - detect duplicates (`duplicates: [...]`);
    - detect gaps (`missing: [...]`);
    - hand already-parsed `Chunk[]` to the database — the worker does not need to re-parse.
- **IoT / microcontrollers.** A device with 64 KB of RAM cannot hold a large report in memory. It reads it from flash in slices and sends it as chunks. If a packet is lost on the way back, the server knows immediately — no need to "re-upload the whole file".
- **Mobile offline-first.** The app accumulates chunks in a local database and syncs when connectivity returns. If a session did not fully assemble (2 chunks missing), `incompleteSessions` gives the exact list of indices to re-send.
- **Paper printouts / offline transfer.** Data is printed as base62 lines; a human retypes them into another system. A typo is visible right away: `analyzeLines` reports `totalMismatch` or `missing`, and CRC16 rejects most single-character substitutions.

### Systems with a strict line-format constraint

- **Legacy database columns like `VARCHAR(63)` or `CHAR(80)`.** The package guarantees each line is ≤ `maxLen` and `[0-9A-Za-z]`-only — no risk of the database rejecting data because of encoding.
- **Smart contracts / blockchains.** State cells are often size- and alphabet-constrained. Base62 plus a fixed header gives a predictable size for each slot.
- **External APIs with strict validation.** Some APIs (particularly payment and government) accept only `[A-Za-z0-9]` in fields such as "comment", "reference", or "metadata". Base62 passes everywhere.
- **Logs and observability.** A long stack trace or error body does not fit the field limit of a logger (for example, 256 characters on some stacks). Split it into chunks under one `sessionId`, and later reassemble from logs knowing nothing was lost.

### What the per-line metadata actually buys you

This is the key difference from plain `text.match(/.{1,63}/g)` + `btoa`:

| Field     | Purpose                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| `session` | Lines from different sessions can be mixed and still demultiplexed. In a queue, in one log, in a shared chat. |
| `index`   | Determine the assembly order — arrival order is irrelevant.                                                   |
| `total`   | Know whether all chunks have arrived without waiting for a timeout.                                           |
| `count`   | Restore leading zero bytes that bigint encoding drops.                                                        |
| `crc`     | Reject content corruption inside the payload — see "Checksum choice".                                         |

And `analyzeLines` / `analyzeItems` **never throw** — critical for a server: partial data can be persisted and the missing chunks re-requested, instead of replying to the client with a "500 Internal Server Error".

### When this package is **not** the right tool

- **One chunk, reliable channel.** If the text always fits in one line and travels over HTTP/TCP, a plain `TextEncoder` + `btoa` is enough. The metadata is overhead.
- **The channel already chunks and verifies integrity.** HTTP with `Content-Length`, TCP, gRPC streams — order and control are already there.
- **You need cryptography.** This is **only** encoding, splitting, and a checksum. Encrypt/sign before or after; the package is neutral. `Chunk.bytes` accepts arbitrary bytes, so AES-GCM ciphertext works fine — but the encryption itself is not provided.
- **Gigabyte-scale payloads.** The default layout targets ~8 MB per session; for more, widen the header fields in `src/config.js` (the README explains how).
- **Binary data as the primary case.** The API accepts and returns bytes (`Chunk.bytes`), but the high-level `splitText` / `joinChunks` operate on UTF-8 strings. For a stream of arbitrary bytes it is usually simpler to work with `Chunk[]` and `formatChunk` directly — and if that is your main case, consider a dedicated package.

### TL;DR

| Situation                                                      | Use it?                                      |
| -------------------------------------------------------------- | -------------------------------------------- |
| SMS / USSD / bot / QR / LoRa / URL parameter                   | ✅ yes                                       |
| Queue with unordered delivery, multiple workers                | ✅ yes                                       |
| Legacy DB / external API with `[A-Za-z0-9]` and a length limit | ✅ yes                                       |
| IoT with limited memory, chunked upload                        | ✅ yes                                       |
| Internal HTTP call between services, text < 1 MB               | ❌ overkill                                  |
| Need encryption or signatures                                  | ⚠️ not this package; bring crypto separately |
| One chunk, reliable transport                                  | ❌ overkill                                  |

## How it fits together

The package exposes three top-level flows, so client and server code import exactly what they need. There are no cyclic imports:

```
   encode.js          decode.js          analyze.js
   ─────────          ─────────          ──────────
   text               string[]           string[]
    │                    │                    │
    ▼                    ▼                    ▼
   Chunk[]             Chunk[]             AnalysisResult
    │                    │                  (non-throwing)
    ▼                    ▼
   string[]             text
```

- **`encode.js`** — text → `Chunk[]` → `string[]`. Runs where the text is produced.
- **`decode.js`** — `string[]` → `Chunk[]` → text. Throws on any inconsistency; meant for the "I know this is one complete session" case.
- **`analyze.js`** — `string[]` (or arbitrary items via `analyzeItems`) → `AnalysisResult` / `ItemizedAnalysisResult<T>`. **Never throws**; groups lines by session and reports completeness, missing indices, duplicates, and per-line errors.

Supporting modules: `base62.js` (alphabet primitives), `config.js` (layout and checksum resolution), `crc.js` (CRC8 / CRC16), `chunk.js` (line format), `codec.js` (`createCodec` factory). The dependency graph is strict:

```
{base62, config, crc} ← chunk ← {encode, decode, analyze} ← codec ← index
```

## API

### Client: encode

```js
import {
    generateSessionId,
    splitText,
    formatChunk,
    encodeText,
} from '@supercat1337/base62-chunker';

// Low-level: text → Chunk[]
const sessionId = generateSessionId();
const chunks = splitText('Hello, World!', { sessionId });

// Chunk → line (individually)
const line = formatChunk(chunks[0]);

// High-level shortcut: text → string[]
const lines = encodeText('Hello, World!', { sessionId });
// equivalent to: splitText(text, opts).map(formatChunk)
```

### Server: decode (throwing)

```js
import { parseChunk, chunksFromLines, joinChunks, decodeText } from '@supercat1337/base62-chunker';

// Line → Chunk (individually)
const chunk = parseChunk(line); // { session, index, total, bytes }

// string[] → Chunk[] (throws on the first malformed line)
const chunks = chunksFromLines(lines);

// Chunk[] → text (throws on session/total mismatch, missing indices)
const text = joinChunks(chunks);

// Full shortcut: string[] → text
const text2 = decodeText(lines);
```

`decodeText` and friends are "all or nothing". For any input that may be
mixed or partial, use `analyzeLines` / `analyzeItems` instead.

### Server: analyze plain lines (non-throwing)

```js
import { analyzeLines, completeSessions, incompleteSessions } from '@supercat1337/base62-chunker';

const report = analyzeLines(lines);

report.ok; // true if every session is complete & no malformed lines
report.sessions; // SessionAnalysis[], sorted by sessionId
report.malformed; // ChunkIssue[] — lines with no recoverable session id

// Convenience filters:
for (const s of completeSessions(report)) {
    /* … */
}
for (const s of incompleteSessions(report)) {
    /* … */
}
```

`analyzeLines` never throws on bad data — it returns a structured report.
The `chunks` array is populated for every session, even incomplete ones, so
partial payloads can be persisted to the database immediately.

### Server: analyze arbitrary items (non-throwing)

`analyzeItems` is the same as `analyzeLines` but keeps the **source object**
attached to each chunk. This is what you want when the input is not a bare
`string[]` but rows from a database, queue payloads, or any wrapper.

```js
import { analyzeItems, joinChunks } from '@supercat1337/base62-chunker';

const rows = await db.select("SELECT id, chunk FROM chunks WHERE status='pending'");

const report = analyzeItems(rows, {
    getLine: row => row.chunk, // ← the only requirement
});

for (const session of report.sessions) {
    if (session.complete) {
        saveComplete(session.sessionId, joinChunks(session.chunks));

        // session.items[j] is the row that produced session.chunks[j]
        await db.deleteByIds(
            'chunks',
            session.items.map(r => r.id)
        );
    }
    // incomplete: keep the items, wait for the missing indices
}
```

`analyzeItems` **never reads or cares about field names** — `getLine` is the
only contract. See "Working with database rows" below for examples with
nested structures, UUIDs, and composite keys.

If you already have a codec from `createCodec(...)`, use
`codec.analyzeItems(items, { getLine })` — the codec fills in `config`
automatically, so you cannot accidentally analyze with a different layout
than you encoded with.

### Configuration utilities

```js
// Configuration utilities
import { createCodec, resolveConfig, DEFAULT_CONFIG } from '@supercat1337/base62-chunker';

// Pre-built default: { sessionLength: 6, checksum: "crc16" }
DEFAULT_CONFIG.metaLength; // 17

// Resolve a partial config into a frozen, fully-specified one:
const cfg = resolveConfig({ checksum: 'crc8' });
cfg.metaLength; // 16

// Bundle whose encode/decode methods share one config:
const codec = createCodec({ sessionLength: 8 });
codec.decodeText(codec.encodeText('hello')); // 'hello'

// Same idea for analysis — `config` is filled in for you:
const rows = await db.select('SELECT id, chunk FROM chunks');
const report = codec.analyzeItems(rows, { getLine: r => r.chunk });
```

### Session helpers

```js
import { generateSessionId, DEFAULT_CONFIG } from '@supercat1337/base62-chunker';

const sessionId = generateSessionId(); // 'aB3xK9' — 6 chars (default)
const longer = generateSessionId({ ...DEFAULT_CONFIG, sessionLength: 8 });
```

Reading a session id from a line is trivial — it is `line.slice(0, config.sessionLength)` (6 by default). No dedicated helper is exposed; grouping is `analyzeLines`' job.

## Options

### `splitText(text, options?)` / `encodeText(text, options?)`

| Option          | Type          | Default          | Description                                                                       |
| --------------- | ------------- | ---------------- | --------------------------------------------------------------------------------- |
| `maxLen`        | `number`      | `63`             | Maximum line length in base62 chars (metadata included).                          |
| `bytesPerChunk` | `number`      | auto             | Explicit chunk size in bytes; takes precedence over `maxLen`.                     |
| `sessionId`     | `string`      | random           | Fixed base62 session id. Length must equal `config.sessionLength` (6 by default). |
| `config`        | `ChunkConfig` | `DEFAULT_CONFIG` | Override session length and checksum.                                             |

### `decodeText(lines, options?)`

| Option   | Type          | Default          | Description                                     |
| -------- | ------------- | ---------------- | ----------------------------------------------- |
| `config` | `ChunkConfig` | `DEFAULT_CONFIG` | Must match the config used to encode the lines. |

`chunksFromLines`, `parseChunk`, `formatChunk`, `analyzeLines` accept an optional trailing `config` argument or `{ config }` object with the same semantics.

### `analyzeItems(items, options)`

| Option    | Type                                 | Required | Description                                                  |
| --------- | ------------------------------------ | -------- | ------------------------------------------------------------ |
| `getLine` | `(item: T, index: number) => string` | yes      | Extract the base62 line from an item. The **only** contract. |
| `config`  | `ChunkConfig`                        | no       | Must match the config used to encode the lines.              |

### `Chunk` shape

```ts
interface Chunk {
    session: string; // config.sessionLength base62 chars (6 by default)
    index: number; // 0-based
    total: number; // total number of chunks
    bytes: Uint8Array; // payload bytes (UTF-8)
}
```

The byte count is not a separate field — it is `chunk.bytes.length`, which
`formatChunk` writes into the count field of the line.

### `ChunkConfig` shape

```ts
interface ChunkConfig {
    sessionLength?: 4 | 5 | 6 | 7 | 8; // default 6
    checksum?: 'none' | 'crc8' | 'crc16'; // default "crc16"
}
```

### `AnalysisResult` shape

```ts
interface AnalysisResult {
    ok: boolean; // all sessions complete & no malformed lines
    sessions: SessionAnalysis[]; // sorted by sessionId
    malformed: ChunkIssue[]; // no recoverable session id
}

interface SessionAnalysis {
    sessionId: string;
    complete: boolean; // every index in [0, expectedTotal) present exactly once
    expectedTotal: number | null; // best-guess total; null on conflict
    totalMismatch: boolean; // chunks disagree on `total`
    chunks: Chunk[]; // sorted by index; empty if nothing parsed
    present: number[]; // indices that appear
    missing: number[]; // indices in [0, expectedTotal) not seen
    duplicates: number[]; // indices that appear more than once
    errors: ChunkIssue[]; // per-line decode failures
}

interface ChunkIssue {
    line: number; // 0-based index in the input array
    reason: string;
}
```

### `ItemizedAnalysisResult<T>` shape

`analyzeItems` returns the same shape, but with the source item attached
to every chunk, malformed entry, and decode error:

```ts
interface ItemizedAnalysisResult<T> extends AnalysisResult {
    sessions: ItemizedSessionAnalysis<T>[];
    malformed: ItemizedChunkIssue<T>[];
}

interface ItemizedSessionAnalysis<T> extends SessionAnalysis {
    items: T[]; // parallel to `chunks` — same order, same length
    errors: ItemizedChunkIssue<T>[];
}

interface ItemizedChunkIssue<T> extends ChunkIssue {
    item: T; // the source object that produced this issue
}
```

Guarantee: `session.items[j]` is the exact source object that produced
`session.chunks[j]`. No field renaming, no wrapping, no data loss —
whatever fields your object had (id, uuid, timestamp, parent refs) remain
accessible on `session.items[j]`.

## Working with database rows

The vast majority of server code does not receive a bare `string[]` — it
receives rows. `analyzeItems` is designed exactly for this: you provide
`getLine`, and the library hands back the same objects in a per-session
grouping. **Field names are entirely up to you** — `getLine` is the only
contract.

### Typical flow

```js
import { analyzeItems, joinChunks } from '@supercat1337/base62-chunker';

const rows = await db.select("SELECT id, chunk FROM chunks WHERE status='pending'");

const report = analyzeItems(rows, {
    getLine: row => row.chunk,
});

const toDelete = [];

for (const session of report.sessions) {
    if (session.complete) {
        saveComplete(session.sessionId, joinChunks(session.chunks));
        toDelete.push(...session.items.map(row => row.id));
        continue;
    }

    // Incomplete session: delete only hopeless chunks (bad CRC, byte-count
    // mismatch, …); keep the rest for a future retry.
    for (const err of session.errors) {
        logError(session.sessionId, err.item.id, err.reason);
        toDelete.push(err.item.id);
    }

    console.log(
        `${session.sessionId}: missing [${session.missing.join(',')}], ` +
            `have ${session.chunks.length}/${session.expectedTotal ?? '?'}`
    );
}

for (const m of report.malformed) {
    logError('malformed', m.item.id, m.reason);
    toDelete.push(m.item.id);
}

if (toDelete.length > 0) await db.deleteByIds('chunks', toDelete);
```

### Field names are yours

```js
analyzeItems(rows, { getLine: r => r.chunk }); // { id, chunk }
analyzeItems(rows, { getLine: r => r.encoded }); // { recordId, encoded }
analyzeItems(rows, { getLine: r => r.payload.line }); // nested
analyzeItems(docs, { getLine: d => d.chunk }); // Mongo, _id: ObjectId
analyzeItems(prismaRows, { getLine: r => r.base62Line });
```

Any `id` type works — `number`, `string`, UUID, `bigint`, a composite key.
`getLine` may also throw; the item is then recorded in `report.malformed`
with `.item` and `reason: "getLine threw: …"` — the run does not stop.

### Deletion policy

| Session state                    | What to do with `items`                                                          |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `complete: true`                 | Reassemble, persist text, **delete all `session.items`**.                        |
| `complete: false`, `missing > 0` | **Keep** — waiting for missing indices.                                          |
| `errors.length > 0`              | Delete `errors.map(e => e.item)` after logging — those chunks will never decode. |
| `report.malformed`               | Delete after logging — session id cannot be recovered.                           |

### Streaming (one row at a time)

When rows arrive one by one, keep a `Map<sessionId, Map<index, row>>` on
your side and flush when `map.size === total`. `parseChunk` gives you
`session`, `index`, and `total`; `joinChunks` reassembles when the set is
complete. `analyzeItems` remains useful for periodic batch sweeps.

## Format

Every encoded line is:

```
┌──────────┬───────┬───────┬───────┬───────┬─────────────────┐
│ session  │ index │ total │ count │  crc  │     payload     │
│ 6 chars  │ 3     │ 3     │ 2     │ 3     │  up to R chars  │
└──────────┴───────┴───────┴───────┴───────┴─────────────────┘
```

| Field     | Width                              | Meaning                                                       |
| --------- | ---------------------------------- | ------------------------------------------------------------- |
| `session` | `config.sessionLength` (6 default) | Random base62 id, identical across all chunks of one payload. |
| `index`   | 3                                  | 0-based chunk index.                                          |
| `total`   | 3                                  | Total number of chunks in the payload.                        |
| `count`   | 2                                  | Number of UTF-8 bytes in this chunk's payload.                |
| `crc`     | `config.crcLength` (3 default)     | CRC of the payload (`crc16` → 3, `crc8` → 2, `none` → 0).     |
| `payload` | up to `R`                          | Base62 of those bytes, treated as a big-endian bigint.        |

Leading zero bytes of a chunk are not preserved by the bigint encoding;
they are restored on decode using `count`.

### Limits

With `DEFAULT_CONFIG` (`sessionLength = 6`, `checksum = "crc16"`, `metaLength = 17`):

- **Chunks per payload:** `62³ = 238 328`
- **Bytes per chunk:** `floor((maxLen − metaLength) × log₂62 / 8)` — **34 bytes** at `maxLen = 63`
- **Total payload per session:** ≈ 8.1 MB at `maxLen = 63`
- **Minimum `maxLen`:** `19` (one byte per chunk)
- **Byte count field:** `62² = 3 844`, so per-chunk payload is capped at 3 844 bytes

`metaLength` depends on the resolved config: `sessionLength + 3 + 3 + 2 + crcLength`. If you need a larger payload, widen `LAYOUT` in `src/config.js` — the decoder follows automatically because every width lives in one place.

## Configuration

The wire format is controlled by a config object. The defaults are
`{ sessionLength: 6, checksum: "crc16" }` — a **17-char header** that still
fits **34 bytes of payload per line at `maxLen = 63`**, with CRC16 content
integrity and a 6-char session id (safe for ~240 K concurrent sessions).

```js
import { createCodec } from '@supercat1337/base62-chunker';

const codec = createCodec({
    sessionLength: 6, // 4..8, default 6
    checksum: 'crc16', // "none" | "crc8" | "crc16", default "crc16"
});

const lines = codec.encodeText('hello');
codec.decodeText(lines); // → 'hello'
```

`createCodec` returns a bundle whose encode and decode methods share the
same resolved config, so mismatched-config bugs are impossible.

### Session length trade-off

| Length | Space      | Birthday threshold | Use when                |
| ------ | ---------- | ------------------ | ----------------------- |
| 6      | 5.7 × 10¹⁰ | ~240 K sessions    | typical apps, chat, IoT |
| 7      | 3.5 × 10¹² | ~2.2 M sessions    | larger deployments      |
| 8      | 2.2 × 10¹⁴ | ~17 M sessions     | high-volume deployments |

### Checksum choice

Payload capacity at `maxLen = 63` (`sessionLength = 6`):

| Algorithm | CRC width | `metaLength` | Payload chars | Payload bytes | Detection                            |
| --------- | --------- | ------------ | ------------- | ------------- | ------------------------------------ |
| `none`    | 0 chars   | 14           | 49            | 36            | structural only                      |
| `crc8`    | 2 chars   | 16           | 47            | **34**        | ~99.6 % of single-byte substitutions |
| `crc16`   | 3 chars   | 17           | 46            | **34**        | ~99.998 % of all substitutions       |

**Why `crc16` by default:** without a checksum, a single-character
substitution inside the payload goes undetected in **10–30 %** of cases
(depending on chunk size) — the decoder still returns _a_ string, just not
the original one. CRC16 essentially eliminates that. At `maxLen = 63` it
costs **nothing in payload bytes**: 47 payload chars (crc8) and 46 payload
chars (crc16) both round down to 34 bytes. At other `maxLen` values the
wider `crc16` field costs at most 1 byte per chunk compared to `crc8`.

## Examples

Typical scenarios:

- **Chunked transport over a constrained channel** — the client splits text
  and posts each line as a separate message; the server collects them per
  session id and reassembles when the set is complete.
- **Streaming upload** — the client sends lines as they are produced, the
  server runs `analyzeLines` after each batch, and finishes when the target
  session reports `complete: true`.
- **Tolerant recovery** — if the channel drops messages, the server persists
  the incomplete `SessionAnalysis` and requests the `missing` indices again.
- **Database rows with `analyzeItems`** — a single pass over the pending
  rows yields both the reassembled text and the exact list of row ids to
  delete.

## For AI assistants

If you are an AI agent extending this package, read these files in order:

1. `src/types.ts` — the public `Chunk`, `ChunkConfig`, `ResolvedConfig`,
   `Codec`, `EncodeOptions`, `DecodeOptions`, `AnalyzeOptions`,
   `AnalyzeItemsOptions`, `AnalysisResult`, `ItemizedAnalysisResult`,
   `SessionAnalysis`, `ItemizedSessionAnalysis`, `ChunkIssue`,
   `ItemizedChunkIssue` contracts.
2. `src/config.js` — header layout constants, `resolveConfig`,
   `DEFAULT_CONFIG`.
3. `src/crc.js` — CRC8 / CRC16 tables and `computeChecksum`.
4. `src/chunk.js` — line format (`parseChunk` / `formatChunk`), header parse.
5. `src/encode.js`, `src/decode.js`, `src/analyze.js` — the three top flows.
6. `src/codec.js` — the `createCodec` factory (also wires `analyzeItems`
   into the returned bundle).
7. `src/index.d.ts` — the single entry point api-extractor reads.

Rules that are easy to miss:

- **Do not re-introduce a `getSessionId` helper.** The session id is
  `line.slice(0, config.sessionLength)` (6 by default); grouping is
  `analyzeLines` / `analyzeItems`' job.
- **`analyzeLines` and `analyzeItems` must never throw on bad input.**
  Malformed lines, duplicates, missing indices, checksum failures, and
  `getLine` exceptions are data — they belong in the report. Only a
  non-array argument (or non-function `getLine`) is a `TypeError`.
- **`analyzeItems` must not assume anything about field names.** `getLine`
  is the only contract; `item` is preserved verbatim. Do not add
  `item.id` / `item.chunk` shortcuts — users may have `recordId`, `uuid`,
  nested `payload.line`, or no id at all.
- **`session.items[j]` must stay parallel to `session.chunks[j]`.**
  Whenever `chunks` is sorted by `index`, `items` must be sorted the same
  way — implement them as one sortable pair, never independently.
- Keep `src/index.js` and `src/index.d.ts` in sync — an export missing in
  the latter is invisible to the public API.
- Everything tagged `@internal` is stripped from `dist/types.d.ts` by
  `stripInternal` — do not rely on it in user-facing docs.
- Every `.js` file in `src/` and `tests/` starts with `// @ts-check`.
- Tests use `ava` with a single assertion per `test()`, and names follow
  `<module>: <behavior>`.
- Never add `overrides` to `package.json`; use `npm link` for local
  development.
- The dependency graph is strictly
  `{base62, config, crc} ← chunk ← {encode, decode, analyze} ← codec ← index`.
  Adding a cross-import between `encode`, `decode`, and `analyze` will
  create a cycle.
- `DEFAULT_CONFIG` is frozen and shared; `resolveConfig(partial)` returns a
  new frozen object. Never mutate a resolved config.
- **`Codec.analyzeItems` must mirror `analyzeItems` exactly.** Same
  `getLine` contract, same non-throwing semantics, same parallel
  `items`/`chunks` guarantee. The only difference: the codec supplies
  `config` from its resolved state. Do not add a `config` option to
  `codec.analyzeItems` — the codec already owns it.

## License

MIT
