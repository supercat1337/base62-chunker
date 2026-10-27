// @ts-check

import test from 'ava';

import { chunksFromLines, decodeText, encodeText, joinChunks } from '../src/index.js';

test('decodeText: roundtrips simple ASCII', t => {
    t.is(decodeText(encodeText('Hello, World!')), 'Hello, World!');
});

test('decodeText: roundtrips Cyrillic', t => {
    t.is(decodeText(encodeText('Привет, мир!')), 'Привет, мир!');
});

test('decodeText: accepts shuffled lines', t => {
    const text = 'reorder '.repeat(20);
    const lines = encodeText(text, { maxLen: 40 });
    t.is(decodeText([...lines].reverse()), text);
});

test('chunksFromLines: rejects malformed line', t => {
    const lines = encodeText('hello');
    t.throws(() => chunksFromLines([lines[0].slice(0, 8) + '!!!' + lines[0].slice(11)]));
});

test('joinChunks: rejects session mismatch', t => {
    const a = chunksFromLines(encodeText('a', { sessionId: 'AAAAAA' }));
    const b = chunksFromLines(encodeText('b', { sessionId: 'BBBBBB' }));
    t.throws(() => joinChunks([a[0], b[0]]), { message: /Session id mismatch/ });
});

test('decodeText: rejects missing chunk', t => {
    const lines = encodeText('x'.repeat(200), { maxLen: 40 });
    t.throws(() => decodeText(lines.slice(0, -1)), { message: /Expected \d+ chunks/ });
});
