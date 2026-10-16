/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectionEffectPreviewService } from '../src/common/editor/controller/effects/internal/effect-preview-service.ts';
import { mixNyquistPreviewChannels } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS, normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects.js';

interface WorkerRequest {
	readonly effectType: string;
	readonly channels: Float32Array[];
	readonly sampleRate: number;
	readonly params: Readonly<Record<string, unknown>>;
}

const sampleRate = 8_000;
const type = 'audacity-paulstretch';

for (const scenario of [
	{ name: 'long resolution window', seconds: 12, resolution: 8, factor: 1 },
	{ name: 'ordinary short resolution', seconds: 12, resolution: .25, factor: 1 },
	{ name: 'hour-long selection with ordinary resolution', seconds: 12, selectionSeconds: 3600, resolution: .25, factor: 1 },
	{ name: 'short selection stretched into the full audition', seconds: 4, resolution: .25, factor: 10 },
	{ name: 'genuinely insufficient selected input', seconds: 1, resolution: 8, factor: 1, unsupported: true },
]) test(`Paulstretch ${scenario.name} preview respects its actual selected input`, async () => {
	const frames = scenario.seconds * sampleRate;
	const selectedFrames = (scenario.selectionSeconds ?? scenario.seconds) * sampleRate;
	const input = Float32Array.from({ length: frames }, (_, frame) => .2 * Math.sin(2 * Math.PI * 440 * frame / sampleRate));
	const params = normalizeAudioSelectionEffectParams(type, { stretchFactor: scenario.factor, timeResolution: scenario.resolution });
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
		audacityEffectTargets: () => [{ track: { id: 'track' }, startFrame: 0, endFrame: selectedFrames,
			durationFrames: selectedFrames, channelCount: 1, clipIds: ['clip'], sourceSampleRate: sampleRate }],
		audacitySpectralEffectContext: () => null,
		bufferFromChannels: async (channels: Float32Array[]) => { played = channels; return {}; },
		cancelAudacityEffectPreview() {}, copy: {}, currentAudacityEffectParams: () => params,
		engine: { pause() {}, getPlaybackDestination: () => ({}),
			getAudioContext: async () => ({ createBufferSource: () => source }) },
		estimateAudioSelectionEffectPeakBytes: (_type: string, duration: number) => { admittedFrames = duration; return duration * 16; },
		getProject: () => ({}), mixNyquistPreviewChannels, normalizeAudioSelectionEffectParams,
		projectDurationFrames: () => selectedFrames, projectSampleRate: () => sampleRate, publishDocumentSnapshot() {},
		renderDryTrackRange: async (_track: string, start: number, end: number) => {
			renders.push([start, end]); return [input.slice(start, end)];
		},
		resolveInteractiveAudacityParams: (_type: string, value: unknown) => value,
		runSelectionEffectWorker: async (request: WorkerRequest) => ({ channels: await applyAudioSelectionEffectAsync(
			request.effectType, request.channels, request.sampleRate, request.params,
		) }), setStatus() {},
	});
	if (scenario.unsupported) {
		await assert.rejects(applyAudioSelectionEffectAsync(type, [input], sampleRate, params), /Time Resolution is too long/);
		await assert.rejects(preview(), /Time Resolution is too long/);
		assert.equal(played.length, 0);
		return;
	}
	const applied = (await applyAudioSelectionEffectAsync(type, [input], sampleRate, params))[0];
	assert.equal(await preview(), true);
	assert.equal(played[0].length, Math.min(6 * sampleRate, applied.length));
	let residual = 0;
	for (let frame = Math.round(sampleRate * 5.7); frame < Math.round(sampleRate * 5.95); frame++) {
		residual = Math.max(residual, Math.abs(played[0][frame] - applied[frame]));
	}
	assert.ok(residual < 1e-6, `Preview changes applied window PCM by ${residual}`);
	assert.ok(admittedFrames <= selectedFrames, 'Preview never reads beyond the selected source extent');
	assert.deepEqual(renders[0], [0, admittedFrames], 'Admission covers the actual processing input');
	if (scenario.resolution === .25) assert.ok(admittedFrames < 7 * sampleRate, 'Ordinary windows retain a bounded prefix');
});
