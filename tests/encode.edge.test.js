// @ts-check

import test from 'ava';

import { DEFAULT_CONFIG } from '../src/config.js';
import { encodeText, splitText } from '../src/encode.js';

const { maxByteCount, maxTotal, metaLength } = DEFAULT_CONFIG;

test('splitText: rejects non-string text', t => {
    t.throws(() => splitText(/** @type {any} */ (123)), { instanceOf: TypeError });
});

test('splitText: rejects bytesPerChunk = 0', t => {
    t.throws(() => splitText('x', { bytesPerChunk: 0 }), {
        message: /positive integer/,
    });
});

test('splitText: rejects bytesPerChunk = 1.5', t => {
    t.throws(() => splitText('x', { bytesPerChunk: 1.5 }), {
        message: /positive integer/,
    });
});

test('splitText: rejects bytesPerChunk > maxByteCount', t => {
    t.throws(() => splitText('x', { bytesPerChunk: maxByteCount + 1 }), {
        message: /exceeds the \d+-byte limit/,
    });
});

test('splitText: rejects non-integer maxLen', t => {
    t.throws(() => splitText('x', { maxLen: 1.5 }), {
        message: /maxLen must be an integer/,
    });
});

test('splitText: rejects maxLen <= metaLength', t => {
    t.throws(() => splitText('x', { maxLen: metaLength }), {
        message: /must be greater than META_LEN/,
    });
});

test('splitText: rejects maxLen too small for any payload', t => {
    t.throws(() => splitText('x', { maxLen: metaLength + 1 }), {
        message: /too small for any payload/,
    });
});

test('splitText: rejects maxLen too large', t => {
    t.throws(() => splitText('x', { maxLen: 10000 }), {
        message: /too large/,
    });
});

test('encodeText: rejects text that would exceed maxTotal chunks', t => {
    // One byte per chunk → MAX_TOTAL + 1 chunks needed
    const text = 'a'.repeat(maxTotal + 1);
    t.throws(() => encodeText(text, { bytesPerChunk: 1 }), {
        message: /chunks exceed/,
    });
});
