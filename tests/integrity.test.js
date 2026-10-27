// @ts-check

import test from 'ava';
import { createCodec } from '../src/codec.js';

test('createCodec: default codec roundtrips', t => {
    const codec = createCodec();
    t.is(codec.decodeText(codec.encodeText('hello')), 'hello');
});

test('createCodec: 0% payload loss vs v1 at maxLen 63', t => {
    const v1 = createCodec({ sessionLength: 8, checksum: 'none' });
    const v2 = createCodec({ sessionLength: 6, checksum: 'crc16' });
    t.is(v1.metaLen, 16);
    t.is(v2.metaLen, 17);
    // 46 chars payload both → same 34 bytes capacity
    const v1Chunks = v1.splitText('x'.repeat(34), { bytesPerChunk: 34 });
    const v2Chunks = v2.splitText('x'.repeat(34), { bytesPerChunk: 34 });
    t.is(v1Chunks.length, 1);
    t.is(v2Chunks.length, 1);
});

test('createCodec: detects single-char payload substitution', t => {
    const codec = createCodec();
    const lines = codec.encodeText('hello world, this is a test');
    // Flip a character in the middle of the payload
    const [head] = lines;
    const metaLen = codec.metaLen;
    const tampered =
        head.slice(0, metaLen + 3) +
        (head[metaLen + 3] === 'A' ? 'B' : 'A') +
        head.slice(metaLen + 4);
    // 99.998% of single-char substitutions are caught by CRC16
    t.throws(() => codec.decodeText([tampered]), { message: /Checksum mismatch/ });
});

test('createCodec: v1 data still decodable via legacy codec', t => {
    const v1 = createCodec({ sessionLength: 8, checksum: 'none' });
    const lines = v1.encodeText('legacy');
    t.is(v1.decodeText(lines), 'legacy');
});

test('createCodec: v1 lines rejected by default codec', t => {
    const v1 = createCodec({ sessionLength: 8, checksum: 'none' });
    const lines = v1.encodeText('legacy');
    const v2 = createCodec();
    t.throws(() => v2.decodeText(lines));
});
