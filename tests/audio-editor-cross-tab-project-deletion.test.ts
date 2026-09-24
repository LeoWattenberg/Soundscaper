/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createVideoClip, createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const LOCATOR_ID = 'locator_cross_tab_00000001';
const LOCATOR_REVISION = 'snapshot_cross_tab_00000001';

for (const deletion of ['deleteProject', 'deleteProjectIfCurrent', 'deleteExact'] as const) {
	test(`${deletion} preserves another open editor's linked-original history`, async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const databaseName = `cross-tab-project-delete-${deletion}-${crypto.randomUUID()}`;
	const released: unknown[] = [];
	const options = {
		indexedDB, databaseName, memoryFallback: false, preferOpfs: false,
		linkedVideoOriginalPort: {
			load: (_locatorId: string, { expectedRevision }: { expectedRevision: string | null }) => ({
				blob: new Blob(['linked video'], { type: 'video/mp4' }),
				locatorRevision: expectedRevision ?? LOCATOR_REVISION,
			}),
			release: (reference: unknown) => { released.push(reference); return true; },
		},
	};
	const first = createProjectStore(options);
	const second = createProjectStore(options);
	try {
		await first.ready();
		await second.ready();
		const project = await second.createProjectIfAbsent({ id: 'project-a', revision: 0 });
		assert.ok(project);
		const source = Object.freeze({
			kind: 'video' as const, id: 'source-a', storageKey: 'storage-a', mimeType: 'video/mp4',
			frameCount: 1, sampleRate: 48_000, width: 16, height: 9, frameRate: 30,
			videoCodec: 'h264', audioCodec: null, hasAudio: false,
		});
		await first.bindLinkedVideoOriginal('project-a', source, LOCATOR_ID);
		assert.ok(await first.getLinkedVideoOriginalBinding('project-a', source.id));
		assert.ok(await first.loadProject(project.id));
		const remove = () => deletion === 'deleteProject'
			? second.deleteProject(project.id)
			: deletion === 'deleteProjectIfCurrent'
				? second.deleteProjectIfCurrent(project)
				: second.projectRepository.deleteExact!(project);
		await assert.rejects(remove(), /another editor session still owns local project history/iu);
		assert.ok(await first.loadProject(project.id));
		assert.ok(await first.getLinkedVideoOriginalBinding(project.id, source.id));
		assert.deepEqual(released, []);
		await first.close();
		assert.equal(await remove(), deletion === 'deleteProject' ? undefined : true);
		assert.equal(await second.loadProject(project.id), null);
		if (deletion === 'deleteProject') {
			assert.deepEqual(released, [{ locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION }]);
		}
	} finally {
		await first.close();
		await second.close();
	}
});
}

test('explicit linked locator release waits for a foreign session to close', async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const databaseName = `cross-tab-explicit-release-${crypto.randomUUID()}`;
	const released: unknown[] = [];
	const options = {
		indexedDB, databaseName, memoryFallback: false, preferOpfs: false,
		linkedVideoOriginalPort: {
			load: () => null,
			release: (reference: unknown) => { released.push(reference); return true; },
		},
	};
	const first = createProjectStore(options);
	const second = createProjectStore(options);
	const reference = { locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION };
	try {
		await first.ready();
		await second.ready();
		assert.equal(await second.releaseLinkedVideoOriginalLocator(reference), false);
		assert.deepEqual(released, []);
		await first.close();
		await second.deleteProject('retry-trigger');
		assert.deepEqual(released, [reference]);
	} finally {
		await first.close();
		await second.close();
	}
});

test('locator release fences new session registration through the physical callback', async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const databaseName = `cross-tab-release-fence-${crypto.randomUUID()}`;
	let beginRelease!: () => void;
	let finishRelease!: () => void;
	const releaseStarted = new Promise<void>((resolve) => { beginRelease = resolve; });
	const releaseFinished = new Promise<void>((resolve) => { finishRelease = resolve; });
	const options = {
		indexedDB, databaseName, memoryFallback: false, preferOpfs: false,
		linkedVideoOriginalPort: {
			load: () => null,
			async release() { beginRelease(); await releaseFinished; return true; },
		},
	};
	const releasingStore = createProjectStore(options);
	const arrivingStore = createProjectStore(options);
	try {
		await releasingStore.ready();
		const releasing = releasingStore.releaseLinkedVideoOriginalLocator({
			locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
		});
		await releaseStarted;
		let registered = false;
		const registering = arrivingStore.ready().then(() => { registered = true; });
		await new Promise<void>((resolve) => { setTimeout(resolve, 10); });
		assert.equal(registered, false);
		finishRelease();
		assert.equal(await releasing, true);
		await registering;
		assert.equal(registered, true);
	} finally {
		finishRelease();
		await releasingStore.close();
		await arrivingStore.close();
	}
});

