/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { applyAudacityEffectAsync } from '../src/common/editor/audacity-effects/index.js';
import { createSelectionEffectPreviewService } from '../src/common/editor/controller/effects/internal/effect-preview-service.ts';
import { mixNyquistPreviewChannels } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS, normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';
import { normalizeSelectionEffectWorkerContext } from '../src/common/editor/selection-effects-worker-context.ts';
import { loadStaffPadWasm } from '../src/common/editor/staffpad/runtime.js';

interface WorkerRequest {
	readonly effectType: string;
	readonly channels: Float32Array[];
	readonly sampleRate: number;
	readonly params: Readonly<Record<string, unknown>>;
	readonly context: unknown;
}

for (const scenario of [
	{ name: 'long pitch ramp', seconds: 12, params: { endPitchSemitones: 12 }, complete: true },
	{ name: 'long tempo ramp', seconds: 12, params: { endTempoPercent: 100 }, complete: true },
	{ name: 'short pitch ramp control', seconds: 4, params: { endPitchSemitones: 12 }, complete: true },
	{ name: 'constant pitch control', seconds: 12, params: { startPitchSemitones: 6, endPitchSemitones: 6 }, complete: false },
]) test(`Sliding Stretch ${scenario.name} preview agrees with the applied selection`, async () => {
	const sampleRate = 8_000;
	const frames = scenario.seconds * sampleRate;
	const type = 'audacity-sliding-stretch';
	const input = Float32Array.from({ length: frames }, (_, frame) => .2 * Math.sin(2 * Math.PI * 440 * frame / sampleRate));
	const staffPadRuntime = await loadStaffPadWasm(await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url)));
	const params = normalizeAudioSelectionEffectParams(type, scenario.params);
	const expected = (await applyAudacityEffectAsync(type, [input], sampleRate, params, { staffPadRuntime }))[0]!;
	let played: Float32Array[] = [];
	let admittedFrames = 0;
	const renders: number[][] = [];
	const state = { audacityEffectType: type, audacityEffectProcessing: false,
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
			endFrame: frames, durationFrames: frames, channelCount: 1, clipIds: ['clip'], sourceSampleRate: sampleRate }],
		audacitySpectralEffectContext: () => null,
		bufferFromChannels: async (channels: Float32Array[]) => { played = channels; return {}; },
		cancelAudacityEffectPreview() {}, copy: {}, currentAudacityEffectParams: () => params,
		engine: { pause() {}, getPlaybackDestination: () => ({}),
			getAudioContext: async () => ({ createBufferSource: () => source }) },
		estimateAudioSelectionEffectPeakBytes: (_type: string, duration: number) => { admittedFrames = duration; return 0; },
		getProject: () => ({}), mixNyquistPreviewChannels, normalizeAudioSelectionEffectParams,
		projectDurationFrames: () => frames, projectSampleRate: () => sampleRate, publishDocumentSnapshot() {},
		renderDryTrackRange: async (_track: string, start: number, end: number) => {
			renders.push([start, end]); return [input.slice(start, end)];
		},
		resolveInteractiveAudacityParams: (_type: string, value: unknown) => value,
		runSelectionEffectWorker: async (request: WorkerRequest) => ({ channels: await applyAudacityEffectAsync(
			request.effectType, request.channels, request.sampleRate, request.params,
			{ ...normalizeSelectionEffectWorkerContext(request.context), staffPadRuntime },
		) }),
		setStatus() {},
	});
	assert.equal(await preview(), true);
	assert.equal(played[0]!.length, Math.min(sampleRate * 6, expected.length));
	let residual = 0;
	for (let frame = sampleRate; frame < Math.min(sampleRate * 3, played[0]!.length); frame++) {
		residual = Math.max(residual, Math.abs(played[0]![frame]! - expected[frame]!));
	}
	assert.ok(residual < 1e-6, `the actual preview PCM differs from Apply by ${residual}`);
	const processingFrames = scenario.complete ? frames : Math.min(frames, sampleRate * 6);
	assert.equal(admittedFrames, processingFrames, 'the peak memory admission covers the processing extent');
	assert.deepEqual(renders[0], [0, processingFrames]);
});
