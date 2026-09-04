/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEffectMacroService } from '../src/common/editor/controller/effect-macro-service.ts';
import { createEffectMacroTemplateDraft } from '../src/common/editor/effect-macro-templates.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import type { EffectTarget } from '../src/common/editor/controller/effect-selection-service.ts';
import { projectGraphLatencyFramesV21 } from '../src/common/editor/engine/project-graph-v21.ts';
import {
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

function deferred<Value>() {
	let resolve: (value: Value) => void = () => undefined;
	let reject: (error: unknown) => void = () => undefined;
	const promise = new Promise<Value>((accept, decline) => { resolve = accept; reject = decline; });
	return { promise, reject, resolve };
}

function createHarness(options: Readonly<{
	blocked?: boolean;
	deferPersistence?: boolean;
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
	const dryRanges: Array<readonly [string, number, number]> = [];
	const selectionEffectCalls: Array<Readonly<{
		effectType: string;
		channels: readonly Float32Array[];
		params: Readonly<Record<string, unknown>>;
		context: Readonly<Record<string, unknown>>;
	}>> = [];
	const stagedProjects: Array<Readonly<Record<string, unknown>>> = [];
	const stagedSources: Array<ReadonlyMap<string, unknown>> = [];
	const persistence = deferred<void>();
	const persistenceStarted = deferred<void>();
	const persisted: unknown[] = [];
	const persistedProjects: string[] = [];
	const statuses: Array<readonly [string, string | undefined]> = [];
	const errors: unknown[] = [];
	const snapshots: Readonly<Record<string, unknown>>[] = [];
	let processing = false;
	let publications = 0;
	let persistenceCommits = 0;
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
			autoDuckControlTrack: 'Control track required',
			effectInvalidAudio: 'Invalid audio',
			noiseProfileMissing: 'Noise profile required',
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
		renderSnapshot: async (snapshot, _range, sourceBuffers) => {
			const captured = structuredClone(snapshot) as unknown as Readonly<Record<string, unknown>>;
			if (!sourceBuffers) {
				snapshots.push(captured);
				options.validateRenderSnapshot?.(snapshot as unknown as Readonly<Record<string, unknown>>);
				return render.promise;
			}
			// A staged rack run renders audio the chain already holds, so the
			// fake echoes back what the caller handed the source map.
			stagedProjects.push(captured);
			stagedSources.push(sourceBuffers);
			const staged = [...sourceBuffers.values()][0] as
				Readonly<{ channels: readonly Float32Array[] }> | undefined;
			return { channels: (staged?.channels ?? []).map((channel) => channel.map((value) => value * 4)) };
		},
		projectFrameCount: () => 10_000,
		renderDryTrackRange: async (trackId, startFrame, endFrame) => {
			dryRanges.push([trackId, startFrame, endFrame]);
			return [new Float32Array([1, 2])];
		},
		runSelectionEffectWorker: async (request) => {
			selectionEffectCalls.push({
				effectType: request.effectType,
				channels: request.channels.map((channel) => channel.slice()),
				params: request.params,
				context: request.context,
			});
			return { channels: request.channels.map((channel) => channel.map((value) => value + 1)) };
		},
		createAudioBuffer: async (channels) => ({ channels: channels.map((channel) => channel.slice()) }),
		audioBufferChannels: (buffer) => [...buffer.channels as readonly Float32Array[]],
		matchAudacitySelectionChannels: (channels) => [...channels],
		persistAudacityEffectResult: async (...args) => {
			persisted.push(args);
			if (options.deferPersistence) {
				persistenceStarted.resolve(undefined);
				await persistence.promise;
			}
			const persistenceOptions = args[3] as Readonly<{ assertCurrent?: () => void }>;
			persistenceOptions.assertCurrent?.();
			persistenceCommits += 1;
			persistedProjects.push(project.id);
		},
		handleError: (error) => { errors.push(error); },
	});
	return {
		dryRanges,
		errors,
		selectionEffectCalls,
		stagedProjects,
		stagedSources,
		get processing() { return processing; },
		get publications() { return publications; },
		persistence,
		get persistenceCommits() { return persistenceCommits; },
		persistenceStarted,
		persisted,
		persistedProjects,
		render,
		service,
		snapshots,
		statuses,
		supersedeMacroTask() {
			return lifetime.startTask('selection-effect-macro');
		},
		switchProject() {
			project = { ...project, id: 'project-b' };
			projectGeneration.invalidate();
			projectGeneration.activate(project.id);
		},
	};
}

