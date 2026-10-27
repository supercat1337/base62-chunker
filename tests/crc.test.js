// @ts-check

import test from 'ava';
import { crc8, crc16, computeChecksum } from '../src/crc.js';

test("crc16: known vector '123456789' = 0x29B1", t => {
    t.is(crc16(new TextEncoder().encode('123456789')), 0x29b1);
});

test('crc16: empty input = 0xFFFF (initial value)', t => {
    t.is(crc16(new Uint8Array(0)), 0xffff);
});

test("crc8: known vector '123456789' = 0xA1", t => {
    t.is(crc8(new TextEncoder().encode('123456789')), 0xa1);
});

test('crc16: single-byte flip changes the checksum', t => {
    const a = crc16(new Uint8Array([1, 2, 3]));
    const b = crc16(new Uint8Array([1, 2, 4]));
    t.not(a, b);
});

test('computeChecksum: dispatch', t => {
    const bytes = new TextEncoder().encode('x');
    t.is(computeChecksum(bytes, 'crc8'), crc8(bytes));
    t.is(computeChecksum(bytes, 'crc16'), crc16(bytes));
});

test('computeChecksum: unknown algorithm throws', t => {
    t.throws(() => computeChecksum(new Uint8Array(), /** @type {any} */ ('x')), {
        message: /Unknown checksum/,
    });
});
