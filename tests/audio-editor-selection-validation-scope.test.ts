/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { withValidatedSelectionInput, type SelectionInputValidation } from '../src/common/editor/audacity-effects/pcm-channel-validation.ts';
import { applyStandardEffect } from '../src/common/editor/first-party-effects/standard/dsp.ts';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects-runtime.js';
import { loadParametricEqWasmModule } from '../src/common/editor/parametric-eq/wasm-loader.js';

test('immediate standard and band dispatch validates each public input without a second DSP finite scan', async () => {
	for (const type of ['tremolo', 'noise-gate', 'deesser', 'multiband-compressor']) {
		const channels = [Float32Array.from({ length: 513 }, (_, index) => Math.sin(index * 0.017) * 0.3)];
		let scans = 0;
		Object.defineProperty(channels[0], 'every', { value: function(this: Float32Array,
			predicate: (sample: number, index: number, array: Float32Array) => unknown) {
			scans += 1;
			return Float32Array.prototype.every.call(this, predicate);
		} });
		const output = await applyAudioSelectionEffectAsync(type, channels, 48_000);
		assert.equal(scans, 0, type);
		assert.equal(output[0]!.length, 513);
		assert.ok(output[0]!.every(Number.isFinite));
	}
});

test('expired or mismatched input validation tokens never admit subsequently mutated PCM', () => {
	const channels = [new Float32Array(16)];
	let expired: SelectionInputValidation | undefined;
	withValidatedSelectionInput(channels, (input, token) => {
		expired = token;
		const other = [new Float32Array([NaN])];
		assert.throws(() => applyStandardEffect('tremolo', other, 48_000, {}, undefined, token), /samples must be finite/);
		return applyStandardEffect('tremolo', input, 48_000, {}, undefined, token);
	});
	channels[0]![15] = Infinity;
	assert.throws(() => applyStandardEffect('tremolo', channels, 48_000, {}, undefined, expired), /samples must be finite/);
});

test('selection dispatch keeps the original nonfinite sample error and channel geometry boundary', async () => {
	await assert.rejects(applyAudioSelectionEffectAsync('tremolo', [new Float32Array([0, NaN])], 48_000),
		{ name: 'RangeError', message: 'Audacity effect output channel 0 contains a non-finite sample at frame 1.' });
	await assert.rejects(applyAudioSelectionEffectAsync('deesser', [new Float32Array(2), new Float32Array(1)], 48_000),
		{ name: 'RangeError', message: 'Audacity effect output channels must have matching lengths.' });
});

test('EQ retains input and complete WASM output validation without rescanning the exact output slice', async () => {
	const wasmModule = await loadParametricEqWasmModule();
	const scans: number[] = [];
	for (const frames of [17, 31]) {
		const input = Float32Array.from({ length: frames }, (_, index) => index / 100);
		const isFinite = Number.isFinite;
		let checks = 0;
		const spy = mock.method(Number, 'isFinite', (value: unknown) => { checks += 1; return isFinite(value); });
		let output: Float32Array[];
		try {
			output = await applyAudioSelectionEffectAsync('eq', [input], 48_000, { outputGain: 0, bands: [] },
				{ wasmModule, beforeChannels: [new Float32Array(8)] });
		} finally { spy.mock.restore(); }
		assert.deepEqual(output, [input]);
		scans.push(checks);
	}
	assert.equal(scans[1]! - scans[0]!, 2 * (31 - 17), 'exactly one input and one complete output finite scan');
});
