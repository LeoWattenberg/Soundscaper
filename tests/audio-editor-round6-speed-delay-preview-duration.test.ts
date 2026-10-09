/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createSelectionEffectPreviewService } from '../src/common/editor/controller/effects/internal/effect-preview-service.ts';
import { mixNyquistPreviewChannels } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS, normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects.js';
import { loadStaffPadWasm } from '../src/common/editor/staffpad/runtime.js';

interface WorkerRequest {
	readonly effectType: string;
	readonly channels: Float32Array[];
	readonly sampleRate: number;
	readonly params: Readonly<Record<string, unknown>>;
}

const sampleRate = 8_000;
const type = 'multi-tap-delay';
const staffPadRuntime = await loadStaffPadWasm(await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url)));

for (const scenario of [
	{ name: 'faster echo', seconds: 12, pitchShift: 2, mix: 1, complete: true },
	{ name: 'slower echo control', seconds: 12, pitchShift: -2, mix: 1, complete: false },
	{ name: 'dry control', seconds: 12, pitchShift: 2, mix: 0, complete: false },
	{ name: 'short faster echo control', seconds: 4, pitchShift: 2, mix: 1, complete: true },
]) test(`Speed Delay ${scenario.name} preview retains the applied echo`, async () => {
	const frames = scenario.seconds * sampleRate;
	const input = Float32Array.from({ length: frames }, (_, frame) => .2 * Math.sin(2 * Math.PI * 440 * frame / sampleRate));
	const params = normalizeAudioSelectionEffectParams(type, { pitchMode: 'speed',
		pitchShift: scenario.pitchShift, mix: scenario.mix, echoes: 1, echoGain: 0, time: .1 });
	const applied = (await applyAudioSelectionEffectAsync(type, [input], sampleRate, params, { staffPadRuntime }))[0];
	let played: Float32Array[] = [];
	let admittedFrames = 0;
	const renders: number[][] = [];
	const state = { audacityEffectType: type, audacityEffectProcessing: false, audacityPreviewGeneration: 0,
		audacityEffectTouchedParams: new Map<string, Set<string>>(), audacityPreviewSource: null as unknown };
	const source = { buffer: null as unknown, onended: null as unknown, connect() {}, start() {}, disconnect() {} };
	const preview = createSelectionEffectPreviewService({
		state, AUDIO_SELECTION_EFFECT_DEFINITIONS, AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 100_000_000,
		abortError: () => new DOMException('Cancelled', 'AbortError'),
		assertAudacityEffectOutput: (channels: Float32Array[]) => assert.equal(channels.length, 1),
		audacityEffectMemoryError: () => new Error('Too large'),
		audacityEffectTargets: () => [{ track: { id: 'track' }, startFrame: 0, endFrame: frames,
			durationFrames: frames, channelCount: 1, clipIds: ['clip'], sourceSampleRate: sampleRate }],
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
		runSelectionEffectWorker: async (request: WorkerRequest) => ({ channels: await applyAudioSelectionEffectAsync(
			request.effectType, request.channels, request.sampleRate, request.params, { staffPadRuntime },
		) }), setStatus() {},
	});
	assert.equal(await preview(), true);
	assert.equal(played[0].length, Math.min(sampleRate * 6, applied.length));
	let residual = 0;
	const start = Math.min(Math.round(sampleRate * 5.7), Math.floor(played[0].length / 2));
	for (let frame = start; frame < Math.min(played[0].length, Math.round(sampleRate * 5.95)); frame++) {
		residual = Math.max(residual, Math.abs(played[0][frame] - applied[frame]));
	}
	assert.ok(residual < 1e-6, `Preview loses applied echo PCM by ${residual}`);
	const processingFrames = scenario.complete ? frames : Math.min(frames, sampleRate * 6);
	assert.equal(admittedFrames, processingFrames, 'Admission covers the actual processing input');
	assert.deepEqual(renders[0], [0, processingFrames]);
});
