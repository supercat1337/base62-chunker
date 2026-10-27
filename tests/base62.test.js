// @ts-check

import test from 'ava';

import {
    ALPHABET,
    LETTERS,
    base62ToBytes,
    bytesToBase62,
    decodeNumber,
    encodeNumber,
    randomBase62,
} from '../src/base62.js';

test('ALPHABET: has 62 unique characters', t => {
    t.is(new Set(ALPHABET).size, 62);
});

test('encodeNumber: zero-pads to the requested width', t => {
    t.is(encodeNumber(0, 3), '000');
});

test('encodeNumber: roundtrips through decodeNumber', t => {
    t.is(decodeNumber(encodeNumber(12345, 3)), 12345);
});

test('encodeNumber: rejects values that do not fit', t => {
    t.throws(() => encodeNumber(62 ** 3, 3), { instanceOf: RangeError });
});

test('decodeNumber: rejects invalid characters', t => {
    t.throws(() => decodeNumber('a!b'), { message: /Invalid base62/ });
});

test('bytesToBase62: empty array yields empty string', t => {
    t.is(bytesToBase62(new Uint8Array()), '');
});

test('base62ToBytes: restores leading zero bytes', t => {
    const restored = base62ToBytes(bytesToBase62(new Uint8Array([0, 0, 42])), 3);
    t.deepEqual(restored, new Uint8Array([0, 0, 42]));
});

test('base62ToBytes: empty string yields N zero bytes', t => {
    // Contract: an all-zero chunk encodes to ""; the caller restores it
    // by passing the byte count from the metadata.
    t.deepEqual(base62ToBytes('', 3), new Uint8Array([0, 0, 0]));
});

test('base62ToBytes: rejects byte-count mismatch (too many bytes)', t => {
    // "A" = 10 → one byte, but we ask for zero.
    t.throws(() => base62ToBytes('A', 0), { message: /Byte count mismatch/ });
});

test('base62ToBytes: rejects byte-count mismatch (too few bytes)', t => {
    // "100" = 3844 → two bytes (0x0F 0x04), but we ask for one.
    t.throws(() => base62ToBytes('100', 1), { message: /Byte count mismatch/ });
});

test('randomBase62: has requested length', t => {
    t.is(randomBase62(8).length, 8);
});

test('randomBase62: emits base62-only characters', t => {
    t.true(/^[0-9A-Za-z]+$/.test(randomBase62(64)));
});

test('randomBase62: letter-first when given LETTERS', t => {
    const samples = Array.from({ length: 200 }, () => randomBase62(6, LETTERS));
    t.true(samples.every(s => /^[A-Za-z]/.test(s)));
});

test('randomBase62: still base62-only without firstCharAlphabet', t => {
    t.true(/^[0-9A-Za-z]+$/.test(randomBase62(64)));
});