// Offline steps estimate their real worker peak, which carries a fixed overhead.
const OFFLINE_MEMORY_LIMIT_BYTES = 64 * 1024 ** 2;

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
	const restoration = createEffectMacroTemplateDraft('restoration', {
		idFactory: (prefix, index) => `${prefix}-${index ?? 0}`,
	});
	const pending = harness.service.runEffectMacro({
		name: restoration.name,
		trackId: 'track-a',
		effects: [restoration.effects[0]!],
	});
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

test('project switching during macro persistence fences stale commit and publication', async () => {
	const harness = createHarness({ deferPersistence: true });
	const pending = harness.service.runEffectMacro(REQUEST);
	harness.render.resolve({ channels: [new Float32Array([0.25])] });
	await harness.persistenceStarted.promise;
	const publicationsBeforeSwitch = harness.publications;

	harness.switchProject();
	harness.persistence.resolve(undefined);

	await assert.rejects(pending, { code: 'PROJECT_CHANGED' });
	assert.equal(harness.persistenceCommits, 0);
	assert.deepEqual(harness.persistedProjects, []);
	assert.equal(harness.processing, false);
	assert.equal(harness.publications, publicationsBeforeSwitch);
	assert.notDeepEqual(harness.statuses.at(-1), ['Macro applied', 'success']);
	assert.equal(harness.errors.length, 0);
});

test('a superseding macro task fences stale persistence and cleanup publication', async () => {
	const harness = createHarness({ deferPersistence: true });
	const pending = harness.service.runEffectMacro(REQUEST);
	harness.render.resolve({ channels: [new Float32Array([0.25])] });
	await harness.persistenceStarted.promise;
	const publicationsBeforeSupersession = harness.publications;

	const successor = harness.supersedeMacroTask();
	harness.persistence.resolve(undefined);

	await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(harness.persistenceCommits, 0);
	assert.deepEqual(harness.persistedProjects, []);
	assert.equal(harness.processing, true);
	assert.equal(harness.publications, publicationsBeforeSupersession);
	assert.notDeepEqual(harness.statuses.at(-1), ['Macro applied', 'success']);
	assert.equal(harness.errors.length, 0);
	successor.finish();
});

test('cancelling a run aborts it without persisting anything', async () => {
	// The manager had no way to stop a macro at all: a long chain ran to the end
	// or the user switched project. Cancelling takes the same fence a superseding
	// run takes, so nothing half-rendered reaches the project.
	const harness = createHarness({ deferPersistence: true });
	const pending = harness.service.runEffectMacro(REQUEST);
	harness.render.resolve({ channels: [new Float32Array([0.25])] });
	await harness.persistenceStarted.promise;

	assert.equal(harness.service.cancelEffectMacro(), true);
	harness.persistence.resolve(undefined);

	await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(harness.persistenceCommits, 0);
	assert.deepEqual(harness.persistedProjects, []);
	assert.equal(harness.errors.length, 0, 'a cancellation is not an error to report');
	assert.notDeepEqual(harness.statuses.at(-1), ['Macro applied', 'success']);
});

