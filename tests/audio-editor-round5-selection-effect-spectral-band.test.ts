/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudioSelectionEffectAsync, estimateAudioSelectionEffectPeakBytes } from '../src/common/editor/selection-effects.js';
import { createSelectionEffectWorkerService } from '../src/common/editor/controller/effects/internal/selection-effect-worker-service.ts';
import { applyReviewedUtilityGainSelection } from '../src/common/editor/reviewed-effects/selection-effect.ts';
import { initializePffft } from '../src/common/editor/pffft.js';
import { applySpectralGain } from '../src/common/editor/spectral-edit.js';
import { EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST, EDITOR_SELECTION_EFFECTS_RUNTIME_CHUNK_TEST } from '../scripts/lib/build-chunk-tests.mjs';

const sampleRate = 48_000;
const spectralSelection = { minimumFrequency: 900, maximumFrequency: 1100, windowSize: 2048 };
const cases: readonly Readonly<{ type: string; params: Readonly<Record<string, unknown>> }>[] = [
	{ type: 'reviewed-utility-gain', params: { gain: 0 } },
	{ type: 'bitcrusher', params: { bitDepth: 1 } },
	{ type: 'deesser', params: { frequency: 1000, threshold: -60, reduction: 24 } },
	{ type: 'multiband-compressor', params: { lowRatio: 1, midRatio: 1, highRatio: 1,
		lowGain: -12, midGain: -12, highGain: -12 } },
];

for (const { type, params } of cases) {
	test(`${type} retains unselected audio beside a destructive spectral band`, async () => {
		const input = tones();
		const original = input.slice();
		const output = await applyAudioSelectionEffectAsync(type, [input], sampleRate, params, { spectralSelection });
		assert.equal(output.length, 1);
		assert.equal(output[0]?.length, input.length);
		assert.deepEqual(input, original);
		assert.ok(Math.abs(amplitude(output[0]!, 6000) - 0.2) < 0.001, 'unselected 6 kHz tone stays at its original amplitude');
		assert.ok(Math.abs(amplitude(output[0]!, 1000) - 0.2) > 0.02, 'the selected 1 kHz tone is processed');
	});
}

test('the dedicated reviewed selection owner retains the same spectral context', async () => {
	const service = createSelectionEffectWorkerService({
		state: { audacityEffectWorker: null, spectralWorker: null },
		copy: { effectProcessingFailed: 'Processing failed' },
		workerAvailable: () => false,
		captureProject: () => ({ generation: 1, projectId: 'project' }), assertProject() {},
		loadParametricEqWasmModule: async () => null, initializePffft,
		captureNoiseProfile: () => null, applySpectralGain,
		applySelectionEffect: applyAudioSelectionEffectAsync,
		applyReviewedSelectionEffect: applyReviewedUtilityGainSelection,
	});
	try {
		const result = await service.runSelectionEffectWorker({ operation: 'apply',
			effectType: 'reviewed-utility-gain', channels: [tones()], sampleRate, params: { gain: 0 },
			context: { spectralSelection } });
		assert.ok(result.channels?.[0]);
		assert.ok(Math.abs(amplitude(result.channels[0], 6000) - 0.2) < 0.001);
		assert.ok(amplitude(result.channels[0], 1000) < 0.01);
	} finally { service.cancelWorkers(); }
});

test('spectral selection peak admission includes the replacement and FFT scratch', () => {
	for (const { type, params } of cases) {
		const base = estimateAudioSelectionEffectPeakBytes(type, 48_000, params, { channelCount: 1 });
		const spectral = estimateAudioSelectionEffectPeakBytes(type, 48_000, params,
			{ channelCount: 1, spectralWindowSize: 2048 });
		assert.ok(spectral >= base + 48_000 * (4 + 8 * 2) + 2048 * 8 * 5, type);
		assert.throws(() => estimateAudioSelectionEffectPeakBytes(type, 48_000, params,
			{ channelCount: 1, spectralWindowSize: 1000 }), /power of two/u);
	}
});

test('the spectral compositor stays with its lazy spectral primitive owner', () => {
	const path = 'src/common/editor/selection-effect-spectral-context.ts';
	for (const candidate of [path, path.replaceAll('/', '\\')]) {
		assert.equal(EDITOR_SELECTION_EFFECTS_RUNTIME_CHUNK_TEST.test(candidate), false);
		assert.ok(EDITOR_OPTIONAL_EXECUTION_CHUNK_TEST.test(candidate));
	}
});

function tones(): Float32Array {
	return Float32Array.from({ length: sampleRate }, (_, frame) => 0.2 * (
		Math.sin(2 * Math.PI * 1000 * frame / sampleRate) + Math.sin(2 * Math.PI * 6000 * frame / sampleRate)));
}

function amplitude(samples: Float32Array, frequency: number): number {
	let real = 0;
	let imaginary = 0;
	for (let frame = 9600; frame < 38_400; frame++) {
		const phase = 2 * Math.PI * frequency * frame / sampleRate;
		real += samples[frame]! * Math.cos(phase);
		imaginary += samples[frame]! * Math.sin(phase);
	}
	return 2 * Math.hypot(real, imaginary) / 28_800;
}
