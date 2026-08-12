/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createGroupedEditorActions,
	type EditorActionRuntime,
} from '../src/common/editor/controller/action-facade.ts';

const EXPECTED_ACTION_GROUPS = Object.freeze([
	'analysis',
	'audioDevices',
	'audioWarp',
	'clip',
	'edit',
	'effects',
	'export',
	'generators',
	'labels',
	'macros',
	'metadata',
	'metering',
	'mixer',
	'nyquist',
	'preferences',
	'project',
	'projectBin',
	'recording',
	'sampleEdit',
	'sequences',
	'spectral',
	'storage',
	'takeComp',
	'timeline',
	'timelineAnnotations',
	'track',
	'trackFolders',
	'transport',
	'video',
]);

function createRuntime(capability = true): EditorActionRuntime {
	const callable = () => undefined;
	const videoTrimServices = Object.freeze({
		edge: Object.freeze({ preview: callable, commit: callable, commitStep: callable }),
		rollRipple: Object.freeze({ preview: callable, commit: callable }),
		slipSlide: Object.freeze({ buildStepRequest: callable, preview: callable, commit: callable }),
		rateStretch: Object.freeze({ preview: callable, commit: callable, commitStep: callable }),
	});
	const runtime = new Proxy<Record<string, unknown>>({}, {
		get(_target, name) {
			if (name === 'capabilities') return new Proxy({}, { get: () => capability });
			if (name === 'product') return { name: 'Soundscaper' };
			if (name === 'videoTrimServices') return videoTrimServices;
			if (name === 'copy') return { projectNotFound: 'Not found', localSourcesMissing: 'Missing', audioClipNotFound: 'Missing' };
			if (name === 'project') return { tracks: [], clips: [] };
			if (name === 'state') return {
				recentProjectIds: [],
				projects: [],
				preferences: { recording: {} },
				audacityEffectType: 'amplify',
				effectPresets: {},
			};
			if (name === 'engine' || name === 'analysisService' || name === 'store') {
				return new Proxy({}, { get: () => callable });
			}
			if (name === 'AUDIO_EDITOR_DEFAULT_SHORTCUTS') return {};
			return callable;
		},
	});
	return runtime as EditorActionRuntime;
}

test('controller action facade exposes stable frozen responsibility groups', () => {
	const actions = createGroupedEditorActions(createRuntime());
	assert.deepEqual(Object.keys(actions).sort(), EXPECTED_ACTION_GROUPS);
	assert.equal(Object.isFrozen(actions), true);
	for (const group of Object.values(actions)) assert.equal(Object.isFrozen(group), true);
});

test('project actions dispatch stable-ID musical map commands', () => {
	const commands: unknown[] = [];
	const base = createRuntime();
	let stableId = 0;
	const runtime = new Proxy(base, {
		get(target, name, receiver) {
			if (name === 'commit') return (command: unknown) => { commands.push(command); return command; };
			if (name === 'createStableId') return (prefix: unknown) => `${String(prefix)}-${String(++stableId)}`;
			return Reflect.get(target, name, receiver);
		},
	});
	const actions = createGroupedEditorActions(runtime).project;
	const invoke = (name: string, ...args: unknown[]) => {
		const action = actions[name];
		if (typeof action !== 'function') throw new TypeError(`Missing project action: ${name}.`);
		return action(...args);
	};
	invoke('setTempoMapMode', 'sampleLocked');
	invoke('addTempoEvent', { samplePosition: 96_000, bpm: { num: 90, den: 1 } });
	invoke('updateTempoEvent', 'tempo-1', { bpm: { num: 60, den: 1 } });
	invoke('removeTempoEvent', 'tempo-2');
	invoke('addSignatureEvent', { bar: 4, numerator: 7, denominator: 8 });
	invoke('updateSignatureEvent', 'signature-1', { numerator: 6 });
	invoke('removeSignatureEvent', 'signature-2');
	assert.deepEqual(commands, [
		{ type: 'tempo-map/mode-set', mode: 'sampleLocked' },
		{
			type: 'tempo-event/add',
			event: { id: 'tempo-1', samplePosition: 96_000, bpm: { num: 90, den: 1 } },
		},
		{ type: 'tempo-event/update', eventId: 'tempo-1', changes: { bpm: { num: 60, den: 1 } } },
		{ type: 'tempo-event/remove', eventId: 'tempo-2' },
		{
			type: 'signature-event/add',
			event: { id: 'signature-2', bar: 4, numerator: 7, denominator: 8 },
		},
		{ type: 'signature-event/update', eventId: 'signature-1', changes: { numerator: 6 } },
		{ type: 'signature-event/remove', eventId: 'signature-2' },
	]);
});