test('durable locator release fails closed without browser locks', async () => {
	const navigator = globalThis.navigator;
	const original = Object.getOwnPropertyDescriptor(navigator, 'locks');
	let store: ReturnType<typeof createProjectStore>;
	let releases = 0;
	try {
		Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
		store = createProjectStore({
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			databaseName: `cross-tab-no-lock-release-${crypto.randomUUID()}`,
			memoryFallback: false, preferOpfs: false,
			linkedVideoOriginalPort: {
				load: () => null,
				release: () => { releases += 1; return true; },
			},
		});
	} finally {
		if (original) Object.defineProperty(navigator, 'locks', original);
		else Reflect.deleteProperty(navigator, 'locks');
	}
	try {
		await store!.ready();
		assert.equal(await store!.releaseLinkedVideoOriginalLocator({
			locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
		}), false);
		assert.equal(releases, 0);
	} finally { await store!.close(); }
});

test('startup locator reconciliation waits for a foreign session to close', async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const databaseName = `cross-tab-locator-reconcile-${crypto.randomUUID()}`;
	let reconciliations = 0;
	const options = {
		indexedDB, databaseName, memoryFallback: false, preferOpfs: false,
		linkedVideoOriginalPort: {
			load: () => null,
			reconcile: () => { reconciliations += 1; return 0; },
		},
	};
	const first = createProjectStore(options);
	const second = createProjectStore(options);
	try {
		await first.ready();
		await second.ready();
		assert.equal(await second.reconcileLinkedVideoOriginalLocators(), false);
		assert.equal(reconciliations, 0);
		await first.close();
		assert.equal(await second.reconcileLinkedVideoOriginalLocators(), true);
		assert.equal(reconciliations, 1);
	} finally {
		await first.close();
		await second.close();
	}
});

test('project save defers linked binding pruning held by another editor', async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const databaseName = `cross-tab-binding-prune-${crypto.randomUUID()}`;
	const released: unknown[] = [];
	const options = {
		indexedDB, databaseName, memoryFallback: false, preferOpfs: false, revisionLimit: 2,
		linkedVideoOriginalPort: {
			load: (_locatorId: string, { expectedRevision }: { expectedRevision: string | null }) => ({
				blob: new Blob(['linked video'], { type: 'video/mp4' }),
				locatorRevision: expectedRevision ?? LOCATOR_REVISION,
			}),
			release: (reference: unknown) => { released.push(reference); return true; },
		},
	};
	const first = createProjectStore(options);
	const second = createProjectStore(options);
	try {
		await first.ready();
		await second.ready();
		const source = createVideoSource({
			id: 'source-a', storageKey: 'storage-a', name: 'source-a.mp4', mimeType: 'video/mp4',
			frameCount: 48_000, sampleRate: 48_000, width: 16, height: 9,
			frameRate: 30, videoCodec: 'h264', audioCodec: null, hasAudio: false,
		});
		await first.bindLinkedVideoOriginal('project-a', source, LOCATOR_ID);
		const clip = createVideoClip({
			id: 'clip-a', sourceId: source.id, title: source.name,
			durationFrames: source.sampleFrameCount, sourceDurationFrames: source.sampleFrameCount,
		});
		await first.saveProject(createCurrentAudioEditorProject({
			id: 'project-a', revision: 1, sources: [source], clips: [clip],
			tracks: [createVideoTrack({ id: 'track-a', clipIds: [clip.id] })],
		}), { protectedLinkedVideoSourceIds: [source.id] });
		await second.saveProject(createCurrentAudioEditorProject({ id: 'project-a', revision: 2 }), {
			protectedLinkedVideoSourceIds: [],
		});
		await second.saveProject(createCurrentAudioEditorProject({ id: 'project-a', revision: 3 }), {
			protectedLinkedVideoSourceIds: [],
		});
		assert.ok(await first.getLinkedVideoOriginalBinding('project-a', source.id));
		assert.deepEqual(released, []);
		await first.close();
		await second.saveProject(createCurrentAudioEditorProject({ id: 'project-a', revision: 4 }), {
			protectedLinkedVideoSourceIds: [],
		});
		assert.equal(await second.getLinkedVideoOriginalBinding('project-a', source.id), null);
		assert.deepEqual(released, [{ locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION }]);
	} finally {
		await first.close();
		await second.close();
	}
});
