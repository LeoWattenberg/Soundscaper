/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_BEAT_THIS_MEL_BINS,
	createAssistanceBeatThisLogMelV1,
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
