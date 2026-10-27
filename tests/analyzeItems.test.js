// @ts-check

import test from 'ava';

import { analyzeItems, encodeText, formatChunk } from '../src/index.js';

// ── Input validation ────────────────────────────────────────────────────────

test('analyzeItems: rejects non-array items', t => {
    t.throws(() => analyzeItems(/** @type {any} */ ('nope'), { getLine: () => '' }), {
        instanceOf: TypeError,
    });
});

test('analyzeItems: rejects non-function getLine', t => {
    t.throws(
        () =>
            analyzeItems([], {
                // @ts-expect-error — on purpose
                getLine: null,
            }),
        { instanceOf: TypeError }
    );
});

// ── getLine error paths ─────────────────────────────────────────────────────

test('analyzeItems: getLine throwing Error lands in malformed with .item', t => {
    const item = { id: 42 };
    const report = analyzeItems([item], {
        getLine: () => {
            throw new Error('boom');
        },
    });
    t.is(report.malformed.length, 1);
    t.is(report.malformed[0].item, item);
    t.regex(report.malformed[0].reason, /getLine threw: boom/);
});

test('analyzeItems: getLine throwing non-Error uses String(err)', t => {
    const report = analyzeItems([{ id: 1 }], {
        getLine: () => {
            throw 'plain string'; // eslint-disable-line no-throw-literal
        },
    });
    t.is(report.malformed.length, 1);
    t.regex(report.malformed[0].reason, /getLine threw: plain string/);
});

test('analyzeItems: getLine returning non-string → malformed', t => {
    const report = analyzeItems([{ id: 1 }], {
        getLine: () => /** @type {any} */ (42),
    });
    t.is(report.malformed[0].reason, 'line is too short or not a string');
});

test('analyzeItems: getLine returning short string → malformed', t => {
    const report = analyzeItems([{ id: 1 }], { getLine: () => 'abc' });
    t.is(report.malformed[0].reason, 'line is too short or not a string');
});

test('analyzeItems: invalid session prefix → malformed', t => {
    const report = analyzeItems([{ id: 1 }], {
        getLine: () => '!!!abc1234567890',
    });
    t.is(report.malformed[0].reason, 'invalid session prefix');
});

// ── Parse error path ────────────────────────────────────────────────────────

test('analyzeItems: chunk parse error → session.errors, session still present', t => {
    const bad = { id: 1 };
    const line = 'AAAAAA' + '!'; // valid prefix, too short for the header
    const report = analyzeItems([bad], { getLine: () => line });
    t.is(report.sessions.length, 1);
    t.is(report.sessions[0].sessionId, 'AAAAAA');
    t.is(report.sessions[0].chunks.length, 0);
    t.is(report.sessions[0].errors.length, 1);
    t.is(report.sessions[0].errors[0].item, bad);
    t.false(report.sessions[0].complete);
    t.is(report.sessions[0].expectedTotal, null);
    t.true(report.sessions[0].totalMismatch);
});

// ── Happy path ──────────────────────────────────────────────────────────────

test('analyzeItems: complete session, items parallel to chunks', t => {
    const lines = encodeText('hello world', { sessionId: 'AAAAAA' });
    const rows = lines.map((chunk, id) => ({ id, chunk }));
    const report = analyzeItems(rows, { getLine: r => r.chunk });
    t.true(report.ok);
    t.true(report.sessions[0].complete);
    t.deepEqual(
        report.sessions[0].items.map(r => r.id),
        rows.map(r => r.id)
    );
});

test('analyzeItems: shuffled items sorted in lockstep with chunks', t => {
    const lines = encodeText('x'.repeat(200), {
        maxLen: 40,
        sessionId: 'AAAAAA',
    });
    const rows = lines.map((chunk, id) => ({ id, chunk }));
    const shuffled = [...rows].reverse();
    const report = analyzeItems(shuffled, { getLine: r => r.chunk });
    t.deepEqual(
        report.sessions[0].chunks.map(c => c.index),
        [...Array(rows.length).keys()]
    );
    t.deepEqual(
        report.sessions[0].items.map(r => r.id),
        [...Array(rows.length).keys()]
    );
});

// ── Detections ──────────────────────────────────────────────────────────────

test('analyzeItems: missing indices detected', t => {
    const lines = encodeText('x'.repeat(200), {
        maxLen: 40,
        sessionId: 'AAAAAA',
    });
    const rows = lines.map((chunk, id) => ({ id, chunk }));
    const report = analyzeItems(rows.slice(0, -1), { getLine: r => r.chunk });
    t.false(report.sessions[0].complete);
    t.is(report.sessions[0].missing.length, 1);
});