test('controller action facade enforces product capabilities at invocation', () => {
	const actions = createGroupedEditorActions(createRuntime(false));
	const addEffect = actions.effects.add;
	assert.equal(typeof addEffect, 'function');
	if (typeof addEffect !== 'function') throw new TypeError('The effects action must be callable.');
	assert.throws(() => addEffect(), /does not support audioEffects/u);
});

test('Framescaper video navigation actions share one capability-gated service', () => {
	const calls: string[] = [];
	const statuses: string[] = [];
	const view = (rate: number, positionFrame: number) => ({ rate, positionFrame, sequenceId: 'main' });
	const service = {
		view: () => { calls.push('view'); return view(0, 0); },
		shuttleReverse: () => { calls.push('reverse'); return view(-1, 10); },
		shuttleStop: () => { calls.push('stop'); return view(0, 10); },
		shuttleForward: () => { calls.push('forward'); return view(1, 20); },
		previousEditPoint: () => { calls.push('previous'); return 10; },
		nextEditPoint: () => { calls.push('next'); return 20; },
	};
	const runtime = new Proxy(createRuntime(), {
		get(target, name, receiver) {
			if (name === 'videoNavigationService') return service;
			if (name === 'sequenceTimingService') return {
				label: (frame: unknown) => `TC-${String(frame)}`,
				playheadLabel: () => 'TC-playhead',
			};
			if (name === 'setStatus') return (message: unknown) => statuses.push(String(message));
			if (name === 'copy') return {
				shuttleBackward: 'Reverse shuttle', shuttleForward: 'Forward shuttle',
				shuttleStatus: '{direction} {rate}× at {timecode}',
				shuttleStoppedStatus: 'Shuttle stopped at {timecode}',
				previousEditStatus: 'Previous edit at {timecode}', nextEditStatus: 'Next edit at {timecode}',
				noPreviousEdit: 'No previous edit point', noNextEdit: 'No next edit point',
			};
			return Reflect.get(target, name, receiver);
		},
	});
	const navigation = createGroupedEditorActions(runtime).video.navigation;
	if (typeof navigation !== 'object' || navigation === null) {
		throw new TypeError('The video navigation action group is unavailable.');
	}
	for (const name of ['view', 'shuttleBackward', 'shuttleStop', 'shuttleForward', 'previousEdit', 'nextEdit']) {
		const action = navigation[name];
		if (typeof action !== 'function') throw new TypeError(`Missing video navigation action: ${name}.`);
		action();
	}
	assert.deepEqual(calls, ['view', 'reverse', 'stop', 'forward', 'previous', 'next']);
	assert.deepEqual(statuses, [
		'Reverse shuttle 1× at TC-10',
		'Shuttle stopped at TC-10',
		'Forward shuttle 1× at TC-20',
		'Previous edit at TC-playhead',
		'Next edit at TC-playhead',
	]);
	assert.equal(Object.isFrozen(navigation), true);

	const unavailable = createGroupedEditorActions(new Proxy(runtime, {
		get(target, name, receiver) {
			if (name === 'capabilities') return { videoCompositing: false };
			return Reflect.get(target, name, receiver);
		},
	})).video.navigation;
	const unavailableForward = typeof unavailable === 'object' && unavailable !== null
		? unavailable.shuttleForward
		: null;
	if (typeof unavailableForward !== 'function') {
		throw new TypeError('The guarded video navigation action is unavailable.');
	}
	assert.throws(() => unavailableForward(), /does not support videoCompositing/u);
});

