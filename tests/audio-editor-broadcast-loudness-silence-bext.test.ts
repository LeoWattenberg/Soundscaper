/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { measureBextLoudness } from '../src/common/editor/broadcast-loudness.ts';
import { encodeBextPayload, normalizeBextMetadata } from '../src/common/editor/broadcast-wave.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const SAMPLE_RATE = 48_000;
const LOUDNESS_SENTINEL = 0x7fff;
const OFFSETS = Object.freeze({
	loudnessValue: 412,
	loudnessRange: 414,
	maxTruePeakLevel: 416,
	maxMomentaryLoudness: 418,
	maxShortTermLoudness: 420,
});

test('a silent programme captures a not-measured true peak instead of an unencodable one', () => {
	const measurement = measureBextLoudness([new Float32Array(SAMPLE_RATE * 3)], SAMPLE_RATE);
	// The meter floors true peak at -120 dBTP, which no BEXT int16 field in
	// 0.01 dB units may carry as a measurement; EBU 3285 spells that case
	// 0x7fff, "not measured".
	assert.doesNotThrow(() => normalizeBextMetadata({ ...measurement }));
	assert.equal(measurement.maxTruePeakLevel, null);
	assert.equal(bextField(encodeBextPayload({ ...measurement }), 'maxTruePeakLevel'), LOUDNESS_SENTINEL);
});

test('a programme quieter than the BEXT range captures every loudness field as not measured', () => {
	const tone = Float32Array.from(
		{ length: SAMPLE_RATE * 3 },
		(_, frame) => 1e-6 * Math.sin(2 * Math.PI * 1_000 * frame / SAMPLE_RATE),
	);
	const measurement = measureBextLoudness([tone, tone], SAMPLE_RATE);
	assert.doesNotThrow(() => normalizeBextMetadata({ ...measurement }));
	const payload = encodeBextPayload({ ...measurement });
	for (const field of ['maxTruePeakLevel', 'maxMomentaryLoudness', 'maxShortTermLoudness'] as const) {
		assert.equal(bextField(payload, field), LOUDNESS_SENTINEL, `${field} must be the not-measured sentinel`);
	}
});

test('a silent BWF delivery writes its file rather than failing after the render', () => {
	const silence = new Float32Array(SAMPLE_RATE);
	const measurement = measureBextLoudness([silence], SAMPLE_RATE);
	let draws = 0;
	const bytes = encodeWav([silence], {
		sampleRate: SAMPLE_RATE, bitDepth: 24, bext: { ...measurement },
		random: () => (++draws % 2 === 1 ? 0.875 : 0.125),
	});
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
	assert.equal(new TextDecoder().decode(bytes.subarray(8, 12)), 'WAVE');
	assert.equal(view.getUint32(4, true), bytes.byteLength - 8);
	const bext = riffChunk(bytes, 'bext');
	assert.equal(view.getUint16(bext + 8 + OFFSETS.maxTruePeakLevel, true), LOUDNESS_SENTINEL);
	const data = riffChunk(bytes, 'data');
	assert.equal(view.getUint32(data + 4, true), SAMPLE_RATE * 3);
	assert.equal(bytes.byteLength, data + 8 + SAMPLE_RATE * 3);
	assert.equal(draws, SAMPLE_RATE * 2);
	assert.equal(bytes.subarray(data + 8).every((byte, index) => byte === (index % 3 === 0 ? 1 : 0)), true);
});

test('a measurable programme still carries its loudness numbers into the chunk', () => {
	const tone = Float32Array.from(
		{ length: SAMPLE_RATE * 4 },
		(_, frame) => 0.1 * Math.sin(2 * Math.PI * 1_000 * frame / SAMPLE_RATE),
	);
	const measurement = measureBextLoudness([tone, tone], SAMPLE_RATE);
	const payload = encodeBextPayload({ ...measurement });
	assert.notEqual(bextField(payload, 'maxTruePeakLevel'), LOUDNESS_SENTINEL);
	assert.equal(
		new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getInt16(OFFSETS.loudnessValue, true),
		Math.round(measurement.loudnessValue! * 100),
	);
});

function bextField(payload: Uint8Array, field: keyof typeof OFFSETS): number {
	return new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint16(OFFSETS[field], true);
}

function riffChunk(bytes: Uint8Array, id: string): number {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 12; offset + 8 <= bytes.byteLength;) {
		if (new TextDecoder().decode(bytes.subarray(offset, offset + 4)) === id) return offset;
		offset += 8 + view.getUint32(offset + 4, true) + (view.getUint32(offset + 4, true) & 1);
	}
	throw new Error(`Missing ${id} WAV chunk`);
}
