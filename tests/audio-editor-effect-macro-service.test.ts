/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEffectMacroService } from '../src/common/editor/controller/effect-macro-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import type { EffectTarget } from '../src/common/editor/controller/effect-selection-service.ts';
import { projectGraphLatencyFramesV21 } from '../src/common/editor/engine/project-graph-v21.ts';
import { createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import type { SoundscaperProductionDialogOperation } from '../src/common/editor/ui/dialogs/SoundscaperProductionDialog.tsx';
import {
	executeSoundscaperProductionOperation,
	type SoundscaperProductionControllerPort,
} from '../src/common/editor/ui/workspace/useSoundscaperProductionWorkspace.ts';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';

function deferred<Value>() {
	let resolve: (value: Value) => void = () => undefined;
	let reject: (error: unknown) => void = () => undefined;
	const promise = new Promise<Value>((accept, decline) => { resolve = accept; reject = decline; });
	return { promise, reject, resolve };
}

function createHarness(options: Readonly<{
	blocked?: boolean;
	memoryLimitBytes?: number;
	target?: boolean;
	audacityRack?: boolean;
	project?: Readonly<Record<string, unknown>>;
	validateRenderSnapshot?: (project: Readonly<Record<string, unknown>>) => void;
}> = {}) {
	const defaultProject = {
		id: 'project-a',
		tracks: [{
			id: 'track-a', name: 'Track', type: 'audio' as const, clipIds: ['clip-a'],
			effects: [], gain: 0.5, pan: 0.2, mute: true, solo: true, envelope: [{ frame: 1, value: 0.5 }],
		}],
		master: { gain: 0.7, pan: 0.1, mute: true, effects: [{ id: 'master-fx', type: 'delay' }] },
		mixer: { groups: [{ id: 'group-a' }], sends: [{ id: 'send-a' }], routes: { 'track-a': {} } },
	};
	let project = (options.project ?? defaultProject) as typeof defaultProject;
	const target: EffectTarget = {
		track: project.tracks[0], startFrame: 100, endFrame: 300, durationFrames: 200,
		channelCount: 1, hasAudio: true,
	};
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate(project.id);
	const render = deferred<{ channels: readonly Float32Array[] }>();
	const persisted: unknown[] = [];
	const statuses: Array<readonly [string, string | undefined]> = [];
	const errors: unknown[] = [];
	const snapshots: Readonly<Record<string, unknown>>[] = [];
	let processing = false;
	let publications = 0;
	const service = createEffectMacroService({
		lifetime,
		projectGeneration,
		copy: {
			audioTrackNotFound: 'Track missing',
			audacityApplied: 'Applied',
			audacityProcessing: 'Processing',
			audacitySelectionHint: 'Select audio',
			effectRackEmpty: 'Rack empty',
			macroApplied: 'Macro applied',
			macroEffectsRequired: 'Effects required',
			macroManager: 'Macro',
			macroProcessing: 'Macro processing',
			macroSelectionRequired: 'Selection required',
			untitledMacro: 'Untitled Macro',
		},
		memoryLimitBytes: options.memoryLimitBytes ?? 1_000_000,
		getProject: () => project,
		audacityEffectTarget: () => options.target === false ? null : target,
		editingBlocked: () => Boolean(options.blocked || processing),
		materializeRackEffect: (effect) => ({
			id: String(effect.id), type: String(effect.type), enabled: true,
			params: effect.params as Readonly<Record<string, unknown>> ?? {},
		}),
		projectSampleRate: () => 1_000,
		effectRackLatencyFrames: () => 0,
		isAudacityRackEffectType: () => Boolean(options.audacityRack),
		estimateAudacityEffectPeakBytes: () => options.memoryLimitBytes === 1 ? 2 : 0,
		audacityEffectMemoryError: () => new Error('Too large'),
		setProcessing: (value) => { processing = value; },
		setStatus: (message, status) => { statuses.push([message, status]); },
		publishDocumentSnapshot: () => { publications += 1; },
		preflightStorage: async () => undefined,
		cloneProject: (value) => structuredClone(value),
		renderSnapshot: async (snapshot) => {
			const captured = structuredClone(snapshot) as unknown as Readonly<Record<string, unknown>>;
			snapshots.push(captured);
			options.validateRenderSnapshot?.(snapshot as unknown as Readonly<Record<string, unknown>>);
			return render.promise;
		},
		audioBufferChannels: (buffer) => [...buffer.channels as readonly Float32Array[]],
		matchAudacitySelectionChannels: (channels) => [...channels],
		persistAudacityEffectResult: async (...args) => { persisted.push(args); },
		handleError: (error) => { errors.push(error); },
	});
	return {
		errors,
		get processing() { return processing; },
		get publications() { return publications; },
		persisted,
		render,
		service,
		snapshots,
		statuses,
		switchProject() {
			project = { ...project, id: 'project-b' };
			projectGeneration.invalidate();
			projectGeneration.activate(project.id);
		},
	};
}

const REQUEST = {
	name: 'Voice cleanup',
	effects: [{ id: 'effect-a', type: 'compressor', params: {}, enabled: true }],
};

test('macro rendering neutralizes mixer state and commits one immutable result', async () => {
	const harness = createHarness();
	const pending = harness.service.runEffectMacro(REQUEST);
	assert.equal(harness.processing, true);
	harness.render.resolve({ channels: [new Float32Array([0.25, 0.5])] });
	assert.equal(await pending, true);
	assert.equal(harness.persisted.length, 1);
	assert.equal(harness.processing, false);
	assert.deepEqual(harness.statuses.at(-1), ['Macro applied', 'success']);
});

test('V21 macro rendering isolates the selected track through the exact engine graph', async () => {
	const project = v21MacroProject();
	const canonical = structuredClone(project);
	const harness = createHarness({
		project,
		validateRenderSnapshot: (snapshot) => {
			assert.doesNotThrow(() => projectGraphLatencyFramesV21(snapshot as never, { includeMaster: false }));
		},
	});
	const controller: SoundscaperProductionControllerPort = {
		actions: {
			edit: { commit: () => undefined },
			macros: { run: (request) => harness.service.runEffectMacro(request as never) },
		},
	};
	const pending = Promise.resolve(executeSoundscaperProductionOperation(
		controller,
		{
			type: 'restoration/apply',
			workflow: {
				target: 'selection',
				stages: [{ id: 'clicks', tool: 'click-removal', enabled: true, params: {} }],
			},
		} satisfies SoundscaperProductionDialogOperation,
		() => undefined,
		'track-a',
	));
	harness.render.resolve({ channels: [new Float32Array([0.25, 0.5])] });
	assert.equal(await pending, true);

	const snapshot = harness.snapshots[0] as {
		readonly tracks: readonly Readonly<Record<string, unknown>>[];
		readonly mixer: Readonly<Record<string, unknown>>;
		readonly automationLanes: readonly unknown[];
	};
	assert.deepEqual(project, canonical);
	assert.deepEqual(snapshot.tracks.map(({ id }) => id), ['track-a']);
	assert.equal(Object.hasOwn(snapshot.tracks[0]!, 'envelope'), false);
	assert.equal(snapshot.tracks[0]?.effectsActive, true);
	assert.deepEqual(
		(snapshot.tracks[0]?.effects as readonly Readonly<Record<string, unknown>>[]).map(({ type }) => type),
		['audacity-click-removal'],
	);
	assert.deepEqual(snapshot.automationLanes, []);
	assert.equal(Object.hasOwn(snapshot.mixer, 'routes'), false);
	assert.deepEqual(snapshot.mixer.groups, []);
	assert.deepEqual(snapshot.mixer.sends, []);
	assert.deepEqual(snapshot.mixer.cues, []);
	assert.deepEqual(snapshot.mixer.vcas, []);
});

test('macro completion from a switched project cannot persist or publish success', async () => {
	const harness = createHarness();
	const pending = harness.service.runEffectMacro(REQUEST);
	const publicationsBeforeSwitch = harness.publications;
	harness.switchProject();
	harness.render.resolve({ channels: [new Float32Array([0.25])] });
	await assert.rejects(pending, { code: 'PROJECT_CHANGED' });
	assert.equal(harness.persisted.length, 0);
	assert.equal(harness.processing, false);
	assert.equal(harness.publications, publicationsBeforeSwitch);
	assert.equal(harness.errors.length, 0);
});

test('empty and disabled macro inventories fail before claiming async ownership', async () => {
	const harness = createHarness();
	await assert.rejects(
		() => harness.service.runEffectMacro({ effects: [{ id: 'missing', type: 'missing' }] }),
		/Effects required/u,
	);
	assert.equal(harness.processing, false);
});

test('blocked, missing-target, and peak-memory preflight paths do not start rendering', async () => {
	assert.equal(await createHarness({ blocked: true }).service.runEffectMacro(REQUEST), null);
	await assert.rejects(
		() => createHarness({ target: false }).service.runEffectMacro(REQUEST),
		/Selection required/u,
	);
	await assert.rejects(
		() => createHarness({ memoryLimitBytes: 1, audacityRack: true }).service.runEffectMacro({
			effects: [{ id: 'effect-a', type: 'audacity-compressor', params: {} }],
		}),
		/Too large/u,
	);
});

test('current-project render failures report once and release processing ownership', async () => {
	const harness = createHarness();
	const pending = harness.service.runEffectMacro({ effects: REQUEST.effects });
	const failure = new Error('render failed');
	harness.render.reject(failure);
	await assert.rejects(pending, /render failed/u);
	assert.deepEqual(harness.errors, [failure]);
	assert.equal(harness.processing, false);
});

function v21MacroProject() {
	return createSoundscaperProjectV21({
		id: 'project-a', title: 'Restoration render', now: '2026-08-14T12:00:00.000Z',
		tracks: [
			createAudioTrackV10({ id: 'track-a', name: 'A', clipIds: [] }),
			createAudioTrackV10({ id: 'track-b', name: 'B', clipIds: [] }),
		],
		sequences: [{ id: 'main', trackIds: ['track-a', 'track-b'] }],
		primarySequenceId: 'main',
		automationLanes: [{
			id: 'track-a-gain',
			address: { kind: 'strip', strip: { kind: 'track', id: 'track-a' }, parameterId: 'gain' },
			timebase: 'absolute-samples',
			points: [{ id: 'start', position: 0, value: 0.25 }],
			segments: [],
		}],
	});
}