test('ordinary transport retires Framescaper shuttle without touching Soundscaper projects', () => {
	const run = (videoCompositing: boolean) => {
		const calls: string[] = [];
		const runtime = new Proxy(createRuntime(), {
			get(target, name, receiver) {
				if (name === 'capabilities') return { videoCompositing };
				if (name === 'videoNavigationService') return { shuttleStop: () => calls.push('shuttle-stop') };
				if (name === 'handleTransport') return () => calls.push('play');
				return Reflect.get(target, name, receiver);
			},
		});
		const playPause = createGroupedEditorActions(runtime).transport.playPause;
		if (typeof playPause !== 'function') throw new TypeError('The play action is unavailable.');
		playPause();
		return calls;
	};
	assert.deepEqual(run(true), ['shuttle-stop', 'play']);
	assert.deepEqual(run(false), ['play']);
});

test('recording actions expose one capability-guarded sound activation preference group', async () => {
	const calls: unknown[][] = [];
	const base = createRuntime();
	const runtime = new Proxy(base, {
		get(target, name, receiver) {
			if (name === 'soundActivationPolicyService') return {
				setEnabled: async (...args: unknown[]) => { calls.push(['enabled', ...args]); return true; },
				setThresholdDb: async (...args: unknown[]) => { calls.push(['threshold', ...args]); return true; },
				setHysteresisDb: async (...args: unknown[]) => { calls.push(['hysteresis', ...args]); return true; },
				setHoldMilliseconds: async (...args: unknown[]) => { calls.push(['hold', ...args]); return true; },
			};
			return Reflect.get(target, name, receiver);
		},
	});
	const soundActivation = createGroupedEditorActions(runtime).recording.soundActivation;
	if (typeof soundActivation !== 'object' || soundActivation === null) {
		throw new TypeError('The sound activation action group is unavailable.');
	}
	for (const [name, value] of [
		['setEnabled', true],
		['setThresholdDb', -24],
		['setHysteresisDb', 3],
		['setHoldMilliseconds', 500],
	] as const) {
		const action: unknown = (soundActivation as Readonly<Record<string, unknown>>)[name];
		if (typeof action !== 'function') throw new TypeError(`Missing sound activation action ${name}.`);
		assert.equal(await action(value), true);
	}
	assert.deepEqual(calls, [
		['enabled', true], ['threshold', -24], ['hysteresis', 3], ['hold', 500],
	]);
	assert.equal(Object.isFrozen(soundActivation), true);

	const blocked = createGroupedEditorActions(new Proxy(runtime, {
		get(target, name, receiver) {
			if (name === 'capabilities') return { audioRecording: false };
			return Reflect.get(target, name, receiver);
		},
	})).recording.soundActivation;
	if (typeof blocked !== 'object' || blocked === null) {
		throw new TypeError('The blocked sound activation action group is unavailable.');
	}
	const setEnabled: unknown = (blocked as Readonly<Record<string, unknown>>).setEnabled;
	if (typeof setEnabled !== 'function') throw new TypeError('The blocked sound activation action is unavailable.');
	assert.throws(() => setEnabled(true), /does not support audioRecording/u);
});

