/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectionEffectExecutionService } from '../src/common/editor/controller/effects/internal/effect-execution-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS, normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';

function fixture(owned = true, headroom = 1_000_000, simplePcm: 'admit' | 'fallback' | null = null) {
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
	const simpleCalls: number[][] = [];
	const jobContexts: Array<{ beforeChannels?: Float32Array[]; afterChannels?: Float32Array[] }> = [];
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
		tryRenderSimpleDryTrackRange: simplePcm ? async (_track: string, from: number, to: number) => {
			simpleCalls.push([from, to]);
			return simplePcm === 'admit' ? [Float32Array.from({ length: to - from }, (_, index) => (from + index) / 1_000)] : null;
		} : undefined,
		resolveInteractiveAudacityParams: (_type: string, params: unknown) => params,
		publishDocumentSnapshot: () => undefined,
		setStatus: () => undefined,
		preflightStorage: async () => undefined,
		runSelectionEffectWorker: async (request: { channels: Float32Array[];
			context: { beforeChannels?: Float32Array[]; afterChannels?: Float32Array[] } }, options: { pcmOwnership: string }) => {
			assert.equal(options.pcmOwnership, 'transfer');
			jobContexts.push(request.context);
			const channels = structuredClone(request.channels, { transfer: request.channels.map((channel) => channel.buffer) });
			return { channels };
		},
		persistAudacityEffectResults: async (results: Array<{ channels: Float32Array[] }>) => {
			retained.push(results[0]!.channels);
		},
	});
	return { service, lifetime, input, retained, simpleCalls, jobContexts, renders: () => renders,
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

test('Apply reads selection and Repair neighbors once only when neutral PCM and extra admission headroom are available', async () => {
	for (const admission of ['admit', 'fallback'] as const) {
		const value = fixture(true, 1_000_000, admission);
		await value.service.prepareAudacityEffectFromController('audacity-repair');
		await value.service.applySelectedAudacityEffect();
		assert.deepEqual(value.simpleCalls, [[0, 142]]);
		assert.equal(value.renders(), admission === 'admit' ? 0 : 3);
		if (admission === 'admit') {
			assert.deepEqual(value.retained[0], [new Float32Array([0.01, 0.011, 0.012, 0.013])]);
			assert.equal(value.jobContexts[0]!.beforeChannels![0]!.length, 10);
			assert.equal(value.jobContexts[0]!.afterChannels![0]!.length, 128);
		}
	}
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
