// @ts-check

import test from 'ava';

import { chunksFromLines, decodeText, joinChunks } from '../src/decode.js';
import { encodeText } from '../src/encode.js';

test('joinChunks: rejects empty array', t => {
    t.throws(() => joinChunks([]), { instanceOf: TypeError });
});

test('joinChunks: rejects non-array', t => {
    t.throws(() => joinChunks(/** @type {any} */ ('nope')), { instanceOf: TypeError });
});

test('joinChunks: rejects null chunk', t => {
    t.throws(() => joinChunks(/** @type {any} */ ([null])), { message: /is not an object/ });
});

test('joinChunks: rejects chunk whose bytes are not Uint8Array', t => {
    t.throws(
        () => joinChunks(/** @type {any} */ ([{ session: 'AbCd12', index: 0, total: 1, bytes: [] }])),
        { message: /bytes is not a Uint8Array/ }
    );
});

test('joinChunks: rejects total mismatch', t => {
    const a = { session: 'AbCd12', index: 0, total: 2, bytes: new Uint8Array([1]) };
    const b = { session: 'AbCd12', index: 1, total: 3, bytes: new Uint8Array([2]) };
    t.throws(() => joinChunks([a, b]), { message: /Total chunks mismatch/ });
});

test('joinChunks: rejects gap in indices', t => {
    const a = { session: 'AbCd12', index: 0, total: 2, bytes: new Uint8Array([1]) };
    const b = { session: 'AbCd12', index: 2, total: 2, bytes: new Uint8Array([2]) };
    t.throws(() => joinChunks([a, b]), { message: /Missing chunk with index 1/ });
});

test('chunksFromLines: rejects empty array', t => {
    t.throws(() => chunksFromLines([]), { instanceOf: TypeError });
});

test('chunksFromLines: rejects non-array', t => {
    t.throws(() => chunksFromLines(/** @type {any} */ ('nope')), { instanceOf: TypeError });
});

test('decodeText: rejects empty input', t => {
    t.throws(() => decodeText([]), { instanceOf: TypeError });
});

test('decodeText: empty-text roundtrip', t => {
    t.is(decodeText(encodeText('')), '');
});