test('general preference actions cannot bypass sound activation ownership', () => {
	let updates = 0;
	let reverts = 0;
	const current = {
		enabled: true,
		thresholdDb: -24,
		hysteresisDb: 3,
		holdMilliseconds: 500,
	};
	const base = createRuntime();
	const runtime = new Proxy(base, {
		get(target, name, receiver) {
			if (name === 'updatePreferences') return () => { updates += 1; };
			if (name === 'revertFactorySettings') return () => { reverts += 1; return 'reverted'; };
			if (name === 'soundActivationPolicyService') return {
				getSnapshot: () => ({
					preferences: current,
					preferenceMutationBlocked: true,
				}),
				setEnabled: async () => true,
				setThresholdDb: async () => true,
				setHysteresisDb: async () => true,
				setHoldMilliseconds: async () => true,
			};
			return Reflect.get(target, name, receiver);
		},
	});
	const preferences = createGroupedEditorActions(runtime).preferences;
	const update: unknown = preferences.update;
	const revert: unknown = preferences.revertFactorySettings;
	if (typeof update !== 'function' || typeof revert !== 'function') {
		throw new TypeError('The general preference actions are unavailable.');
	}

	assert.throws(() => update({
		recording: { soundActivation: current },
	}), /dedicated recording sound activation actions/u);
	assert.equal(updates, 0);
	assert.equal(revert(), false);
	assert.equal(reverts, 0);

	const pendingDefault = createGroupedEditorActions(new Proxy(runtime, {
		get(target, name, receiver) {
			if (name === 'soundActivationPolicyService') return {
				...Reflect.get(target, name, receiver),
				getSnapshot: () => ({
					preferences: {
						enabled: false,
						thresholdDb: -40,
						hysteresisDb: 6,
						holdMilliseconds: 250,
					},
					preferenceMutationBlocked: true,
					preferenceMutationBlockReason: 'preference-update',
				}),
			};
			return Reflect.get(target, name, receiver);
		},
	})).preferences.revertFactorySettings;
	if (typeof pendingDefault !== 'function') {
		throw new TypeError('The pending factory reset action is unavailable.');
	}
	assert.equal(pendingDefault(), false);
	assert.equal(reverts, 0);

	const framescaper = createGroupedEditorActions(new Proxy(runtime, {
		get(target, name, receiver) {
			if (name === 'capabilities') return { audioRecording: false };
			if (name === 'soundActivationPolicyService') return {
				...Reflect.get(target, name, receiver),
				getSnapshot: () => ({
					preferences: {
						enabled: false,
						thresholdDb: -40,
						hysteresisDb: 6,
						holdMilliseconds: 250,
					},
					preferenceMutationBlocked: false,
				}),
			};
			return Reflect.get(target, name, receiver);
		},
	})).preferences;
	const framescaperRevert: unknown = framescaper.revertFactorySettings;
	if (typeof framescaperRevert !== 'function') {
		throw new TypeError('The Framescaper factory reset action is unavailable.');
	}
	assert.equal(framescaperRevert(), 'reverted');
	assert.equal(reverts, 1);
});

test('controller action facade exposes the complete native timeline annotation workflow', () => {
	const calls: Array<readonly [string, ...unknown[]]> = [];
	const service = new Proxy<Record<string, (...args: unknown[]) => unknown>>({}, {
		get(_target, name) {
			return (...args: unknown[]) => {
				calls.push([String(name), ...args]);
				return name;
			};
		},
	});
	const base = createRuntime();
	const runtime = new Proxy(base, {
		get(target, name, receiver) {
			if (name === 'timelineAnnotationService') return service;
			if (name === 'createStableId') return () => 'annotation-batch-created';
			return Reflect.get(target, name, receiver);
		},
	});
	const actions = createGroupedEditorActions(runtime).timelineAnnotations;
	const invoke = (name: string, ...args: unknown[]) => {
		const action = actions[name];
		if (typeof action !== 'function') throw new TypeError(`Missing timeline annotation action: ${name}.`);
		return action(...args);
	};

	invoke('createMarkerAtPlayhead', { anchor: 'musical' });
	invoke('createRegionFromSelection', { name: 'Verse' });
	invoke('focus', 'marker');
	invoke('clearFocus');
	invoke('select', 'marker', true);
	invoke('selectMany', ['marker', 'region'], 'region');
	invoke('toggle', 'marker');
	invoke('rename', ['marker'], 'Cue');
	invoke('setColor', ['marker'], 'red');
	invoke('move', ['marker'], 48, 'marker');
	invoke('resize', 'region', 'end', 96);
	invoke('convert', 'marker', { kind: 'region', anchor: 'sample', regionEndFrame: 144 });
	invoke('batch', ['marker', 'region'], 'batch');
	invoke('batch', ['marker', 'region']);
	invoke('unbatch', ['marker', 'region']);
	invoke('remove', ['marker']);
	invoke('previous', 'main-sequence');
	invoke('next', 'main-sequence');

	assert.deepEqual(calls, [
		['createMarker', { anchor: 'musical' }],
		['createRegion', { name: 'Verse' }],
		['focusAnnotation', 'marker'],
		['clearFocus'],
		['selectAnnotation', 'marker', true],
		['selectAnnotations', ['marker', 'region'], 'region'],
		['toggleAnnotation', 'marker'],
		['renameAnnotations', ['marker'], 'Cue'],
		['setAnnotationColor', ['marker'], 'red'],
		['moveAnnotations', ['marker'], 48, 'marker'],
		['resizeAnnotation', 'region', 'end', 96],
		['convertAnnotation', 'marker', { kind: 'region', anchor: 'sample', regionEndFrame: 144 }],
		['setAnnotationBatch', ['marker', 'region'], 'batch'],
		['setAnnotationBatch', ['marker', 'region'], 'annotation-batch-created'],
		['setAnnotationBatch', ['marker', 'region'], null],
		['removeAnnotations', ['marker']],
		['navigatePreviousAnnotation', 'main-sequence'],
		['navigateNextAnnotation', 'main-sequence'],
	]);
});