test('cancelling with no run in flight reports that there was nothing to stop', () => {
	assert.equal(createHarness().service.cancelEffectMacro(), false);
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
	return createSoundscaperProject({
		id: 'project-a', title: 'Restoration render', now: '2026-08-14T12:00:00.000Z',
		tracks: [
			createAudioTrack({ id: 'track-a', name: 'A', clipIds: [] }),
			createAudioTrack({ id: 'track-b', name: 'B', clipIds: [] }),
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

test('a macro that mixes realtime and offline steps chains one into the next', async () => {
	const harness = createHarness({ memoryLimitBytes: OFFLINE_MEMORY_LIMIT_BYTES });
	const pending = harness.service.runEffectMacro({
		name: 'Clean and level',
		effects: [
			{ id: 'effect-a', type: 'compressor', params: {} },
			{ id: 'effect-b', type: 'audacity-amplify', params: { gainDb: 3 } },
			{ id: 'effect-c', type: 'audacity-normalize', params: {} },
		],
	});
	harness.render.resolve({ channels: [new Float32Array([0.25, 0.5])] });
	assert.equal(await pending, true);

	// The realtime run renders from the timeline, then each offline step is
	// handed what the step before it produced.
	assert.deepEqual(harness.snapshots.length, 1);
	assert.deepEqual(harness.selectionEffectCalls.map(({ effectType }) => effectType), [
		'audacity-amplify', 'audacity-normalize',
	]);
	assert.deepEqual([...harness.selectionEffectCalls[0]!.channels[0]!], [0.25, 0.5]);
	assert.deepEqual([...harness.selectionEffectCalls[1]!.channels[0]!], [1.25, 1.5]);
	assert.equal(harness.selectionEffectCalls[0]?.params.gainDb, 3);
	assert.equal(harness.persisted.length, 1);
	assert.deepEqual(
		[...(harness.persisted[0] as [unknown, unknown, readonly Float32Array[]])[2][0]!],
		[2.25, 2.5],
	);
});

test('a macro that starts offline reads the dry selection instead of a rack render', async () => {
	const harness = createHarness({ memoryLimitBytes: OFFLINE_MEMORY_LIMIT_BYTES });
	assert.equal(await harness.service.runEffectMacro({
		name: 'Amplify',
		effects: [{ id: 'effect-a', type: 'audacity-amplify', params: {} }],
	}), true);
	assert.deepEqual(harness.dryRanges, [['track-a', 100, 300]]);
	assert.equal(harness.snapshots.length, 0);
	assert.deepEqual(harness.selectionEffectCalls.map(({ effectType }) => effectType), ['audacity-amplify']);
	assert.deepEqual([...harness.selectionEffectCalls[0]!.channels[0]!], [1, 2]);
});

test('a realtime run after an offline step renders through a staged one-clip project', async () => {
	const harness = createHarness({ memoryLimitBytes: OFFLINE_MEMORY_LIMIT_BYTES });
	assert.equal(await harness.service.runEffectMacro({
		name: 'Level then colour',
		effects: [
			{ id: 'effect-a', type: 'audacity-amplify', params: {} },
			{ id: 'effect-b', type: 'compressor', params: {} },
			{ id: 'effect-c', type: 'delay', params: {} },
		],
	}), true);

	assert.equal(harness.stagedProjects.length, 1);
	const staged = harness.stagedProjects[0] as {
		readonly tracks: readonly Readonly<Record<string, unknown>>[];
		readonly clips: readonly Readonly<Record<string, unknown>>[];
		readonly sources: readonly Readonly<Record<string, unknown>>[];
	};
	assert.deepEqual(
		(staged.tracks[0]?.effects as readonly Readonly<Record<string, unknown>>[]).map(({ type }) => type),
		['compressor', 'delay'],
	);
	assert.equal(staged.clips.length, 1);
	assert.equal(staged.clips[0]?.durationFrames, 2);
	assert.equal(staged.sources[0]?.frameCount, 2);
	// The staged source carries the audio the offline step produced.
	const stagedBuffer = [...harness.stagedSources[0]!.values()][0] as
		Readonly<{ channels: readonly Float32Array[] }>;
	assert.deepEqual([...stagedBuffer.channels[0]!], [2, 3]);
	assert.deepEqual(
		[...(harness.persisted[0] as [unknown, unknown, readonly Float32Array[]])[2][0]!],
		[8, 12],
	);
});

test('an offline step that reads across the selection edge is given the neighbouring audio', async () => {
	const harness = createHarness({ memoryLimitBytes: OFFLINE_MEMORY_LIMIT_BYTES });
	assert.equal(await harness.service.runEffectMacro({
		name: 'Repair',
		effects: [{ id: 'effect-a', type: 'audacity-repair', params: {} }],
	}), true);
	assert.deepEqual(harness.dryRanges, [
		['track-a', 100, 300],
		['track-a', 0, 100],
		['track-a', 300, 428],
	]);
	const context = harness.selectionEffectCalls[0]?.context as Readonly<{
		beforeChannels?: readonly Float32Array[];
		afterChannels?: readonly Float32Array[];
	}>;
	assert.equal(context.beforeChannels?.length, 1);
	assert.equal(context.afterChannels?.length, 1);
});
