// @ts-check

import test from 'ava';

import { analyzeItems, analyzeLines, completeSessions, incompleteSessions } from '../src/analyze.js';
import { formatChunk } from '../src/chunk.js';
import { encodeText } from '../src/encode.js';

// ── analyzeLines ─────────────────────────────────────────────────────────────

test('analyzeLines: empty input is ok', t => {
    const report = analyzeLines([]);
    t.true(report.ok);
    t.deepEqual(report.sessions, []);
    t.deepEqual(report.malformed, []);
});

test('analyzeLines: single complete session', t => {
    const lines = encodeText('hello', { sessionId: 'AbCd12' });
    const report = analyzeLines(lines);
    t.true(report.ok);
    t.is(report.sessions[0].sessionId, 'AbCd12');
    t.true(report.sessions[0].complete);
});

test('analyzeLines: multiple complete sessions', t => {
    const a = encodeText('a', { sessionId: 'AAAAAA' });
    const b = encodeText('b', { sessionId: 'BBBBBB' });
    const report = analyzeLines([...a, ...b]);
    t.true(report.ok);
    t.is(report.sessions.length, 2);
    t.true(report.sessions.every(s => s.complete));
});

test('analyzeLines: detects missing chunks', t => {
    const lines = encodeText('x'.repeat(200), { maxLen: 40 });
    const report = analyzeLines(lines.slice(0, -1));
    const s = report.sessions[0];
    t.false(s.complete);
    t.deepEqual(s.missing, [s.expectedTotal - 1]);
});

test('analyzeLines: detects duplicates', t => {
    const lines = encodeText('x'.repeat(200), { maxLen: 40 });
    const report = analyzeLines([...lines, lines[0]]);
    t.deepEqual(report.sessions[0].duplicates, [0]);
});

test('analyzeLines: detects total mismatch', t => {
    const lines = [
        formatChunk({
            session: 'AbCd12',
            index: 0,
            total: 3,
            bytes: new Uint8Array([1]),
        }),
        formatChunk({
            session: 'AbCd12',
            index: 1,
            total: 4,
            bytes: new Uint8Array([2]),
        }),
    ];
    const s = analyzeLines(lines).sessions[0];
    t.true(s.totalMismatch);
    t.false(s.complete);
});

test('analyzeLines: classifies totally malformed lines', t => {
    const report = analyzeLines(['short', 'abc!defxxxx', 42]);
    t.is(report.sessions.length, 0);
    t.is(report.malformed.length, 3);
    t.false(report.ok);
});

test('analyzeLines: records per-session errors', t => {
    const line = encodeText('hello', { sessionId: 'AbCd12' })[0];
    const tampered = line.slice(0, 10) + '!' + line.slice(11);
    const s = analyzeLines([tampered]).sessions[0];
    t.is(s.sessionId, 'AbCd12');
    t.false(s.complete);
    t.is(s.errors.length, 1);
});

test('analyzeLines: chunks are sorted by index', t => {
    const lines = encodeText('x'.repeat(200), { maxLen: 40 });
    const s = analyzeLines([...lines].reverse()).sessions[0];
    t.deepEqual(
        s.chunks.map(c => c.index),
        [...Array(s.chunks.length).keys()]
    );
});

// ── filters ──────────────────────────────────────────────────────────────────

test('completeSessions / incompleteSessions: filter the report', t => {
    const a = encodeText('a', { sessionId: 'AAAAAA' });
    const b = encodeText('x'.repeat(200), { maxLen: 40, sessionId: 'BBBBBB' });
    const report = analyzeLines([...a, ...b.slice(0, -1)]);
    t.deepEqual(
        completeSessions(report).map(s => s.sessionId),
        ['AAAAAA']
    );
    t.deepEqual(
        incompleteSessions(report).map(s => s.sessionId),
        ['BBBBBB']
    );
});

test('analyzeItems: preserves source ids per session', t => {
    const text = 'x'.repeat(200);
    const a = encodeText(text, { maxLen: 40, sessionId: 'AAAAAA' });
    const b = encodeText('hi', { sessionId: 'BBBBBB' });

    const rows = [
        ...a.map((chunk, i) => ({ id: 100 + i, chunk })),
        ...b.map((chunk, i) => ({ id: 200 + i, chunk })),
    ].sort(() => Math.random() - 0.5); // shuffle

    const report = analyzeItems(rows, { getLine: r => r.chunk });
    t.is(report.sessions.length, 2);

    const sessionA = report.sessions.find(s => s.sessionId === 'AAAAAA');
    t.true(sessionA.complete);
    t.is(sessionA.items.length, a.length);
    t.true(sessionA.items.every(r => r.id >= 100 && r.id < 200));
});

test('analyzeItems: malformed items carry .item', t => {
    const report = analyzeItems([{ id: 1, chunk: '!!!', extra: 'keep me' }], {
        getLine: r => r.chunk,
    });
    t.is(report.malformed.length, 1);
    t.is(report.malformed[0].item.id, 1);
    t.is(report.malformed[0].item.extra, 'keep me');
});

test('analyzeItems: rejects non-array', t => {
    t.throws(() => analyzeItems('nope', { getLine: () => '' }), {
        instanceOf: TypeError,
    });
});
