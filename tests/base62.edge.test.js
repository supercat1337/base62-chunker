// @ts-check

import test from 'ava';

import { base62ToBytes, decodeNumber, encodeNumber } from '../src/base62.js';

// encodeNumber: invalid inputs (non-integer / negative)
test('encodeNumber: rejects negative values', t => {
    t.throws(() => encodeNumber(-1, 3), { instanceOf: RangeError });
});

test('encodeNumber: rejects non-integer values', t => {
    t.throws(() => encodeNumber(1.5, 3), { instanceOf: RangeError });
});

test('encodeNumber: rejects NaN', t => {
    t.throws(() => encodeNumber(NaN, 3), { instanceOf: RangeError });
});

// decodeNumber: invalid characters (both ASCII and non-ASCII)
test('decodeNumber: rejects non-ASCII characters', t => {
    t.throws(() => decodeNumber('é'), { message: /Invalid base62/ });
});

// base62ToBytes: invalid characters
test('base62ToBytes: rejects ASCII non-base62 characters', t => {
    t.throws(() => base62ToBytes('!', 1), { message: /Invalid base62/ });
});

test('base62ToBytes: rejects non-ASCII characters', t => {
    t.throws(() => base62ToBytes('é', 1), { message: /Invalid base62/ });
});
