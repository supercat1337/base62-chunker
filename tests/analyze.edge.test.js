// @ts-check

import test from 'ava';

import { analyzeLines, completeSessions, incompleteSessions } from '../src/analyze.js';
import { formatChunk } from '../src/chunk.js';
import { encodeText } from '../src/encode.js';

test('analyzeLines: rejects non-array input', t => {
    t.throws(() => analyzeLines('nope'), { instanceOf: TypeError });
});

test('analyzeLines: uses majority total when chunks disagree', t => {
    // mode([2, 2, 3]) → 2 (покрывает ветку count < bestCount)
    const mk = (index, total) =>
        formatChunk({
            session: 'AbCd12',
            index,
            total,
            bytes: new Uint8Array([index]),
        });
    const lines = [mk(0, 2), mk(1, 2), mk(2, 3)];
    const s = analyzeLines(lines).sessions[0];
    t.is(s.expectedTotal, 2);
    t.true(s.totalMismatch);
    t.false(s.complete);
});

test('analyzeLines: empty bucket (all lines failed) still yields a session', t => {
    // 17-char header: session(6) + index(3) + total(3) + count(2) + crc16(3)
    const head = 'AbCd12' + '000' + '001' + '05' + '000';
    const lines = [head + '!!!', head + '???', head + '###'];
    const s = analyzeLines(lines).sessions[0];
    t.is(s.sessionId, 'AbCd12');
    t.is(s.chunks.length, 0);
    t.is(s.expectedTotal, null);
    t.true(s.totalMismatch);
    t.false(s.complete);
    t.is(s.errors.length, 3);
});

test('analyzeLines: ok=false when any session is incomplete', t => {
    const lines = encodeText('x'.repeat(200), {
        maxLen: 40,
        sessionId: 'AAAAAA',
    });
    const report = analyzeLines(lines.slice(0, -1));
    t.false(report.ok);
});

test('completeSessions / incompleteSessions: mixed input', t => {
    const a = encodeText('first', { sessionId: 'AAAAAA' });
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

test('analyzeLines: reports present/missing/duplicates together', t => {
    // total=3, have [0, 0, 2] → missing 1, duplicate 0
    const mk = idx =>
        formatChunk({
            session: 'AbCd12',
            index: idx,
            total: 3,
            bytes: new Uint8Array([idx]),
        });
    const s = analyzeLines([mk(0), mk(0), mk(2)]).sessions[0];
    t.deepEqual(s.present, [0, 2]);
    t.deepEqual(s.missing, [1]);
    t.deepEqual(s.duplicates, [0]);
    t.false(s.complete);
});
