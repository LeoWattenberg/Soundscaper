import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createMemoryFfmpeg,
	deferred,
	waitFor,
} from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import {
	COPY,
	createAudioEditorController,
	createMemoryEngine,
} from './helpers/audio-editor-controller-harness.js';


test('live project tabs retain independent history and cross-project clipboard source roots', async () => {
	const store = createMemoryStore();
	const engine = createMemoryEngine();
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine,
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;

	const firstProjectId = controller.getSnapshot().project.id;
	const firstTrack = controller.getSnapshot().project.tracks[0];
	controller.actions.edit.commit({
		type: 'batch',
		commands: [
			{
				type: 'source/add',
				source: {
					id: 'cross-project-source',
					name: 'cross-project.wav',
					storageKey: 'cross-project-source',
					mimeType: 'audio/wav',
					frameCount: 48_000,
					channelCount: 1,
				},
			},
			{
				type: 'clip/add',
				trackId: firstTrack.id,
				clip: {
					id: 'cross-project-clip',
					sourceId: 'cross-project-source',
					timelineStartFrame: 0,
					sourceStartFrame: 0,
					durationFrames: 48_000,
				},
			},
		],
	});
	controller.actions.timeline.setSelection(0, 24_000);
	controller.actions.edit.copy();
	controller.actions.track.update(firstTrack.id, { name: 'First edited' });

	await controller.actions.project.create({ title: 'Second project' });
	const secondProjectId = controller.getSnapshot().project.id;
	assert.notEqual(secondProjectId, firstProjectId);
	assert.deepEqual(controller.getSnapshot().projectTabs.map((tab) => tab.id), [firstProjectId, secondProjectId]);
	assert.equal(controller.getSnapshot().history.hasClipboard, true);

	controller.actions.edit.paste();
	let snapshot = controller.getSnapshot();
	assert.ok(snapshot.project.sources.some((source) => source.id === 'cross-project-source'));
	assert.ok(snapshot.project.clips.some((clip) => clip.sourceId === 'cross-project-source'));

	await controller.actions.project.openById(firstProjectId);
	snapshot = controller.getSnapshot();
	assert.equal(snapshot.project.tracks.find((track) => track.id === firstTrack.id).name, 'First edited');
	controller.actions.edit.undo();
	assert.equal(controller.getSnapshot().project.tracks.find((track) => track.id === firstTrack.id).name, firstTrack.name);

	await controller.actions.project.openById(secondProjectId);
	controller.actions.edit.undo();
	snapshot = controller.getSnapshot();
	assert.equal(snapshot.project.sources.some((source) => source.id === 'cross-project-source'), false);
	assert.equal(snapshot.project.clips.some((clip) => clip.sourceId === 'cross-project-source'), false);
	assert.equal(snapshot.history.hasClipboard, true);
	await controller.actions.project.save();
	assert.ok(store.pruneCalls.at(-1).protectedSourceIds.has('cross-project-source'));

	await controller.actions.project.openById(firstProjectId);
	controller.actions.edit.redo();
	assert.equal(controller.getSnapshot().project.tracks.find((track) => track.id === firstTrack.id).name, 'First edited');
	await controller.dispose();
});

test('headless controller publishes disposing and disposed phases and closes injected runtimes', async () => {
	const store = createMemoryStore();
	const engine = createMemoryEngine();
	const ffmpeg = createMemoryFfmpeg();
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		store,
		engine,
		ffmpeg,
	});
	await controller.ready;

	let notifications = 0;
	controller.subscribe(() => { notifications += 1; });
	await controller.dispose();
	const disposed = controller.getSnapshot();
	assert.equal(disposed.phase, 'disposed');
	assert.equal(disposed.ready, false);
	assert.equal(disposed.disposed, true);
	assert.equal(notifications, 2);
	assert.equal(store.closeCalls, 1);
	assert.equal(engine.disposeCalls, 1);
	assert.equal(ffmpeg.disposeCalls, 1);

	await controller.dispose();
	assert.equal(notifications, 2);
	assert.equal(store.closeCalls, 1);
	assert.equal(engine.disposeCalls, 1);
	assert.equal(ffmpeg.disposeCalls, 1);
	assert.strictEqual(controller.getSnapshot(), disposed);
});

