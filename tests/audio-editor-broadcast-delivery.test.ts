/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { measureBextLoudness } from '../src/common/editor/broadcast-loudness.ts';
import { createRiffInfoChunk, parseRiffInfo } from '../src/common/editor/riff-info.ts';
import { createWavHeader } from '../src/common/editor/wav.js';

test('BWF multichannel headers use WAVE_FORMAT_EXTENSIBLE PCM and a speaker mask', () => {
	const bytes = createWavHeader({ sampleRate: 48_000, channelCount: 6, totalFrames: 1, bitDepth: 24, bext: {} });
	const format = find(bytes, 'fmt ');
	const view = new DataView(bytes.buffer);
	assert.equal(view.getUint32(format + 4, true), 40);
	assert.equal(view.getUint16(format + 8, true), 0xfffe);
	assert.equal(view.getUint32(format + 28, true), 0x3f);
});

test('RIFF INFO carries common descriptive metadata without flattening unknown fields', () => {
	const chunk = createRiffInfoChunk({ title: 'Bulletin', artist: 'Newsroom', comments: 'Final', custom: 'ignored' });
	assert.equal(text(chunk, 0, 4), 'LIST');
	assert.equal(text(chunk, 8, 4), 'INFO');
	assert.deepEqual(parseRiffInfo([chunk.subarray(12, 8 + new DataView(chunk.buffer).getUint32(4, true))]), {
		title: 'Bulletin', artist: 'Newsroom', comments: 'Final',
	});
});

test('broadcast loudness measurement produces BEXT v2 field values from rendered PCM', () => {
	const sampleRate = 16_000;
	const tone = Float32Array.from({ length: sampleRate * 4 }, (_, frame) => 0.1 * Math.sin(2 * Math.PI * 1_000 * frame / sampleRate));
	const result = measureBextLoudness([tone, tone], sampleRate);
	assert.equal(Number.isFinite(result.loudnessValue), true);
	assert.equal(Number.isFinite(result.maxTruePeakLevel), true);
});

function find(bytes: Uint8Array, value: string): number {
	const target = new TextEncoder().encode(value);
	for (let offset = 0; offset <= bytes.length - target.length; offset += 1) {
		if (target.every((byte, index) => bytes[offset + index] === byte)) return offset;
	}
	return -1;
}

function text(bytes: Uint8Array, offset: number, length: number): string {
	return new TextDecoder().decode(bytes.subarray(offset, offset + length));
}
