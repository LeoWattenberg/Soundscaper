/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorSignalRenderer } from '../src/common/editor/signal-generator-renderer.ts';

test('separate unseeded Noise jobs produce independent recordings', () => {
	const first = noise();
	const second = noise();
	let cross = 0;
	let firstPower = 0;
	let secondPower = 0;
	for (let frame = 0; frame < first.length; frame++) {
		const a = first[frame] ?? 0;
		const b = second[frame] ?? 0;
		cross += a * b;
		firstPower += a * a;
		secondPower += b * b;
	}
	assert.ok(firstPower > 1000 && secondPower > 1000, 'both jobs produce audible noise');
	assert.ok(Math.abs(cross / Math.sqrt(firstPower * secondPower)) < .05,
		'independently requested Noise must not replay the same recording');
});

test('explicit noise seeds remain reproducible across streamed block boundaries', () => {
	const whole = noise({ seed: 42 });
	const renderer = createAudioEditorSignalRenderer('noise', { sampleRate: 48_000,
		durationSeconds: 1, amplitude: .8, color: 'white', seed: 42 });
	const streamed = new Float32Array(renderer.frameCount);
	let offset = 0;
	for (let block = renderer.next(137); block; block = renderer.next(137)) {
		assert.ok(block[0]);
		streamed.set(block[0], offset);
		offset += block[0].length;
	}
	assert.deepEqual(streamed, whole);
});

function noise(options: Readonly<Record<string, unknown>> = {}): Float32Array {
	const renderer = createAudioEditorSignalRenderer('noise', {
		sampleRate: 48_000, durationSeconds: 1, amplitude: .8, color: 'white', ...options,
	});
	const samples = renderer.next(renderer.frameCount)?.[0];
	assert.ok(samples);
	return samples;
}
