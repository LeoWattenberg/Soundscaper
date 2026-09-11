/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEffectControlsService } from '../src/common/editor/controller/effects/effect-controls-service.ts';
import { createSelectionEffectExecutionService } from '../src/common/editor/controller/effects/internal/effect-execution-service.ts';
import {
	AUDIO_SELECTION_EFFECT_DEFINITIONS,
	normalizeAudioSelectionEffectParams,
} from '../src/common/editor/effects.js';
import { mixNyquistPreviewChannels } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';
import { estimateAudioSelectionEffectPeakBytes } from '../src/common/editor/selection-effects.js';

test('Amplify preview processes every target and derives automatic gain from all complete selections', async () => {
	const state = {
		audacityEffectType: 'audacity-amplify',
		audacityEffectParams: {} as Record<string, Readonly<Record<string, unknown>>>,
		audacityEffectTouchedParams: new Map<string, Set<string>>(),
		audacityPreviewSource: null,
		audacityPreviewAuditionBandId: null,
		audacityPreviewGeneration: 0,
		audacityControlTrackId: null,
		audacityNoiseProfile: null,
		audacityEffectProcessing: false,
		effectPresets: { schemaVersion: 1 as const, presets: [] },
		lastAudacityEffect: null,
	};
	const controls = createEffectControlsService({
		state,
		copy: {
			audacitySelectionHint: 'Select audio', controlTrackNotFound: 'Missing control track',
			rackEffectNotFound: 'Missing rack effect', ready: 'Ready', selectionEffectUnsupported: 'Unsupported',
		},
		createId: (prefix) => `${prefix}-id`,
		getProject: () => ({ id: 'project-a', tracks: [], master: {} }),
		persistSetting: async () => undefined,
		publishDocumentSnapshot: () => undefined,
		setStatus: () => undefined,
		applySelectedAudacityEffect: async () => undefined,
		captureRackNoiseProfile: async () => undefined,
	});
	const renderRequests: Array<readonly [string, number, number]> = [];
	const workerGainDb: unknown[] = [];
	let previewChannels: Float32Array[] = [];
	const previewSource = {
		onended: null as (() => void) | null,
		onerror: null as (() => void) | null,
		buffer: null as unknown,
		connect() {},
		disconnect() {},
		start() {},
		stop() {},
	};
	const execution = createSelectionEffectExecutionService({
		AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 1_000_000_000,
		AUDIO_SELECTION_EFFECT_DEFINITIONS,
		abortError: () => Object.assign(new Error('aborted'), { name: 'AbortError' }),
		assertAudacityEffectOutput: () => undefined,
		audacityEffectMemoryError: () => new Error('Effect is too large'),
		audacityEffectTargets: () => [
			{
				track: { id: 'track-a' }, startFrame: 0, endFrame: 8, durationFrames: 8,
				channelCount: 1, clipIds: ['clip-a'],
			},
			{
				track: { id: 'track-b' }, startFrame: 0, endFrame: 8, durationFrames: 8,
				channelCount: 1, clipIds: ['clip-b'],
			},
		],
		audacitySpectralEffectContext: () => null,
		bufferFromChannels: async (channels: Float32Array[]) => {
			previewChannels = channels;
			return {};
		},
		cancelAudacityEffectPreview: () => undefined,
		copy: {
			audacitySelectionHint: 'Select audio', audacityPreviewProcessing: 'Previewing',
			audacityPreviewPlaying: 'Playing', ready: 'Ready',
		},
		currentAudacityEffectParams: controls.currentAudacityEffectParams,
		engine: {
			pause() {},
			getAudioContext: async () => ({
				resume: async () => undefined,
				createBufferSource: () => previewSource,
				destination: {},
			}),
		},
		estimateAudioSelectionEffectPeakBytes,
		mixNyquistPreviewChannels,
		normalizeAudioSelectionEffectParams,
		projectDurationFrames: () => 8,
		projectSampleRate: () => 1,
		publishDocumentSnapshot: () => undefined,
		renderDryTrackRange: async (trackId: string, startFrame: number, endFrame: number) => {
			renderRequests.push([trackId, startFrame, endFrame]);
			if (endFrame === 8) {
				return [trackId === 'track-a'
					? new Float32Array([0.1, 0.9])
					: new Float32Array([0.1, 0.95])];
			}
			return [trackId === 'track-a'
				? new Float32Array([0.1, -0.1])
				: new Float32Array([0.2, 0.3])];
		},
		resolveInteractiveAudacityParams: controls.resolveInteractiveAudacityParams,
		runSelectionEffectWorker: async (request: Readonly<{
			channels: Float32Array[];
			params: Readonly<{ gainDb?: unknown }>;
		}>) => {
			workerGainDb.push(request.params.gainDb);
			return { channels: request.channels };
		},
		setAudacityControlTrack: () => undefined,
		setAudacityEffectParamsFromController: () => undefined,
		setAudacityEffectType: () => undefined,
		setStatus: () => undefined,
		state,
	});

	assert.equal(await execution.previewAudacityEffectFromController(), true);
	assert.deepEqual(renderRequests, [
		['track-a', 0, 8],
		['track-b', 0, 8],
		['track-a', 0, 6],
		['track-b', 0, 6],
	]);
	const expectedGainDb = 20 * Math.log10(1 / Math.fround(0.95));
	assert.deepEqual(workerGainDb, [expectedGainDb, expectedGainDb]);
	assert.equal(state.audacityEffectParams['audacity-amplify']?.gainDb, expectedGainDb);
	assert.equal(previewChannels[0]?.length, 6);
	assert.ok(Math.abs((previewChannels[0]?.[0] ?? 0) - 0.3) < 1e-6);
	assert.ok(Math.abs((previewChannels[0]?.[1] ?? 0) - 0.2) < 1e-6);
	assert.deepEqual(Array.from(previewChannels[0]?.slice(2) ?? []), [0, 0, 0, 0]);
});

