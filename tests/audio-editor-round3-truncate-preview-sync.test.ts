/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectionEffectPreviewService } from '../src/common/editor/controller/effects/internal/effect-preview-service.ts';
import { mixNyquistPreviewChannels } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';
import type { SelectionEffectWorkerRequest } from '../src/common/editor/controller/effects/internal/selection-effect-worker-service.ts';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS, normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects.js';

for (const independent of [false, true]) test(`${independent ? 'independent stereo' : 'linked track'} previews preserve synchronized silence`, async () => {
	const microphones = [new Float32Array(2_000).fill(0.35), new Float32Array(2_000).fill(0.35)];
	microphones[0]!.fill(0, 300, 1_300); microphones[1]!.fill(0, 700, 1_700);
	const inputs = independent ? [microphones] : microphones.map(channel => [channel]);
	const params = { independent, minimumSilence: 0.5, truncateTo: 0 };
	const jobs: SelectionEffectWorkerRequest[] = [];
	let played: Float32Array[] = [];
	const state = { audacityEffectType: 'audacity-truncate-silence', audacityEffectProcessing: false,
		audacityPreviewGeneration: 0, audacityPreviewSource: null as unknown,
		audacityEffectTouchedParams: new Map<string, Set<string>>() };
	const source = { buffer: null as unknown, connect: () => undefined, start: () => undefined };
	const preview = createSelectionEffectPreviewService({
		state, AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 1_000_000, AUDIO_SELECTION_EFFECT_DEFINITIONS,
		abortError: () => new DOMException('Cancelled', 'AbortError'),
		assertAudacityEffectOutput: (channels: Float32Array[]) => assert.ok(channels.length),
		audacityEffectMemoryError: () => new Error('Too large'),
		audacityEffectTargets: () => inputs.map((channels, index) => ({
			track: { id: String(index) }, startFrame: 0, endFrame: 2_000, durationFrames: 2_000,
			channelCount: channels.length, clipId: `clip-${index}`, clipIds: [`clip-${index}`],
		})),
		audacitySpectralEffectContext: () => null,
		bufferFromChannels: async (channels: Float32Array[]) => { played = channels; return { channels }; },
		cancelAudacityEffectPreview: () => { state.audacityPreviewGeneration++; },
		copy: { audacityPreviewProcessing: 'Preparing', audacityPreviewPlaying: 'Playing' },
		currentAudacityEffectParams: () => params,
		engine: { pause: () => undefined, getPlaybackDestination: () => ({}),
			getAudioContext: async () => ({ createBufferSource: () => source }) },
		estimateAudioSelectionEffectPeakBytes: () => 0,
		getProject: () => ({ id: 'dialogue' }), mixNyquistPreviewChannels, normalizeAudioSelectionEffectParams,
		projectDurationFrames: () => 2_000, projectSampleRate: () => 1_000,
		publishDocumentSnapshot: () => undefined,
		renderDryTrackRange: async (id: string) => inputs[Number(id)]!.map(channel => channel.slice()),
		resolveInteractiveAudacityParams: (_type: string, value: unknown) => value,
		runSelectionEffectWorker: async (request: SelectionEffectWorkerRequest) => {
			jobs.push(request);
			return { channels: await applyAudioSelectionEffectAsync(request.effectType,
				request.channels, request.sampleRate, request.params, request.context) };
		}, setStatus: () => undefined,
	});
	assert.equal(await preview(), true);
	assert.equal(played[0]!.length, 1_400);
	assert.equal(jobs.length, 1);
	assert.equal(jobs[0]!.channels.length, 2);
	assert.equal(state.audacityEffectProcessing, false);
	assert.equal(params.independent, independent, 'the dialog keeps the authored track choice');
	assert.equal(microphones[0]!.length, 2_000);
	if (independent) {
		assert.equal(played[0]![350], 0);
		assert.equal(played[1]![350], Math.fround(0.35));
	}
});