test('bootstrap gives the newest controller the writer lock and makes the previous controller read-only', async () => {
	const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	const heldLocks = new Map();
	const requests = [];
	const locks = {
		request(name, options, callback) {
			requests.push(options);
			if (!options.steal && heldLocks.has(name)) return Promise.resolve(callback(null));
			const owner = {};
			heldLocks.set(name, owner);
			return Promise.resolve(callback({ name })).finally(() => {
				if (heldLocks.get(name) === owner) heldLocks.delete(name);
			});
		},
	};
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: { locks },
	});

	const store = createMemoryStore();
	const first = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	let second;
	try {
		await first.ready;
		second = createAudioEditorController(null, {
			headless: true,
			copy: COPY,
			locale: 'en',
			store,
			engine: createMemoryEngine(),
			ffmpeg: createMemoryFfmpeg(),
		});
		const snapshot = await second.ready;
		assert.equal(snapshot.ready, true);
		assert.equal(snapshot.readOnly, false);
		await waitFor(() => first.getSnapshot().readOnly === true);
		assert.equal(first.getSnapshot().status.state, 'error');
		assert.equal(first.getSnapshot().status.message, 'This project is already open in another tab.');
		assert.equal(requests.filter((options) => options.steal).length, 2);
	} finally {
		await second?.dispose();
		await first.dispose();
		if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
		else delete globalThis.navigator;
	}
});

test('reopening the active project retains its writer lock', async () => {
	let acquisitions = 0;
	let releases = 0;
	const acquisitionOptions = [];
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
		acquireProjectLock: async (projectId, options) => {
			acquisitions += 1;
			acquisitionOptions.push(options);
			return {
				projectId,
				readOnly: false,
				method: 'test',
				release() { releases += 1; },
			};
		},
	});
	await controller.ready;
	const projectId = controller.getSnapshot().project.id;
	await controller.actions.project.openById(projectId);
	assert.equal(controller.getSnapshot().readOnly, false);
	assert.equal(acquisitions, 1);
	assert.equal(releases, 0);
	assert.deepEqual(acquisitionOptions, [{ force: true }]);
	await controller.dispose();
	assert.equal(releases, 1);
});

test('a read-only project automatically becomes writable after its competing lock disappears', async () => {
	let acquisitions = 0;
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
		acquireProjectLock: async (projectId) => {
			acquisitions += 1;
			return {
				projectId,
				readOnly: acquisitions === 1,
				method: 'test',
				retryAt: Date.now(),
				release() {},
			};
		},
	});
	await controller.ready;
	assert.equal(controller.getSnapshot().readOnly, true);
	await waitFor(() => controller.getSnapshot().readOnly === false, 1_000);
	assert.equal(controller.getSnapshot().readOnly, false);
	assert.equal(controller.getSnapshot().status.message, COPY.ready);
	assert.equal(acquisitions, 2);
	await controller.dispose();
});

test('a queued project lock promotes the existing read-only controller without polling', async () => {
	let resolveAvailable;
	const available = new Promise((resolve) => { resolveAvailable = resolve; });
	let lock;
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store: createMemoryStore(),
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
		acquireProjectLock: async (projectId) => {
			lock = {
				projectId,
				readOnly: true,
				method: 'test-queued',
				available,
				release() {},
			};
			return lock;
		},
	});
	await controller.ready;
	assert.equal(controller.getSnapshot().readOnly, true);
	lock.readOnly = false;
	resolveAvailable(lock);
	await waitFor(() => controller.getSnapshot().readOnly === false);
	assert.equal(controller.getSnapshot().status.message, COPY.ready);
	await controller.dispose();
});

test('project flush serializes the latest snapshot and rejects persistence failures', async () => {
	const store = createMemoryStore();
	store.getStatus = () => ({ state: 'indexeddb', backend: 'indexeddb', persistent: true, ephemeral: false, degradedReason: null });
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	await controller.ready;
	const trackId = controller.getSnapshot().project.tracks[0].id;
	const firstSave = deferred();
	const persistedNames = [];
	let saveCount = 0;
	store.saveProject = async (project, options) => {
		await options?.admitProjectPublication(1); saveCount += 1;
		if (saveCount === 1) await firstSave.promise;
		persistedNames.push(project.tracks[0].name);
		store.projects.set(project.id, structuredClone(project));
		return structuredClone(project);
	};
	controller.actions.track.update(trackId, { name: 'First pending name' });
	const pendingFlush = controller.actions.project.flush();
	await Promise.resolve();
	controller.actions.track.update(trackId, { name: 'Latest name' });
	const latestFlush = controller.actions.project.flush();
	firstSave.resolve();
	await Promise.all([pendingFlush, latestFlush]);
	assert.deepEqual(persistedNames, ['First pending name', 'Latest name']);
	assert.equal(store.projects.get(controller.getSnapshot().project.id).tracks[0].name, 'Latest name');
	assert.equal(controller.getSnapshot().storage.lastPreflight.operation, 'project');
	store.saveProject = async (_project, options) => { await options?.admitProjectPublication(1); throw new Error('disk full'); };
	controller.actions.track.update(trackId, { name: 'Cannot persist' });
	await assert.rejects(() => controller.actions.project.flush(), /disk full/);
	assert.equal(controller.getSnapshot().save.state, 'dirty');
	assert.match(controller.getSnapshot().status.message, /disk full/);
	await assert.rejects(() => controller.dispose(), /disk full/);
	assert.equal(controller.getSnapshot().phase, 'disposed');
});