test('multi-clip previews preserve disjoint timeline offsets for processed and EQ mixes', async () => {
	for (const effectType of ['audacity-invert', 'eq']) {
		const preview = await previewDisjointTargets(effectType);
		assert.deepEqual(preview.renderRequests, [
			['track-a', 10, 12],
			['track-b', 13, 15],
		], effectType);
		assert.deepEqual(preview.channels.map((channel) => Array.from(channel)), [[
			Math.fround(0.1), Math.fround(0.2), 0,
			Math.fround(0.3), Math.fround(0.4), 0,
		]], effectType);
	}
});

async function previewDisjointTargets(effectType: string): Promise<Readonly<{
	channels: Float32Array[];
	renderRequests: Array<readonly [string, number, number]>;
}>> {
	const state = {
		audacityEffectType: effectType,
		audacityEffectParams: {} as Record<string, Readonly<Record<string, unknown>>>,
		audacityEffectTouchedParams: new Map<string, Set<string>>(),
		audacityPreviewSource: null,
		audacityPreviewAuditionBandId: null,
		audacityPreviewGeneration: 0,
		audacityControlTrackId: null,
		audacityNoiseProfile: null,
		audacityEffectProcessing: false,
	};
	const renderRequests: Array<readonly [string, number, number]> = [];
	let channels: Float32Array[] = [];
	const source = {
		onended: null as (() => void) | null,
		onerror: null as (() => void) | null,
		buffer: null as unknown,
		connect() {},
		disconnect() {},
		start() {},
		stop() {},
	};
	const execution = createSelectionEffectExecutionService({
		AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 1_000_000,
		AUDIO_SELECTION_EFFECT_DEFINITIONS: { [effectType]: {} },
		abortError: () => Object.assign(new Error('aborted'), { name: 'AbortError' }),
		assertAudacityEffectOutput: () => undefined,
		audacityEffectMemoryError: () => new Error('Effect is too large'),
		audacityEffectTargets: () => [
			{
				track: { id: 'track-a' }, startFrame: 10, endFrame: 12, durationFrames: 2,
				channelCount: 1, clipIds: ['clip-a'],
			},
			{
				track: { id: 'track-b' }, startFrame: 13, endFrame: 15, durationFrames: 2,
				channelCount: 1, clipIds: ['clip-b'],
			},
			{
				track: { id: 'track-c' }, startFrame: 17, endFrame: 19, durationFrames: 2,
				channelCount: 1, clipIds: ['clip-c'],
			},
		],
		audacitySpectralEffectContext: () => null,
		bufferFromChannels: async (value: Float32Array[]) => {
			channels = value;
			return {};
		},
		cancelAudacityEffectPreview: () => undefined,
		copy: {
			audacitySelectionHint: 'Select audio', audacityPreviewProcessing: 'Previewing',
			audacityPreviewPlaying: 'Playing', ready: 'Ready',
		},
		currentAudacityEffectParams: () => ({}),
		engine: {
			pause() {},
			getAudioContext: async () => ({
				resume: async () => undefined,
				createBufferSource: () => source,
				destination: {},
			}),
			createParametricEqPreview: async () => source,
		},
		estimateAudioSelectionEffectPeakBytes: () => 0,
		getProject: () => ({ id: 'project-a' }),
		mixNyquistPreviewChannels,
		normalizeAudioSelectionEffectParams: () => ({}),
		projectDurationFrames: () => 30,
		projectSampleRate: () => 1,
		publishDocumentSnapshot: () => undefined,
		renderDryTrackRange: async (trackId: string, startFrame: number, endFrame: number) => {
			renderRequests.push([trackId, startFrame, endFrame]);
			const samples = trackId === 'track-a'
				? [0.1, 0.2]
				: trackId === 'track-b' ? [0.3, 0.4] : [0.5, 0.6];
			return [new Float32Array(samples.slice(0, endFrame - startFrame))];
		},
		resolveInteractiveAudacityParams: (_type: string, params: unknown) => params,
		runSelectionEffectWorker: async (request: Readonly<{ channels: Float32Array[] }>) => ({
			channels: request.channels,
		}),
		setAudacityControlTrack: () => undefined,
		setAudacityEffectParamsFromController: () => undefined,
		setAudacityEffectType: () => undefined,
		setStatus: () => undefined,
		state,
	});

	assert.equal(await execution.previewAudacityEffectFromController(), true);
	return { channels, renderRequests };
}