test('timeline annotation actions remain capability gated until product activation', () => {
	const actions = createGroupedEditorActions(createRuntime(false)).timelineAnnotations;
	const createMarker = actions.createMarkerAtPlayhead;
	if (typeof createMarker !== 'function') throw new TypeError('Timeline marker creation must be callable.');
	assert.throws(() => createMarker(), /does not support timelineAnnotations/u);
});

test('controller action facade exposes explicit safe storage operations', async () => {
	const calls: string[] = [];
	const base = createRuntime();
	const overrides: Readonly<Record<string, () => void>> = {
		refreshStorageUsage: () => { calls.push('refresh'); },
		requestStoragePersistence: () => { calls.push('persist'); },
		cleanupDisposableStorage: () => { calls.push('cleanup'); },
		cleanupDerivativeCache: () => { calls.push('cleanup-derivatives'); },
	};
	const runtime = new Proxy(base, {
		get(target, name, receiver) {
			return typeof name === 'string' && Object.hasOwn(overrides, name)
				? overrides[name]
				: Reflect.get(target, name, receiver);
		},
	});
	const actions = createGroupedEditorActions(runtime);
	const refresh = actions.storage.refresh;
	const persist = actions.storage.requestPersistence;
	const cleanup = actions.storage.cleanupDisposable;
	const cleanupDerivatives = actions.storage.cleanupDerivatives;
	if (
		typeof refresh !== 'function'
		|| typeof persist !== 'function'
		|| typeof cleanup !== 'function'
		|| typeof cleanupDerivatives !== 'function'
	) {
		throw new TypeError('Storage actions must be callable.');
	}
	await refresh();
	await persist();
	await cleanup();
	await cleanupDerivatives();
	assert.deepEqual(calls, ['refresh', 'persist', 'cleanup', 'cleanup-derivatives']);
});

test('controller action facade routes Scape inspection through its owned service', async () => {
	const calls: unknown[][] = [];
	const base = createRuntime();
	const expected = Object.freeze({ id: 'inspected-project' });
	const runtime = new Proxy(base, {
		get(target, name, receiver) {
			if (name === 'inspectScape') return (...args: unknown[]) => { calls.push(args); return expected; };
			return Reflect.get(target, name, receiver);
		},
	});
	const actions = createGroupedEditorActions(runtime);
	const inspect = actions.project.inspectScape;
	if (typeof inspect !== 'function') throw new TypeError('Scape inspection must be callable.');
	const file = new Blob(['scape']);
	const options = { marker: 'owned-service' };

	assert.equal(await inspect(file, options), expected);
	assert.deepEqual(calls, [[file, options]]);
});

test('controller action facade routes Scape file opens through continuation ownership', async () => {
	const calls: unknown[][] = [];
	const base = createRuntime();
	const expected = Object.freeze({ cancelled: true });
	const runtime = new Proxy(base, {
		get(target, name, receiver) {
			if (name === 'openScapeFile') return (...args: unknown[]) => { calls.push(args); return expected; };
			return Reflect.get(target, name, receiver);
		},
	});
	const actions = createGroupedEditorActions(runtime);
	const open = actions.project.openScapeFile;
	if (typeof open !== 'function') throw new TypeError('Scape file open must be callable.');
	const file = new Blob(['scape']);
	const choose = () => 'cancel';

	assert.equal(await open(file, choose), expected);
	assert.deepEqual(calls, [[file, choose]]);
});

