// @ts-check

import test from 'ava';

import { createCodec } from '../src/codec.js';
import { DEFAULT_CONFIG } from '../src/config.js';

// ── Factory shape ────────────────────────────────────────────────────────────

test('createCodec: no args uses DEFAULT_CONFIG', t => {
    const codec = createCodec();
    t.deepEqual(codec.config, DEFAULT_CONFIG);
});

test('createCodec: exposes metaLen matching config', t => {
    const codec = createCodec();
    t.is(codec.metaLen, codec.config.metaLength);
});

test('createCodec: resolves partial config', t => {
    const codec = createCodec({ sessionLength: 8 });
    t.is(codec.config.sessionLength, 8);
});

test('createCodec: partial config keeps default checksum', t => {
    const codec = createCodec({ sessionLength: 8 });
    t.is(codec.config.checksum, 'crc16');
});

test('createCodec: resolved config is frozen', t => {
    const codec = createCodec();
    t.true(Object.isFrozen(codec.config));
});

// ── encodeText ───────────────────────────────────────────────────────────────

test('codec.encodeText: produces base62-only lines', t => {
    const codec = createCodec();
    const lines = codec.encodeText('Привет, мир!');
    t.true(lines.every(line => /^[0-9A-Za-z]+$/.test(line)));
});

test('codec.encodeText: respects maxLen', t => {
    const codec = createCodec();
    const lines = codec.encodeText('x'.repeat(500), { maxLen: 40 });
    t.true(lines.every(line => line.length <= 40));
});

test('codec.encodeText: accepts explicit sessionId', t => {
    const codec = createCodec();
    const lines = codec.encodeText('hi', { sessionId: 'AAAAAA' });
    t.is(lines[0].slice(0, 6), 'AAAAAA');
});

// ── decodeText ───────────────────────────────────────────────────────────────

test('codec.decodeText: roundtrips ASCII', t => {
    const codec = createCodec();
    t.is(codec.decodeText(codec.encodeText('Hello, World!')), 'Hello, World!');
});

test('codec.decodeText: roundtrips Cyrillic', t => {
    const codec = createCodec();
    t.is(codec.decodeText(codec.encodeText('Привет, мир!')), 'Привет, мир!');
});

test('codec.decodeText: roundtrips multi-chunk', t => {
    const codec = createCodec();
    const text = 'Lorem ipsum dolor sit amet. '.repeat(50);
    t.is(codec.decodeText(codec.encodeText(text, { maxLen: 40 })), text);
});

// ── splitText / joinChunks ───────────────────────────────────────────────────

test('codec.splitText: session length matches config', t => {
    const codec = createCodec({ sessionLength: 8 });
    const chunks = codec.splitText('hello');
    t.is(chunks[0].session.length, 8);
});

test('codec.joinChunks: reassembles splitText output', t => {
    const codec = createCodec();
    const text = 'roundtrip check '.repeat(10);
    t.is(codec.joinChunks(codec.splitText(text, { maxLen: 40 })), text);
});

// ── parseChunk / formatChunk ─────────────────────────────────────────────────

test('codec.parseChunk: parses a line into a Chunk', t => {
    const codec = createCodec();
    const line = codec.encodeText('x')[0];
    t.is(codec.parseChunk(line).session.length, 6);
});

test('codec.formatChunk: serializes a Chunk into a line', t => {
    const codec = createCodec();
    const chunk = codec.splitText('x')[0];
    t.regex(codec.formatChunk(chunk), /^[0-9A-Za-z]+$/);
});

test('codec.parseChunk / formatChunk: roundtrip', t => {
    const codec = createCodec();
    const original = codec.splitText('payload')[0];
    const parsed = codec.parseChunk(codec.formatChunk(original));
    t.deepEqual(parsed, original);
});

// ── chunksFromLines ──────────────────────────────────────────────────────────

test('codec.chunksFromLines: parses every line', t => {
    const codec = createCodec();
    const lines = codec.encodeText('x'.repeat(200), { maxLen: 40 });
    t.is(codec.chunksFromLines(lines).length, lines.length);
});

// ── analyzeLines / filters ───────────────────────────────────────────────────

test('codec.analyzeLines: reports ok on valid input', t => {
    const codec = createCodec();
    const lines = codec.encodeText('hello');
    t.true(codec.analyzeLines(lines).ok);
});

test('codec.completeSessions: returns complete sessions', t => {
    const codec = createCodec();
    const lines = codec.encodeText('hello');
    t.is(codec.completeSessions(codec.analyzeLines(lines)).length, 1);
});

test('codec.incompleteSessions: returns no incomplete sessions on valid input', t => {
    const codec = createCodec();
    const lines = codec.encodeText('hello');
    t.is(codec.incompleteSessions(codec.analyzeLines(lines)).length, 0);
});

test('codec.incompleteSessions: returns incomplete sessions on partial input', t => {
    const codec = createCodec();
    const lines = codec.encodeText('x'.repeat(200), { maxLen: 40 });
    t.is(codec.incompleteSessions(codec.analyzeLines(lines.slice(0, -1))).length, 1);
});

// ── generateSessionId ────────────────────────────────────────────────────────

test('codec.generateSessionId: matches configured sessionLength', t => {
    const codec = createCodec({ sessionLength: 8 });
    t.regex(codec.generateSessionId(), /^[0-9A-Za-z]{8}$/);
});

// ── Config-mismatch isolation ────────────────────────────────────────────────

test('codec: different sessionLength configs are incompatible', t => {
    const a = createCodec({ sessionLength: 6 });
    const b = createCodec({ sessionLength: 8 });
    const lines = a.encodeText('hello');
    t.throws(() => b.decodeText(lines));
});

test('codec: crc16 codec cannot read crc8 lines', t => {
    const a = createCodec({ checksum: 'crc8' });
    const b = createCodec({ checksum: 'crc16' });
    const lines = a.encodeText('hello');
    t.throws(() => b.decodeText(lines));
});

test('codec: crc16 codec cannot read unchecked lines', t => {
    const a = createCodec({ checksum: 'none' });
    const b = createCodec({ checksum: 'crc16' });
    const lines = a.encodeText('hello');
    t.throws(() => b.decodeText(lines));
});

test('codec: config does not leak between instances', t => {
    const a = createCodec({ sessionLength: 6 });
    const b = createCodec({ sessionLength: 8 });
    t.not(a.config.sessionLength, b.config.sessionLength);
});

test('codec.analyzeItems: keeps items parallel to chunks', t => {
    const codec = createCodec();
    const lines = codec.encodeText('hello');
    const rows = lines.map((chunk, id) => ({ id, chunk }));
    const report = codec.analyzeItems(rows, { getLine: r => r.chunk });
    t.true(report.sessions[0].complete);
    t.deepEqual(
        report.sessions[0].items.map(r => r.id),
        [0]
    );
});
