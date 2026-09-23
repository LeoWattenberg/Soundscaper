/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { reprojectPendingWaveform } from '../src/common/editor/ui/timeline/waveform-plan-continuity.ts';

const plan = {
	mode: 'summary', pixelWidth: 4, pixelsPerSample: 0.04,
	sourceId: 'source', waveformIdentity: 'original',
	startFrame: 0, endFrame: 100, frameCount: 100, peakBlockSize: 25,
	channels: [{
		minimum: new Float32Array([-0.1, -0.2, -0.3, -0.4]),
		maximum: new Float32Array([0.1, 0.2, 0.3, 0.4]),
		rms: new Float32Array([0.05, 0.1, 0.15, 0.2]),
	}],
};
const clip = {
	sourceId: 'source', waveformIdentity: 'original', trimStart: 0.5, duration: 0.5,
	waveformStartFrame: 50, waveformEndFrame: 100,
};

test('pending zoom crops a retained summary to the new frame range', () => {
	const result = reprojectPendingWaveform(plan, clip, 100, 4);
	assert.ok(result);
	assert.equal(result.startFrame, 50);
	assert.equal(result.endFrame, 100);
	assert.equal(result.mode, 'summary');
	const channel = result.channels[0];
	assert.ok(channel && 'maximum' in channel);
	assert.deepEqual(Array.from(channel.maximum), Array.from(new Float32Array([0.3, 0.3, 0.4, 0.4])));
});

test('pending zoom rejects changed source, edits, and nonoverlapping windows', () => {
	assert.equal(reprojectPendingWaveform(plan, { ...clip, sourceId: 'replacement' }, 100, 4), null);
	assert.equal(reprojectPendingWaveform(plan, { ...clip, waveformIdentity: 'edited' }, 100, 4), null);
	assert.equal(reprojectPendingWaveform(plan, { ...clip, waveformStartFrame: 200, waveformEndFrame: 300 }, 100, 4), null);
});

test('retained PCM samples keep their exact positions after the viewport moves', () => {
	const pcm = {
		...plan, mode: 'connecting-dots', pixelWidth: 100, pixelsPerSample: 1,
		channels: [{ firstSample: 0, firstSampleX: 0, samples: new Float32Array([0.1, 0.5, -0.5]) }],
	};
	const result = reprojectPendingWaveform(pcm, clip, 100, 200);
	assert.ok(result);
	assert.equal(result.pixelsPerSample, 4);
	const channel = result.channels[0];
	assert.ok(channel && 'firstSampleX' in channel);
	assert.equal(channel.firstSampleX, -200);
	assert.strictEqual(channel.samples, pcm.channels[0]?.samples);
});

test('zooming out preserves the covered part in place without stretching it into unseen audio', () => {
	const result = reprojectPendingWaveform(plan, { ...clip, waveformStartFrame: 0, waveformEndFrame: 200 }, 100, 8);
	assert.ok(result);
	const channel = result.channels[0];
	assert.ok(channel && 'maximum' in channel);
	assert.deepEqual(Array.from(channel.maximum), Array.from(new Float32Array([0.1, 0.2, 0.3, 0.4, 0, 0, 0, 0])));
});

test('reprojected frequency colors and bands follow the cropped audio window', async () => {
	const { reprojectPendingFrequencyWaveform } = await import('../src/common/editor/ui/timeline/frequency-waveform-continuity.ts');
	const projection = {
		sampleRate: 100, peakBlockSize: 25,
		bands: { low: plan, mid: plan, high: plan },
		centroidHz: new Float32Array([10, 20, 30, 40]),
		centroidWeight: new Float32Array([0.1, 0.2, 0.3, 0.4]),
	};
	const rendering = reprojectPendingWaveform(plan, clip, 100, 4);
	assert.ok(rendering);
	const result = reprojectPendingFrequencyWaveform(projection, rendering);
	assert.ok(result);
	assert.deepEqual(Array.from(result.centroidHz), [30, 30, 40, 40]);
	assert.deepEqual(result.bands.low.channels, rendering.channels);
	assert.strictEqual(reprojectPendingFrequencyWaveform(projection, plan), projection);
});
