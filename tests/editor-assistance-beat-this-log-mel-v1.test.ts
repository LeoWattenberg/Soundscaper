/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_BEAT_THIS_HOP_SAMPLES,
	ASSISTANCE_BEAT_THIS_MEL_BINS,
	createAssistanceBeatThisLogMelV1,
	createAssistanceBeatThisLogMelRangeV1,
	type AssistanceBeatThisPcmSourceV1,
} from '../src/common/editor/assistance/beat-this-log-mel-v1.ts';

test('Beat This log-mel preprocessing preserves the pinned zero-input geometry', async () => {
	const result = await createAssistanceBeatThisLogMelV1(new Float32Array(1_024));

	assert.equal(result.frameCount, 3);
	assert.equal(result.melBins, ASSISTANCE_BEAT_THIS_MEL_BINS);
	assert.equal(result.values.length, 3 * ASSISTANCE_BEAT_THIS_MEL_BINS);
	assert.ok(result.values.every((value) => value === 0));
});

test('Beat This log-mel preprocessing is deterministic, finite, and input-immutable', async () => {
	const samples = new Float32Array(1_500);
	samples[512] = 0.75;
	const original = new Float32Array(samples);
	const left = await createAssistanceBeatThisLogMelV1(samples);
	const right = await createAssistanceBeatThisLogMelV1(samples);

	assert.deepEqual(samples, original);
	assert.deepEqual(left, right);
	assert.ok(left.values.some((value) => value > 0));
	assert.ok(left.values.every(Number.isFinite));
});

test('Beat This log-mel preprocessing rejects unreviewable PCM and observes cancellation', async () => {
	await assert.rejects(createAssistanceBeatThisLogMelV1(new Float32Array(512)),
		/reflect|sample|length/iu);
	const invalid = new Float32Array(1_024);
	invalid[0] = Number.NaN;
	await assert.rejects(createAssistanceBeatThisLogMelV1(invalid), /finite|sample/iu);

	const controller = new AbortController();
	controller.abort(new DOMException('cancelled', 'AbortError'));
	await assert.rejects(createAssistanceBeatThisLogMelV1(
		new Float32Array(1_024), controller.signal,
	), { name: 'AbortError' });
});

test('Beat This ranged preprocessing is exactly equal to whole-body preprocessing', async () => {
	const samples = new Float32Array(4_096);
	for (let index = 0; index < samples.length; index += 1) {
		samples[index] = Math.fround(Math.sin(index / 37) * 0.25);
	}
	const reads: Array<readonly [number, number]> = [];
	const source: AssistanceBeatThisPcmSourceV1 = Object.freeze({
		sampleCount: samples.length,
		async readSamples(startSample: number, sampleCount: number) {
			reads.push([startSample, sampleCount]);
			return samples.slice(startSample, startSample + sampleCount);
		},
	});
	const whole = await createAssistanceBeatThisLogMelV1(samples);
	const ranged = await createAssistanceBeatThisLogMelRangeV1(
		source, 0, whole.frameCount,
	);

	assert.deepEqual(ranged, whole);
	assert.equal(reads.length, 1);
	assert.ok(reads.every(([, sampleCount]) => sampleCount <= 4_096));
});

test('Beat This ranged preprocessing admits sparse media beyond ten minutes without whole reads', async () => {
	const sampleCount = 11 * 60 * 22_050;
	const lastFrame = Math.floor(sampleCount / ASSISTANCE_BEAT_THIS_HOP_SAMPLES) - 2;
	const reads: Array<readonly [number, number]> = [];
	const source: AssistanceBeatThisPcmSourceV1 = Object.freeze({
		sampleCount,
		async readSamples(startSample: number, count: number) {
			reads.push([startSample, count]);
			return new Float32Array(count);
		},
	});
	const ranged = await createAssistanceBeatThisLogMelRangeV1(source, lastFrame, 2);

	assert.equal(ranged.frameCount, 2);
	assert.ok(ranged.values.every((value) => value === 0));
	assert.deepEqual(reads, [[lastFrame * ASSISTANCE_BEAT_THIS_HOP_SAMPLES - 512, 1_394]]);
	assert.ok(reads[0]![1] < sampleCount / 1_000);
});

test('Beat This single-frame ranges preserve both reflect-padded edge samples', async () => {
	const samples = new Float32Array(441 * 4);
	samples[512] = 0.5;
	samples[samples.length - 513] = -0.25;
	const source: AssistanceBeatThisPcmSourceV1 = Object.freeze({
		sampleCount: samples.length,
		readSamples: (startSample: number, count: number) => Promise.resolve(
			samples.slice(startSample, startSample + count),
		),
	});
	const whole = await createAssistanceBeatThisLogMelV1(samples);
	const first = await createAssistanceBeatThisLogMelRangeV1(source, 0, 1);
	const last = await createAssistanceBeatThisLogMelRangeV1(source, whole.frameCount - 1, 1);

	assert.deepEqual(first.values, whole.values.slice(0, 128));
	assert.deepEqual(last.values, whole.values.slice(-128));
});
