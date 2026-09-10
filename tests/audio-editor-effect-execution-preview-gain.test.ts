/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEffectControlsService } from '../src/common/editor/controller/effects/effect-controls-service.ts';
import { createSelectionEffectExecutionService } from '../src/common/editor/controller/effects/internal/effect-execution-service.ts';
import {
	AUDIO_SELECTION_EFFECT_DEFINITIONS,
	normalizeAudioSelectionEffectParams,
} from '../src/common/editor/effects.js';
import { estimateAudioSelectionEffectPeakBytes } from '../src/common/editor/selection-effects.js';

test('Amplify preview derives automatic gain from the complete selection peak', async () => {
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
	const renderRequests: Array<readonly [number, number]> = [];
	let workerGainDb: unknown = null;
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
		audacityEffectTarget: () => ({
			track: { id: 'track-a' }, startFrame: 0, endFrame: 8, durationFrames: 8,
			channelCount: 1, clipIds: ['clip-a'],
		}),
		audacitySpectralEffectContext: () => null,
		bufferFromChannels: async () => ({}),
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
		normalizeAudioSelectionEffectParams,
		projectDurationFrames: () => 8,
		projectSampleRate: () => 1,
		publishDocumentSnapshot: () => undefined,
		renderDryTrackRange: async (_trackId: string, startFrame: number, endFrame: number) => {
			renderRequests.push([startFrame, endFrame]);
			return [endFrame === 8
				? new Float32Array([0.1, 0.9])
				: new Float32Array([0.1, -0.1])];
		},
		resolveInteractiveAudacityParams: controls.resolveInteractiveAudacityParams,
		runSelectionEffectWorker: async (request: Readonly<{
			channels: Float32Array[];
			params: Readonly<{ gainDb?: unknown }>;
		}>) => {
			workerGainDb = request.params.gainDb;
			return { channels: request.channels };
		},
		setAudacityControlTrack: () => undefined,
		setAudacityEffectParamsFromController: () => undefined,
		setAudacityEffectType: () => undefined,
		setStatus: () => undefined,
		state,
	});

	assert.equal(await execution.previewAudacityEffectFromController(), true);
	assert.deepEqual(renderRequests, [[0, 8], [0, 6]]);
	const expectedGainDb = 20 * Math.log10(1 / Math.fround(0.9));
	assert.equal(workerGainDb, expectedGainDb);
	assert.equal(state.audacityEffectParams['audacity-amplify']?.gainDb, expectedGainDb);
});
