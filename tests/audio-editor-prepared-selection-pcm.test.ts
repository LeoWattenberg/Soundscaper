/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectionEffectExecutionService } from '../src/common/editor/controller/effects/internal/effect-execution-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS, normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';

function fixture(owned = true, headroom = 1_000_000) {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const generation = new EditorProjectGeneration();
	generation.activate('project');
	let project: object = {};
	let start = 10;
	let enabled = owned;
	let renders = 0;
	const input = new Float32Array([0.1, -0.2, 0.3, -0.4]);
	const retained: Float32Array[][] = [];
	const state = { audacityEffectType: 'audacity-amplify', audacityEffectProcessing: false,
		audacityEffectTouchedParams: new Map<string, Set<string>>(), audacityPreviewGeneration: 0, lastAudacityEffect: null };
	const service = createSelectionEffectExecutionService({
		lifetime, state, AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 2_000_000,
		AUDIO_SELECTION_EFFECT_DEFINITIONS,
		captureProject: () => generation.capture(), assertProject: (token: Parameters<typeof generation.assertCurrent>[0]) => generation.assertCurrent(token),
		getPreparedAudioAuthority: () => enabled ? project : null,
		getProject: () => project,
		activeSelection: () => null,
		editingBlocked: () => false,
		audacityEffectTargets: () => [{ track: { id: 'track' }, startFrame: start, endFrame: start + 4,
			durationFrames: 4, channelCount: 1, clipIds: ['clip'] }],
		audacitySpectralEffectContext: () => null,
		audacityEffectSelectionDetails: () => ({}),
		projectSampleRate: () => 48_000,
		projectDurationFrames: () => 1_000,
		estimateAudioSelectionEffectPeakBytes: () => 2_000_000 - headroom,
		estimateAudioSelectionEffectOutputFrames: (_type: string, frames: number) => frames,
		copy: { audacityProcessing: 'Processing', audacityApplied: 'Applied' },
		audacityEffectMemoryError: () => new Error('Too large'),
		currentAudacityEffectParams: () => ({ gainDb: 0 }),
		setAudacityEffectType: (type: string) => { state.audacityEffectType = type; },
		normalizeAudioSelectionEffectParams,
		renderDryTrackRange: async () => { renders += 1; return [input.slice()]; },
		resolveInteractiveAudacityParams: (_type: string, params: unknown) => params,
		publishDocumentSnapshot: () => undefined,
		setStatus: () => undefined,
		preflightStorage: async () => undefined,
		runSelectionEffectWorker: async (request: { channels: Float32Array[] }, options: { pcmOwnership: string }) => {
			assert.equal(options.pcmOwnership, 'transfer');
			const channels = structuredClone(request.channels, { transfer: request.channels.map((channel) => channel.buffer) });
			return { channels };
		},
		persistAudacityEffectResults: async (results: Array<{ channels: Float32Array[] }>) => {
			retained.push(results[0]!.channels);
		},
	});
	return { service, lifetime, input, retained, renders: () => renders,
		edit: () => { project = {}; }, select: () => { start += 1; }, disable: () => { enabled = false; } };
}

test('Amplify Apply consumes privately owned preparation PCM once without a second dry render', async () => {
	const value = fixture();
	await value.service.prepareAudacityEffectFromController('audacity-amplify');
	await value.service.applySelectedAudacityEffect();
	assert.equal(value.renders(), 1);
	assert.deepEqual(value.retained[0], [value.input]);
	await value.service.applySelectedAudacityEffect();
	assert.equal(value.renders(), 2, 'the worker transfer cannot leave reusable detached cache PCM');
});

test('untrusted input, changed audio or selection, memory mode and exhausted admission headroom render afresh', async () => {
	for (const change of ['untrusted', 'edit', 'selection', 'memory', 'headroom', 'project-switch'] as const) {
		const value = fixture(change !== 'untrusted', change === 'headroom' ? 15 : 1_000_000);
		await value.service.prepareAudacityEffectFromController('audacity-amplify');
		if (change === 'edit') value.edit();
		if (change === 'selection') value.select();
		if (change === 'memory') value.disable();
		if (change === 'project-switch') value.lifetime.cancelScope('project');
		await value.service.applySelectedAudacityEffect();
		assert.equal(value.renders(), 2, change);
	}
});
