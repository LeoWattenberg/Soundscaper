/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorSignalRenderer } from '../src/common/editor/signal-generator-renderer.ts';
import { calculateAudioSpectrum } from '../src/common/editor/audio-spectrum.ts';

test('Morse evaluates its raised-cosine ramp only at keying edges', (context) => {
	const original = Math.cos;
	let calls = 0;
	context.mock.method(Math, 'cos', (value: number) => { calls++; return original(value); });
	const renderer = createAudioEditorSignalRenderer('morse', { sampleRate: 8000, wordsPerMinute: 20, text: 'E' });
	renderer.next(renderer.frameCount);
	assert.equal(calls, 78);
});

test('spectrum Hann coefficients are retained privately for repeated FFT geometry', (context) => {
	const original = Math.cos;
	let calls = 0;
	context.mock.method(Math, 'cos', (value: number) => { calls++; return original(value); });
	const channels = [new Float32Array(64)];
	const first = calculateAudioSpectrum(channels, 48000, { size: 64 });
	const initialCalls = calls;
	const second = calculateAudioSpectrum(channels, 48000, { size: 64 });
	assert.deepEqual(second, first);
	assert.notEqual(second, first);
	// The transform still designs its six roots; only Hann cosines disappear.
	assert.equal(calls - initialCalls, 6);
	assert.throws(() => calculateAudioSpectrum(channels, 48000, { size: 65 }), /power of two/);
});
