// @ts-check

import test from 'ava';

import { formatChunk, parseChunk } from '../src/chunk.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const { maxIndex, maxTotal, maxByteCount } = DEFAULT_CONFIG;

// ── validateSessionId (via formatChunk) ──────────────────────────────────────

test('formatChunk: rejects non-string session', t => {
    t.throws(
        () => formatChunk(/** @type {any} */ ({ session: 123, index: 0, total: 1, bytes: new Uint8Array() })),
        { message: /6-character string/ }
    );
});

test('formatChunk: rejects too-short session', t => {
    t.throws(() => formatChunk({ session: 'short', index: 0, total: 1, bytes: new Uint8Array() }), {
        message: /6-character string/,
    });
});

test('formatChunk: rejects non-base62 session', t => {
    t.throws(
        () => formatChunk({ session: '!!!!!!', index: 0, total: 1, bytes: new Uint8Array() }),
        { message: /base62 characters/ }
    );
});

// ── parseHeader (via parseChunk) ─────────────────────────────────────────────

test('parseChunk: rejects non-string input', t => {
    t.throws(() => parseChunk(/** @type {any} */ (123)), { instanceOf: TypeError });
});

test('parseChunk: rejects line shorter than metaLength', t => {
    t.throws(() => parseChunk('short'), { message: /shorter than the metadata header/ });
});

test('parseChunk: rejects non-base62 characters', t => {
    // 17-char header (valid), then '!' in payload
    t.throws(() => parseChunk('AAAAAA' + '000' + '001' + '00' + '000' + '!'), {
        message: /non-base62/,
    });
});

test('parseChunk: rejects total === 0', t => {
    // 17-char header: session(6) + index(3) + total(3) + count(2) + crc(3)
    t.throws(() => parseChunk('AAAAAA' + '000' + '000' + '00' + '000'), {
        message: /Invalid total \(0\)/,
    });
});

test('parseChunk: rejects index >= total', t => {
    t.throws(() => parseChunk('AAAAAA' + '005' + '003' + '00' + '000'), {
        message: /out of range/,
    });
});

test('parseChunk: rejects checksum mismatch', t => {
    // valid header, byteCount=1, payload 'A', crc=000 (wrong)
    t.throws(() => parseChunk('AAAAAA' + '000' + '001' + '01' + '000' + 'A'), {
        message: /Checksum mismatch/,
    });
});

// ── formatChunk validation ──────────────────────────────────────────────────

test('formatChunk: rejects non-object chunk', t => {
    t.throws(() => formatChunk(/** @type {any} */ (null)), { message: /must be an object/ });
});

test('formatChunk: rejects bytes that are not a Uint8Array', t => {
    t.throws(
        () => formatChunk(/** @type {any} */ ({ session: 'AbCd12', index: 0, total: 1, bytes: [] })),
        { message: /must be a Uint8Array/ }
    );
});

test('formatChunk: rejects negative index', t => {
    t.throws(
        () => formatChunk({ session: 'AbCd12', index: -1, total: 1, bytes: new Uint8Array() }),
        { message: /index must be in/ }
    );
});

test('formatChunk: rejects non-integer index', t => {
    t.throws(
        () => formatChunk({ session: 'AbCd12', index: 1.5, total: 2, bytes: new Uint8Array() }),
        { message: /index must be in/ }
    );
});

test('formatChunk: rejects index > maxIndex', t => {
    t.throws(
        () =>
            formatChunk({
                session: 'AbCd12',
                index: maxIndex + 1,
                total: maxTotal,
                bytes: new Uint8Array(),
            }),
        { message: /index must be in/ }
    );
});

test('formatChunk: rejects total === 0', t => {
    t.throws(
        () => formatChunk({ session: 'AbCd12', index: 0, total: 0, bytes: new Uint8Array() }),
        { message: /total must be in/ }
    );
});

test('formatChunk: rejects total > maxTotal', t => {
    t.throws(
        () =>
            formatChunk({
                session: 'AbCd12',
                index: 0,
                total: maxTotal + 1,
                bytes: new Uint8Array(),
            }),
        { message: /total must be in/ }
    );
});

test('formatChunk: rejects index >= total', t => {
    t.throws(
        () => formatChunk({ session: 'AbCd12', index: 5, total: 3, bytes: new Uint8Array() }),
        { message: /must be less than total/ }
    );
});

test('formatChunk: rejects bytes longer than maxByteCount', t => {
    t.throws(
        () =>
            formatChunk({
                session: 'AbCd12',
                index: 0,
                total: 1,
                bytes: new Uint8Array(maxByteCount + 1),
            }),
        { message: /exceeds the \d+-byte limit/ }
    );
});

test('formatChunk: rejects session starting with a digit', t => {
    t.throws(
        () => formatChunk({ session: '1AAAAA', index: 0, total: 1, bytes: new Uint8Array() }),
        { message: /start with a letter/ }
    );
});

test('parseChunk: rejects line whose session starts with a digit', t => {
    // Valid header shape but the session begins with '1'
    t.throws(() => parseChunk('1AAAAA' + '000' + '001' + '00' + '000'), {
        message: /start with a letter/,
    });
});