test('controller action facade exposes source-level video visual ownership', async () => {
	const expected = Object.freeze({ mediaUrl: 'blob:fallback-video' });
	const releases: unknown[][] = [];
	const base = createRuntime();
	const runtime = new Proxy(base, {
		get(target, name, receiver) {
			if (name === 'getVideoSourceVisualData') return (sourceId: unknown) => {
				assert.equal(sourceId, 'fallback-video');
				return expected;
			};
			if (name === 'releaseVideoSourceVisual') return (...args: unknown[]) => {
				releases.push(args);
				return true;
			};
			return Reflect.get(target, name, receiver);
		},
	});
	const actions = createGroupedEditorActions(runtime);
	const getSourceVisualData = actions.video.getSourceVisualData;
	if (typeof getSourceVisualData !== 'function') throw new TypeError('Video source lookup must be callable.');
	assert.strictEqual(getSourceVisualData('fallback-video'), expected);
	const releaseSourceVisual = actions.video.releaseSourceVisual;
	if (typeof releaseSourceVisual !== 'function') throw new TypeError('Video source release must be callable.');
	assert.equal(await releaseSourceVisual('fallback-video', 'blob:fallback-video'), true);
	assert.deepEqual(releases, [['fallback-video', 'blob:fallback-video']]);
});

test('controller action facade forwards the exact linked-video relink snapshot', async () => {
	const calls: unknown[][] = [];
	const base = createRuntime();
	const runtime = new Proxy(base, {
		get(target, name, receiver) {
			if (name === 'relinkLinkedVideo') return (...args: unknown[]) => { calls.push(args); return 'video-source'; };
			return Reflect.get(target, name, receiver);
		},
	});
	const actions = createGroupedEditorActions(runtime);
	const relink = actions.projectBin.relinkLinkedVideo;
	if (typeof relink !== 'function') throw new TypeError('Linked-video relink must be callable.');
	const file = new File(['video'], 'selected.mp4', { type: 'video/mp4' });
	const locator = Object.freeze({ locatorId: 'locator-selected', locatorRevision: 'revision-selected' });

	assert.equal(await relink('bin-video', file, locator), 'video-source');
	assert.deepEqual(calls, [['bin-video', file, locator]]);
});

test('controller action facade keeps linked-audio eligibility and relink pathless', async () => {
	const calls: Array<readonly [string, ...unknown[]]> = [];
	const base = createRuntime();
	const runtime = new Proxy(base, {
		get(target, name, receiver) {
			if (name === 'canRelinkLinkedAudio') return (...args: unknown[]) => {
				calls.push(['eligible', ...args]);
				return true;
			};
			if (name === 'relinkLinkedAudio') return (...args: unknown[]) => {
				calls.push(['relink', ...args]);
				return 'audio-source';
			};
			return Reflect.get(target, name, receiver);
		},
	});
	const actions = createGroupedEditorActions(runtime);
	const eligible = actions.projectBin.canRelinkLinkedAudio;
	const relink = actions.projectBin.relinkLinkedAudio;
	if (typeof eligible !== 'function' || typeof relink !== 'function') {
		throw new TypeError('Linked-audio relink actions must be callable.');
	}
	const file = new File(['audio'], 'selected.wav', { type: 'audio/wav' });
	const locator = Object.freeze({ locatorId: 'locator-selected', locatorRevision: 'revision-selected' });
	const target = Object.freeze({ projectId: 'project-selected', projectRevision: 7 });

	assert.equal(await eligible('bin-audio'), true);
	assert.equal(await relink('bin-audio', file, locator, target), 'audio-source');
	assert.deepEqual(calls, [
		['eligible', 'bin-audio'],
		['relink', 'bin-audio', file, locator, target],
	]);
});
