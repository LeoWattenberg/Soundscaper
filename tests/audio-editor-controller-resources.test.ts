/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ClipTimePitchRenderCacheCoordinator } from '../src/common/editor/clip-time-pitch-cache.js';
import { createControllerResources } from '../src/common/editor/controller/composition/controller-resources.ts';

const callbacks = {
	copy: { staffPadRangeWarning: '{stageCount} stages', ffmpegLoading: 'Loading' },
	onPosition() {}, onMeter() {}, onState() {}, setStatus() {}, updateExportProgress() {},
};

test('controller resources give workers owned PCM without detaching resident channel views', async () => {
	const resources = createControllerResources({}, callbacks);
	try {
		await resources.store.ready();
		const samples = Float32Array.of(0.25, -0.5);
		resources.sourceBuffers.set('source', {
			length: 2, numberOfChannels: 1, sampleRate: 48_000,
			getChannelData: () => samples,
		});
		assert.ok(resources.clipTimePitchCache instanceof ClipTimePitchRenderCacheCoordinator);
		const channels: Float32Array[] = await resources.clipTimePitchCache.loadSourceChannels({
			id: 'source', frameCount: 2, channelCount: 1,
		});
		assert.deepEqual(channels[0], samples);
		assert.notEqual(channels[0]?.buffer, samples.buffer);
		structuredClone(channels, { transfer: channels.map(channel => channel.buffer) });
		assert.deepEqual([...samples], [0.25, -0.5]);
	} finally {
		await resources.clipTimePitchCache.dispose?.();
		await resources.engine.dispose();
		resources.ffmpeg.dispose();
		resources.nyquistClient?.dispose();
		await resources.store.close();
	}
});

test('injected Nyquist evaluation does not construct a second client', async () => {
	const evaluate = async () => ({ output: 'injected' });
	const resources = createControllerResources({ nyquistEvaluator: evaluate }, callbacks);
	try {
		assert.equal(resources.nyquistClient, null);
		assert.equal(resources.nyquistEvaluator, evaluate);
	} finally {
		await resources.clipTimePitchCache.dispose?.();
		await resources.engine.dispose();
		resources.ffmpeg.dispose();
		await resources.store.close();
	}
});
