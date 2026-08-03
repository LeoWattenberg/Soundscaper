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
	'spectral',
	'storage',
	'timeline',
	'track',
	'transport',
	'video',
]);

function createRuntime(capability = true): EditorActionRuntime {
	const callable = () => undefined;
	const runtime = new Proxy<Record<string, unknown>>({}, {
		get(_target, name) {
			if (name === 'capabilities') return new Proxy({}, { get: () => capability });
			if (name === 'product') return { name: 'Soundscaper' };
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

test('controller action facade enforces product capabilities at invocation', () => {
	const actions = createGroupedEditorActions(createRuntime(false));
	const addEffect = actions.effects.add;
	assert.equal(typeof addEffect, 'function');
	if (typeof addEffect !== 'function') throw new TypeError('The effects action must be callable.');
	assert.throws(() => addEffect(), /does not support audioEffects/u);
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
