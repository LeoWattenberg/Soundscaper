/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { audioBufferChannels } from '../src/common/editor/controller/source/source-audio.ts';
import type { PlanarPcm } from '../src/common/editor/rendered-audio-channels.ts';

void test('rendered planar PCM exposes its channels without changing the renderer inventory', () => {
	const channel = new Float32Array([0.25, -0.5]);
	const rendered: PlanarPcm = { channels: [channel] };
	const channels = audioBufferChannels(rendered);
	assert.equal(channels[0], channel);
	channels.push(new Float32Array(2));
	assert.equal(rendered.channels.length, 1);
});

void test('Web Audio channel reads retain their borrowed channel views', () => {
	const channel = new Float32Array([0.25, -0.5]);
	const channels = audioBufferChannels({ numberOfChannels: 1,
		getChannelData: () => channel,
	});
	assert.equal(channels[0], channel);
});

void test('array-like software channels become Float32Array views accepted by effect processing', () => {
	const channels = audioBufferChannels({ channels: [[0.25, -0.5]] });
	assert.ok(channels[0] instanceof Float32Array);
	assert.deepEqual(Array.from(channels[0]), [0.25, -0.5]);
});
