/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectionEffectExecutionService } from '../src/common/editor/controller/effects/internal/effect-execution-service.ts';
import type { SelectionEffectResult } from '../src/common/editor/controller/effects/internal/effect-result-service.ts';
import type { SelectionEffectWorkerRequest } from '../src/common/editor/controller/effects/internal/selection-effect-worker-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS, normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects.js';

for (const clipSelection of [true, false]) test(`linked silence detection retains the common pause for ${clipSelection ? 'clip' : 'range'} targets`, async () => {
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate('dialogue');
	const tracks = [{ id: 'first', name: 'First', type: 'audio' as const }, { id: 'second', name: 'Second', type: 'audio' as const }];
	const inputs = tracks.map((_track, index) => {
		const channels = [new Float32Array(2_000).fill(0.35)];
		channels[0]!.fill(0, index ? 700 : 300, index ? 1_700 : 1_300);
		return channels;
	});
	let results: readonly SelectionEffectResult[] = [];
	const workerRequests: SelectionEffectWorkerRequest[] = [];
	const state = { audacityEffectType: 'audacity-truncate-silence', audacityEffectProcessing: false,
		audacityEffectTouchedParams: new Map<string, Set<string>>(), audacityPreviewGeneration: 0 };
	const service = createSelectionEffectExecutionService({ lifetime, state,
		AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 10_000_000, AUDIO_SELECTION_EFFECT_DEFINITIONS,
		captureProject: () => generation.capture(), assertProject: (token: Parameters<typeof generation.assertCurrent>[0]) => generation.assertCurrent(token),
		getProject: () => ({ id: 'dialogue' }), activeSelection: () => null, editingBlocked: () => false,
		audacityEffectTargets: () => tracks.map((track, index) => ({ track, startFrame: 0, endFrame: 2_000,
			durationFrames: 2_000, channelCount: 1, hasAudio: true,
			...(clipSelection ? { clipId: `clip-${index}`, clipIds: [`clip-${index}`] } : {}) })),
		audacitySpectralEffectContext: () => null, audacityEffectSelectionDetails: () => ({}),
		projectSampleRate: () => 1_000, projectDurationFrames: () => 2_000,
		estimateAudioSelectionEffectPeakBytes: () => 32_000,
		estimateAudioSelectionEffectOutputFrames: (_type: string, frames: number) => frames,
		copy: { audacityProcessing: 'Processing', audacityApplied: 'Applied' },
		audacityEffectMemoryError: () => new Error('Too large'),
		currentAudacityEffectParams: () => ({ independent: false, minimumSilence: 0.5, truncateTo: 0 }),
		normalizeAudioSelectionEffectParams,
		renderDryTrackRange: async (trackId: string) => inputs[trackId === 'first' ? 0 : 1]!.map(channel => channel.slice()),
		resolveInteractiveAudacityParams: (_type: string, params: unknown) => params,
		publishDocumentSnapshot: () => undefined, setStatus: () => undefined, preflightStorage: async () => undefined,
		runSelectionEffectWorker: async (request: SelectionEffectWorkerRequest) => {
			workerRequests.push(request);
			return { channels: await applyAudioSelectionEffectAsync(request.effectType, request.channels, request.sampleRate, request.params, request.context) };
		},
		persistAudacityEffectResults: async (processed: readonly SelectionEffectResult[]) => { results = processed; },
	});
	try {
		await service.applySelectedAudacityEffect();
		assert.deepEqual(results.map(result => result.channels[0]!.length), [1_400, 1_400]);
		assert.equal(workerRequests.length, 1);
		assert.equal(workerRequests[0]!.channels.length, 2);
		if (clipSelection) assert.deepEqual(results.map(result => result.target.clipId), ['clip-0', 'clip-1']);
		assert.equal(inputs[0]![0]!.length, 2_000);
	} finally { lifetime.beginDisposal(); lifetime.finishDisposal(); }
});