test('analyzeItems: duplicates detected', t => {
    const lines = encodeText('x'.repeat(200), {
        maxLen: 40,
        sessionId: 'AAAAAA',
    });
    const rows = lines.map((chunk, id) => ({ id, chunk }));
    const report = analyzeItems([...rows, rows[0]], { getLine: r => r.chunk });
    t.deepEqual(report.sessions[0].duplicates, [0]);
});

test('analyzeItems: total mismatch detected', t => {
    const lines = [
        formatChunk({ session: 'AAAAAA', index: 0, total: 2, bytes: new Uint8Array([1]) }),
        formatChunk({ session: 'AAAAAA', index: 1, total: 3, bytes: new Uint8Array([2]) }),
    ];
    const rows = lines.map((chunk, id) => ({ id, chunk }));
    const report = analyzeItems(rows, { getLine: r => r.chunk });
    t.true(report.sessions[0].totalMismatch);
    t.false(report.sessions[0].complete);
});

test('analyzeItems: mode tie → expectedTotal null, totalMismatch true', t => {
    // Two chunks, same session, different totals, each count 1 → tie.
    const lines = [
        formatChunk({ session: 'AAAAAA', index: 0, total: 2, bytes: new Uint8Array([1]) }),
        formatChunk({ session: 'AAAAAA', index: 1, total: 3, bytes: new Uint8Array([2]) }),
    ];
    const rows = lines.map((chunk, id) => ({ id, chunk }));
    const report = analyzeItems(rows, { getLine: r => r.chunk });
    t.is(report.sessions[0].expectedTotal, null);
    t.true(report.sessions[0].totalMismatch);
});

// ── Multiple sessions ───────────────────────────────────────────────────────

test('analyzeItems: multiple sessions demultiplexed', t => {
    const a = encodeText('a', { sessionId: 'AAAAAA' }).map((chunk, id) => ({
        id: `a${id}`,
        chunk,
    }));
    const b = encodeText('b', { sessionId: 'BBBBBB' }).map((chunk, id) => ({
        id: `b${id}`,
        chunk,
    }));
    const report = analyzeItems([...a, ...b], { getLine: r => r.chunk });
    t.is(report.sessions.length, 2);
    t.true(report.sessions.every(s => s.complete));
});

test('analyzeItems: sessions sorted by sessionId', t => {
    const b = encodeText('b', { sessionId: 'BBBBBB' }).map((chunk, id) => ({
        id,
        chunk,
    }));
    const a = encodeText('a', { sessionId: 'AAAAAA' }).map((chunk, id) => ({
        id,
        chunk,
    }));
    const report = analyzeItems([...b, ...a], { getLine: r => r.chunk });
    t.deepEqual(
        report.sessions.map(s => s.sessionId),
        ['AAAAAA', 'BBBBBB']
    );
});

// ── Custom fields ───────────────────────────────────────────────────────────

test('analyzeItems: arbitrary field names and nested access', t => {
    const lines = encodeText('hello', { sessionId: 'AAAAAA' });
    const rows = lines.map((chunk, id) => ({
        meta: { recordId: `uuid-${id}`, payload: { line: chunk } },
    }));
    const report = analyzeItems(rows, {
        getLine: r => r.meta.payload.line,
    });
    t.true(report.sessions[0].complete);
    t.is(report.sessions[0].items[0].meta.recordId, 'uuid-0');
});

// ── ok flag ─────────────────────────────────────────────────────────────────

test('analyzeItems: empty array → ok=true, no sessions', t => {
    const report = analyzeItems([], { getLine: () => '' });
    t.true(report.ok);
    t.deepEqual(report.sessions, []);
    t.deepEqual(report.malformed, []);
});

test('analyzeItems: ok=false when malformed present', t => {
    const good = encodeText('hi', { sessionId: 'AAAAAA' }).map((chunk, id) => ({
        id,
        chunk,
    }));
    const bad = [{ id: 99, chunk: '!!!' }];
    const report = analyzeItems([...good, ...bad], { getLine: r => r.chunk });
    t.false(report.ok);
    t.is(report.malformed.length, 1);
});

test('analyzeItems: ok=false when any session incomplete', t => {
    const lines = encodeText('x'.repeat(200), {
        maxLen: 40,
        sessionId: 'AAAAAA',
    });
    const rows = lines.map((chunk, id) => ({ id, chunk }));
    const report = analyzeItems(rows.slice(0, -1), { getLine: r => r.chunk });
    t.false(report.ok);
});
