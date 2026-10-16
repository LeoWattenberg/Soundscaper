/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectionEffectPreviewService } from '../src/common/editor/controller/effects/internal/effect-preview-service.ts';
import { mixNyquistPreviewChannels } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';
import { applyAudacityEffect } from '../src/common/editor/audacity-effects/index.js';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS, normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';

interface WorkerRequest {
	readonly effectType: string;
	readonly sampleRate: number;
	readonly channels: Float32Array[];
	readonly params: Readonly<Record<string, unknown>>;
}

for (const scenario of [
	{ name: 'peak', type: 'audacity-normalize', sampleRate: 48_000, params: {} },
	{ name: 'native-rate RMS', type: 'audacity-loudness-normalization', sampleRate: 32_000, params: { mode: 'rms' } },
	{ name: 'DC-only', type: 'audacity-normalize', sampleRate: 48_000, params: { applyGain: false } },
	{ name: 'stateless control', type: 'audacity-invert', sampleRate: 48_000, params: {} },
]) test(`${scenario.name} preview agrees with the complete selection's applied first six seconds`, async () => {
	const frames = scenario.sampleRate * 8;
	const input = Float32Array.from({ length: frames }, (_, frame) => (
		Math.sin(2 * Math.PI * 440 * frame / scenario.sampleRate) * (frame < scenario.sampleRate * 6 ? 0.1 : 0.9)
		+ (scenario.name === 'DC-only' && frame >= scenario.sampleRate * 6 ? 0.3 : 0)
	));
	let played: Float32Array[] = [];
	let peakEstimateFrames = 0;
	const state = { audacityEffectType: scenario.type, audacityEffectProcessing: false,
		audacityPreviewGeneration: 0, audacityEffectTouchedParams: new Map<string, Set<string>>(),
		audacityPreviewSource: null as unknown };
	const source = { buffer: null as unknown, onended: null as unknown,
		connect() {}, start() {}, disconnect() {} };
	const preview = createSelectionEffectPreviewService({
		state, AUDIO_SELECTION_EFFECT_DEFINITIONS,
		AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 100_000_000,
		abortError: () => new DOMException('Cancelled', 'AbortError'),
		assertAudacityEffectOutput: (channels: Float32Array[]) => assert.equal(channels.length, 1),
		audacityEffectMemoryError: () => new Error('Too large'),
		audacityEffectTargets: () => [{ track: { id: 'track' }, startFrame: 0,
			endFrame: frames, durationFrames: frames, channelCount: 1, clipIds: ['clip'],
			sourceSampleRate: scenario.sampleRate }],
		audacitySpectralEffectContext: () => null,
		bufferFromChannels: async (channels: Float32Array[]) => { played = channels; return {}; },
		cancelAudacityEffectPreview() {}, copy: {},
		currentAudacityEffectParams: () => scenario.params,
		engine: { pause() {}, getPlaybackDestination: () => ({}),
			getAudioContext: async () => ({ createBufferSource: () => source }) },
		estimateAudioSelectionEffectPeakBytes: (_type: string, duration: number) => {
			peakEstimateFrames = duration; return duration * 16;
		},
		getProject: () => ({}), mixNyquistPreviewChannels, normalizeAudioSelectionEffectParams,
		projectDurationFrames: () => frames, projectSampleRate: () => 48_000,
		publishDocumentSnapshot() {},
		renderDryTrackRange: async (_track: string, start: number, end: number) => [input.slice(start, end)],
		resolveInteractiveAudacityParams: (_type: string, params: unknown) => params,
		runSelectionEffectWorker: async (request: WorkerRequest) => ({
			channels: applyAudacityEffect(request.effectType, request.channels, request.sampleRate, request.params),
		}),
		setStatus() {},
	});
	assert.equal(await preview(), true);
	const expected = applyAudacityEffect(scenario.type, [input], scenario.sampleRate, scenario.params)[0]!;
	assert.equal(played[0]!.length, scenario.sampleRate * 6);
	let residual = 0;
	for (let frame = 0; frame < played[0]!.length; frame++) {
		residual = Math.max(residual, Math.abs(played[0]![frame]! - expected[frame]!));
	}
	assert.ok(residual < 1e-6, `the preview differs from Apply by ${residual}`);
	assert.equal(peakEstimateFrames, scenario.type === 'audacity-invert' ? scenario.sampleRate * 6 : frames);
});
