/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaybackPreviewEngines } from '../src/common/editor/controller/composition/internal/playback-preview-engines.ts';

test('source, bin and take auditions inherit listening volume and follow live changes', () => {
	let gain = 0;
	const previews = createPlaybackPreviewEngines((name: string) => ({
		name, gain: 1, setPlaybackGain(value: number) { this.gain = value; }, dispose() {},
	}), () => gain);
	const source = previews.create('source');
	const bin = previews.create('bin');
	assert.equal(source.gain, 0);
	assert.equal(bin.gain, 0);
	gain = 0.25;
	previews.setGain(gain);
	assert.equal(source.gain, 0.25);
	assert.equal(bin.gain, 0.25);
	const take = previews.create('take');
	assert.equal(take.gain, 0.25);
	previews.setGain(0);
	assert.equal(take.gain, 0);
});

test('a retired audition no longer receives listening changes', async () => {
	let disposalCount = 0;
	const previews = createPlaybackPreviewEngines(() => ({
		gain: 1, setPlaybackGain(value: number) { this.gain = value; },
		dispose: () => { disposalCount += 1; return Promise.resolve(); },
	}), () => 0.5);
	const retired = previews.create();
	const active = previews.create();
	await retired.dispose();
	previews.setGain(0.1);
	assert.equal(retired.gain, 0.5);
	assert.equal(active.gain, 0.1);
	assert.equal(disposalCount, 1);
});
