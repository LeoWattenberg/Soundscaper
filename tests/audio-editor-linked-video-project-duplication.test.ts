/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createAudioEditorProjectV9,
	createVideoClipV9,
	createVideoSourceV9,
	type AudioEditorProjectV9,
} from '../src/common/editor/project-v9.ts';
import { ProjectPublicationQuotaError } from '../src/common/editor/project-publication-admission.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../src/common/editor/storage.js';
import type { LinkedVideoOriginalBinding } from '../src/common/editor/storage/linked-video-original-binding.ts';
import type { LinkedVideoOriginalLocatorReference } from '../src/common/editor/storage/linked-video-original-repository.ts';
import type { DesktopSharedProjectBridge } from '../src/common/editor/storage/desktop-shared-project-repository.ts';
import type {
	LinkedVideoOriginalPort,
	LinkedVideoOriginalSource,
} from '../src/common/editor/storage/linked-video-original-resolver.ts';
import { linkedVideoOriginalBindingKey } from '../src/common/editor/storage/linked-video-original-schema.ts';
import {
	createStorageRepositories,
	type StorageRepositoryFactory,
} from '../src/common/editor/storage/repositories.ts';
import type { ProjectRepositoryPort } from '../src/common/editor/storage/project-repository.ts';
import { ProjectDuplicationIndeterminateError } from '../src/common/editor/storage/project-duplication.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const SOURCE_PROJECT_ID = 'linked-duplicate-source-project';
const COPY_PROJECT_ID = 'linked-duplicate-copy-project';
const SOURCE_ID = 'linked-duplicate-video-source';
const LOCATOR_A = 'locator_0000000000000001';
const LOCATOR_B = 'locator_0000000000000002';
const REVISION_A = 'snapshot_0000000000000001';
const REVISION_B = 'snapshot_0000000000000002';
const NOW = '2026-08-02T12:00:00.000Z';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} duplication creates an independent exact linked-original alias`, async (context) => {
		const fixture = await duplicationFixture(context, backend);
		await fixture.store.saveProject(linkedProject(SOURCE_PROJECT_ID, 'Linked source'));
		const originalBinding = await fixture.store.bindLinkedVideoOriginal(
			SOURCE_PROJECT_ID,
			linkedSource(),
			LOCATOR_A,
		);
		const loadsBeforeDuplicate = fixture.loads.length;

		const copy = await fixture.store.duplicateProject(SOURCE_PROJECT_ID, {
			id: COPY_PROJECT_ID,
			title: 'Linked copy',
		});
		const copiedBinding = await fixture.store.getLinkedVideoOriginalBinding(COPY_PROJECT_ID, SOURCE_ID);

		assert.equal(copy.id, COPY_PROJECT_ID);
		assert.ok(copiedBinding);
		assert.deepEqual(sharedBindingFields(copiedBinding), sharedBindingFields(originalBinding));
		assert.equal(copiedBinding.projectId, COPY_PROJECT_ID);
		assert.equal(copiedBinding.sourceId, SOURCE_ID);
		assert.notEqual(copiedBinding.bindingToken, originalBinding.bindingToken);
		assert.deepEqual(
			await fixture.store.getLinkedVideoOriginalBinding(SOURCE_PROJECT_ID, SOURCE_ID),
			originalBinding,
		);
		assert.equal(fixture.loads.length, loadsBeforeDuplicate, 'duplication must not load the external body');
		assert.deepEqual(fixture.releases, [], 'duplication must not release an external body');

		await fixture.store.deleteProject(SOURCE_PROJECT_ID);
		assert.equal(await fixture.store.getLinkedVideoOriginalBinding(SOURCE_PROJECT_ID, SOURCE_ID), null);
		assert.ok(await fixture.store.getLinkedVideoOriginalBinding(COPY_PROJECT_ID, SOURCE_ID));
		assert.deepEqual(fixture.releases, [], 'the copied alias must retain the exact locator revision');

		await fixture.store.deleteProject(COPY_PROJECT_ID);
		assert.equal(await fixture.store.getLinkedVideoOriginalBinding(COPY_PROJECT_ID, SOURCE_ID), null);
		assert.deepEqual(fixture.releases, [reference(LOCATOR_A, REVISION_A)]);
	});
}

test('a duplicate save failure rolls back its binding without disturbing the source alias', async (context) => {
	const failure = new Error('planned duplicate project save failure');
	let observedCopyBindingBeforeFailure = false;
	const fixture = await duplicationFixture(context, 'memory', {
		repositoryFactory: duplicateSaveFailureFactory(failure, (binding) => {
			observedCopyBindingBeforeFailure = binding?.projectId === COPY_PROJECT_ID;
		}),
	});
	await fixture.store.saveProject(linkedProject(SOURCE_PROJECT_ID, 'Linked source'));
	const originalBinding = await fixture.store.bindLinkedVideoOriginal(
		SOURCE_PROJECT_ID,
		linkedSource(),
		LOCATOR_A,
	);
	const loadsBeforeDuplicate = fixture.loads.length;

	await assert.rejects(
		fixture.store.duplicateProject(SOURCE_PROJECT_ID, { id: COPY_PROJECT_ID }),
		(error) => error === failure,
	);
	assert.equal(observedCopyBindingBeforeFailure, true, 'the copy binding must precede project publication');
	assert.equal(await fixture.store.loadProject(COPY_PROJECT_ID), null);
	assert.equal(await fixture.store.getLinkedVideoOriginalBinding(COPY_PROJECT_ID, SOURCE_ID), null);
	assert.deepEqual(
		await fixture.store.getLinkedVideoOriginalBinding(SOURCE_PROJECT_ID, SOURCE_ID),
		originalBinding,
	);
	assert.equal(fixture.loads.length, loadsBeforeDuplicate);
	assert.deepEqual(fixture.releases, []);
});

test('a desktop commit refusal leaves no copied binding or external release', async (context) => {
	const failure = new Error('planned desktop duplicate commit refusal');
	const desktop = desktopBridgeFailingCopyCommit(failure);
	const fixture = await duplicationFixture(context, 'memory', {
		desktopProjectBridge: desktop.bridge,
	});
	await fixture.store.saveProject(linkedProject(SOURCE_PROJECT_ID, 'Linked source'));
	const originalBinding = await fixture.store.bindLinkedVideoOriginal(
		SOURCE_PROJECT_ID,
		linkedSource(),
		LOCATOR_A,
	);
	const loadsBeforeDuplicate = fixture.loads.length;

	await assert.rejects(
		fixture.store.duplicateProject(SOURCE_PROJECT_ID, { id: COPY_PROJECT_ID }),
		(error) => error === failure,
	);
	assert.deepEqual(desktop.projectIds(), [SOURCE_PROJECT_ID]);
	assert.equal(await fixture.store.loadProject(COPY_PROJECT_ID, { revision: 0 }), null);
	assert.deepEqual(await fixture.store.listProjectRevisions(COPY_PROJECT_ID), []);
	assert.equal(await fixture.store.getLinkedVideoOriginalBinding(COPY_PROJECT_ID, SOURCE_ID), null);
	assert.deepEqual(
		await fixture.store.getLinkedVideoOriginalBinding(SOURCE_PROJECT_ID, SOURCE_ID),
		originalBinding,
	);
	assert.equal(fixture.loads.length, loadsBeforeDuplicate);
	assert.deepEqual(fixture.releases, []);
});

test('desktop duplication rolls back a same-revision shadow document mutation', async (context) => {
	const desktop = desktopBridgeFailingCopyCommit(new Error('copy commit must not be reached'));
	const fixture = await duplicationFixture(context, 'memory', {
		desktopProjectBridge: desktop.bridge,
		repositoryFactory: mutatingCreateFactory(),
	});
	await fixture.store.saveProject(linkedProject(SOURCE_PROJECT_ID, 'Linked source'));
	await fixture.store.bindLinkedVideoOriginal(SOURCE_PROJECT_ID, linkedSource(), LOCATOR_A);

	await assert.rejects(
		fixture.store.duplicateProject(SOURCE_PROJECT_ID, { id: COPY_PROJECT_ID }),
		/shadow changed the exact document/iu,
	);
	assert.deepEqual(desktop.projectIds(), [SOURCE_PROJECT_ID]);
	assert.equal(await fixture.store.loadProject(COPY_PROJECT_ID, { revision: 0 }), null);
	assert.deepEqual(await fixture.store.listProjectRevisions(COPY_PROJECT_ID), []);
	assert.equal(await fixture.store.getLinkedVideoOriginalBinding(COPY_PROJECT_ID, SOURCE_ID), null);
	assert.deepEqual(fixture.releases, []);
});

test('desktop compensation never erases a replacement copied alias', async (context) => {
	const failure = new Error('planned desktop commit refusal after alias replacement');
	let store: AudioEditorProjectStore | null = null;
	let replacement: LinkedVideoOriginalBinding | null = null;
	const desktop = desktopBridgeFailingCopyCommit(failure, {
		beforeCopyFailure: async () => {
			if (!store) throw new Error('The duplicate store is unavailable.');
			const current = await store.getLinkedVideoOriginalBinding(COPY_PROJECT_ID, SOURCE_ID);
			assert.ok(current);
			replacement = await store.linkedVideoOriginalBindingRepository.putIfCurrent({
				schemaVersion: current.schemaVersion,
				projectId: current.projectId,
				sourceId: current.sourceId,
				storageKey: current.storageKey,
				locatorId: current.locatorId,
				locatorRevision: current.locatorRevision,
				mimeType: current.mimeType,
				byteLength: current.byteLength,
				sha256: current.sha256,
				sourceShape: current.sourceShape,
			}, current.bindingToken);
			assert.ok(replacement);
		},
	});
	const fixture = await duplicationFixture(context, 'memory', {
		desktopProjectBridge: desktop.bridge,
	});
	store = fixture.store;
	await store.saveProject(linkedProject(SOURCE_PROJECT_ID, 'Linked source'));
	await store.bindLinkedVideoOriginal(SOURCE_PROJECT_ID, linkedSource(), LOCATOR_A);

	await assert.rejects(
		store.duplicateProject(SOURCE_PROJECT_ID, { id: COPY_PROJECT_ID }),
		(error) => error instanceof AggregateError && error.errors[0] === failure,
	);
	assert.equal(await store.loadProject(COPY_PROJECT_ID, { revision: 0 }), null);
	assert.deepEqual(await store.listProjectRevisions(COPY_PROJECT_ID), []);
	assert.deepEqual(
		await store.getLinkedVideoOriginalBinding(COPY_PROJECT_ID, SOURCE_ID),
		replacement,
	);
	assert.deepEqual(fixture.releases, []);
});

test('a desktop commit that throws after publication recovers the exact copy and retains its alias', async (context) => {
	const failure = new Error('planned acknowledgement transport failure');
	const desktop = desktopBridgeFailingCopyCommit(failure, { commitBeforeFailure: true });
	const fixture = await duplicationFixture(context, 'memory', {
		desktopProjectBridge: desktop.bridge,
	});
	await fixture.store.saveProject(linkedProject(SOURCE_PROJECT_ID, 'Linked source'));
	await fixture.store.bindLinkedVideoOriginal(SOURCE_PROJECT_ID, linkedSource(), LOCATOR_A);
	const loadsBeforeDuplicate = fixture.loads.length;

	const copy = await fixture.store.duplicateProject(SOURCE_PROJECT_ID, { id: COPY_PROJECT_ID });

	assert.equal(copy.id, COPY_PROJECT_ID);
	assert.deepEqual(desktop.projectIds(), [SOURCE_PROJECT_ID, COPY_PROJECT_ID]);
	assert.deepEqual(await fixture.store.loadProject(COPY_PROJECT_ID, { revision: 0 }), copy);
	assert.ok(await fixture.store.getLinkedVideoOriginalBinding(COPY_PROJECT_ID, SOURCE_ID));
	assert.equal(fixture.loads.length, loadsBeforeDuplicate);
	assert.deepEqual(fixture.releases, []);
});

test('a superseded desktop commit outcome remains indeterminate and retains its local alias', async (context) => {
	const desktop = desktopBridgeFailingCopyCommit(new Error('planned lost acknowledgement'), {
		supersedeBeforeFailure: true,
	});
	const fixture = await duplicationFixture(context, 'memory', {
		desktopProjectBridge: desktop.bridge,
	});
	await fixture.store.saveProject(linkedProject(SOURCE_PROJECT_ID, 'Linked source'));
	await fixture.store.bindLinkedVideoOriginal(SOURCE_PROJECT_ID, linkedSource(), LOCATOR_A);

	await assert.rejects(
		fixture.store.duplicateProject(SOURCE_PROJECT_ID, { id: COPY_PROJECT_ID }),
		(error) => error instanceof ProjectDuplicationIndeterminateError
			&& error.projectId === COPY_PROJECT_ID,
	);
	assert.deepEqual(desktop.projectIds(), [SOURCE_PROJECT_ID, COPY_PROJECT_ID]);
	assert.ok(await fixture.store.loadProject(COPY_PROJECT_ID, { revision: 0 }));
	assert.ok(await fixture.store.getLinkedVideoOriginalBinding(COPY_PROJECT_ID, SOURCE_ID));
	assert.deepEqual(fixture.releases, []);
});

test('an unreadable desktop commit outcome preserves the local copy and alias while indeterminate', async (context) => {
	const failure = new Error('planned desktop commit failure');
	const recoveryFailure = new Error('planned desktop recovery read failure');
	const desktop = desktopBridgeFailingCopyCommit(failure, { recoveryFailure });
	const fixture = await duplicationFixture(context, 'memory', {
		desktopProjectBridge: desktop.bridge,
	});
	await fixture.store.saveProject(linkedProject(SOURCE_PROJECT_ID, 'Linked source'));
	await fixture.store.bindLinkedVideoOriginal(SOURCE_PROJECT_ID, linkedSource(), LOCATOR_A);

	await assert.rejects(
		fixture.store.duplicateProject(SOURCE_PROJECT_ID, { id: COPY_PROJECT_ID }),
		(error) => error instanceof ProjectDuplicationIndeterminateError
			&& error.projectId === COPY_PROJECT_ID,
	);
	assert.deepEqual(desktop.projectIds(), [SOURCE_PROJECT_ID]);
	assert.ok(await fixture.store.loadProject(COPY_PROJECT_ID, { revision: 0 }));
	assert.ok(await fixture.store.getLinkedVideoOriginalBinding(COPY_PROJECT_ID, SOURCE_ID));
	assert.deepEqual(fixture.releases, []);
});

test('a mismatched desktop acknowledgement recovers from the exact remote document', async (context) => {
	const desktop = desktopBridgeFailingCopyCommit(new Error('unused failure'), {
		mismatchedAcknowledgement: true,
	});
	const fixture = await duplicationFixture(context, 'memory', {
		desktopProjectBridge: desktop.bridge,
	});
	await fixture.store.saveProject(linkedProject(SOURCE_PROJECT_ID, 'Linked source'));
	await fixture.store.bindLinkedVideoOriginal(SOURCE_PROJECT_ID, linkedSource(), LOCATOR_A);

	const copy = await fixture.store.duplicateProject(SOURCE_PROJECT_ID, { id: COPY_PROJECT_ID });

	assert.equal(copy.id, COPY_PROJECT_ID);
	assert.deepEqual(desktop.projectIds(), [SOURCE_PROJECT_ID, COPY_PROJECT_ID]);
	assert.ok(await fixture.store.getLinkedVideoOriginalBinding(COPY_PROJECT_ID, SOURCE_ID));
	assert.deepEqual(fixture.releases, []);
});

test('concurrent same-destination duplicates publish one project and one alias set', async (context) => {
	const fixture = await duplicationFixture(context, 'memory');
	await fixture.store.saveProject(linkedProject(SOURCE_PROJECT_ID, 'Linked source'));
	await fixture.store.bindLinkedVideoOriginal(SOURCE_PROJECT_ID, linkedSource(), LOCATOR_A);

	const outcomes = await Promise.allSettled([
		fixture.store.duplicateProject(SOURCE_PROJECT_ID, { id: COPY_PROJECT_ID }),
		fixture.store.duplicateProject(SOURCE_PROJECT_ID, { id: COPY_PROJECT_ID }),
	]);
	assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
	assert.equal(outcomes.filter(({ status }) => status === 'rejected').length, 1);
	assert.ok(await fixture.store.loadProject(COPY_PROJECT_ID));
	assert.ok(await fixture.store.getLinkedVideoOriginalBinding(COPY_PROJECT_ID, SOURCE_ID));
	assert.deepEqual(fixture.releases, []);
});

test('duplication rejects an occupied destination without changing either project or binding', async (context) => {
	const fixture = await duplicationFixture(context, 'memory');
	await fixture.store.saveProject(linkedProject(SOURCE_PROJECT_ID, 'Linked source'));
	await fixture.store.saveProject(linkedProject(COPY_PROJECT_ID, 'Existing destination', 7));
	await fixture.store.bindLinkedVideoOriginal(SOURCE_PROJECT_ID, linkedSource(), LOCATOR_A);
	await fixture.store.bindLinkedVideoOriginal(COPY_PROJECT_ID, linkedSource(), LOCATOR_B);
	const sourceBefore = await fixture.store.loadProject(SOURCE_PROJECT_ID);
	const destinationBefore = await fixture.store.loadProject(COPY_PROJECT_ID);
	const sourceBindingBefore = await fixture.store.getLinkedVideoOriginalBinding(SOURCE_PROJECT_ID, SOURCE_ID);
	const destinationBindingBefore = await fixture.store.getLinkedVideoOriginalBinding(COPY_PROJECT_ID, SOURCE_ID);
	const loadsBeforeDuplicate = fixture.loads.length;

	await assert.rejects(
		fixture.store.duplicateProject(SOURCE_PROJECT_ID, {
			id: COPY_PROJECT_ID,
			title: 'Must not overwrite',
		}),
		/already exists|destination/iu,
	);
	assert.deepEqual(await fixture.store.loadProject(SOURCE_PROJECT_ID), sourceBefore);
	assert.deepEqual(await fixture.store.loadProject(COPY_PROJECT_ID), destinationBefore);
	assert.deepEqual(
		await fixture.store.getLinkedVideoOriginalBinding(SOURCE_PROJECT_ID, SOURCE_ID),
		sourceBindingBefore,
	);
	assert.deepEqual(
		await fixture.store.getLinkedVideoOriginalBinding(COPY_PROJECT_ID, SOURCE_ID),
		destinationBindingBefore,
	);
	assert.equal(fixture.loads.length, loadsBeforeDuplicate);
	assert.deepEqual(fixture.releases, []);
});

test('duplication fails closed on a malformed source binding without publishing a copy', async (context) => {
	const fixture = await duplicationFixture(context, 'memory');
	await fixture.store.saveProject(linkedProject(SOURCE_PROJECT_ID, 'Linked source'));
	const valid = await fixture.store.bindLinkedVideoOriginal(
		SOURCE_PROJECT_ID,
		linkedSource(),
		LOCATOR_A,
	);
	const key = linkedVideoOriginalBindingKey(SOURCE_PROJECT_ID, SOURCE_ID);
	const malformed = Object.freeze({
		key,
		projectId: SOURCE_PROJECT_ID,
		binding: Object.freeze({ ...valid, path: '/private/linked-original.mp4' }),
	});
	fixture.store.memory.linkedVideoOriginalBindings.set(key, malformed);
	const loadsBeforeDuplicate = fixture.loads.length;

	await assert.rejects(
		fixture.store.duplicateProject(SOURCE_PROJECT_ID, { id: COPY_PROJECT_ID }),
		/binding|record/iu,
	);
	assert.equal(await fixture.store.loadProject(COPY_PROJECT_ID), null);
	assert.equal(await fixture.store.getLinkedVideoOriginalBinding(COPY_PROJECT_ID, SOURCE_ID), null);
	assert.strictEqual(fixture.store.memory.linkedVideoOriginalBindings.get(key), malformed);
	assert.equal(fixture.loads.length, loadsBeforeDuplicate);
	assert.deepEqual(fixture.releases, []);
});

test('a known project-publication quota shortage rolls back the copied alias', async (context) => {
	let constrained = false;
	const fixture = await duplicationFixture(context, 'indexeddb', {
		storageManager: {
			estimate: async () => constrained
				? { usage: 1, quota: 1 }
				: { usage: 0, quota: 1_000_000 },
		},
	});
	await fixture.store.saveProject(linkedProject(SOURCE_PROJECT_ID, 'Linked source'));
	const original = await fixture.store.bindLinkedVideoOriginal(
		SOURCE_PROJECT_ID,
		linkedSource(),
		LOCATOR_A,
	);
	const loadsBeforeDuplicate = fixture.loads.length;
	constrained = true;

	await assert.rejects(
		fixture.store.duplicateProject(SOURCE_PROJECT_ID, { id: COPY_PROJECT_ID }),
		ProjectPublicationQuotaError,
	);
	assert.equal(await fixture.store.loadProject(COPY_PROJECT_ID), null);
	assert.deepEqual(await fixture.store.listProjectRevisions(COPY_PROJECT_ID), []);
	assert.equal(await fixture.store.getLinkedVideoOriginalBinding(COPY_PROJECT_ID, SOURCE_ID), null);
	assert.deepEqual(
		await fixture.store.getLinkedVideoOriginalBinding(SOURCE_PROJECT_ID, SOURCE_ID),
		original,
	);
	assert.equal(fixture.loads.length, loadsBeforeDuplicate);
	assert.deepEqual(fixture.releases, []);
});

interface DuplicationFixtureOptions {
	readonly desktopProjectBridge?: DesktopSharedProjectBridge;
	readonly repositoryFactory?: StorageRepositoryFactory;
	readonly storageManager?: Readonly<{
		estimate(): Promise<Readonly<{ usage: number; quota: number }>>;
	}>;
}

async function duplicationFixture(
	context: TestContext,
	backend: 'memory' | 'indexeddb',
	options: DuplicationFixtureOptions = {},
) {
	const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
	const loads: Array<Readonly<{ locatorId: string; expectedRevision: string | null }>> = [];
	const releases: LinkedVideoOriginalLocatorReference[] = [];
	const bodies = new Map<string, Readonly<{ blob: Blob; locatorRevision: string }>>([
		[LOCATOR_A, { blob: new Blob(['linked body a'], { type: 'video/mp4' }), locatorRevision: REVISION_A }],
		[LOCATOR_B, { blob: new Blob(['linked body b'], { type: 'video/mp4' }), locatorRevision: REVISION_B }],
	]);
	const port: LinkedVideoOriginalPort = {
		load: async (locatorId, { expectedRevision }) => {
			loads.push(Object.freeze({ locatorId, expectedRevision }));
			const snapshot = bodies.get(locatorId);
			if (!snapshot || expectedRevision !== null && expectedRevision !== snapshot.locatorRevision) return null;
			return snapshot;
		},
		release: async (value) => {
			releases.push(Object.freeze({ ...value }));
			return true;
		},
	};
	const store = createProjectStore({
		indexedDB: indexedDB as unknown as IDBFactory | null,
		databaseName: `linked-video-duplicate-${backend}-${Date.now()}-${Math.random()}`,
		preferOpfs: false,
		linkedVideoOriginalPort: port,
		desktopProjectBridge: options.desktopProjectBridge,
		repositoryFactory: options.repositoryFactory,
		storageManager: options.storageManager,
	});
	context.after(async () => { await store.close(); });
	await store.ready();
	return { store: store as AudioEditorProjectStore, loads, releases };
}

function desktopBridgeFailingCopyCommit(
	failure: Error,
	options: Readonly<{
		beforeCopyFailure?: () => Promise<void>;
		commitBeforeFailure?: boolean;
		mismatchedAcknowledgement?: boolean;
		recoveryFailure?: Error;
		supersedeBeforeFailure?: boolean;
	}> = {},
): Readonly<{
	bridge: DesktopSharedProjectBridge;
	projectIds(): string[];
}> {
	const documents = new Map<string, string>();
	let copyCommitAttempted = false;
	const parse = (document: string) => JSON.parse(document) as Readonly<{
		id: string;
		title: string;
		revision: number;
		updatedAt: string;
	}>;
	return Object.freeze({
		bridge: {
			listSharedProjects: async () => [...documents.values()].map((document) => {
				const project = parse(document);
				return {
					id: project.id,
					title: project.title,
					revision: project.revision,
					updatedAt: project.updatedAt,
				};
			}),
			readSharedProject: async (projectId) => {
				if (projectId === COPY_PROJECT_ID && copyCommitAttempted && options.recoveryFailure) {
					throw options.recoveryFailure;
				}
				return documents.get(projectId) ?? null;
			},
			commitSharedProject: async ({ document }) => {
				const project = parse(document);
				if (project.id === COPY_PROJECT_ID) {
					copyCommitAttempted = true;
					if (options.mismatchedAcknowledgement) {
						documents.set(project.id, document);
						return { status: 'committed', document: serializeScapeProjectDocument({
							...project, title: 'Mismatched acknowledgement',
						}) };
					}
					if (options.supersedeBeforeFailure) {
						documents.set(project.id, serializeScapeProjectDocument({
							...project,
							title: 'Superseding edit',
							revision: project.revision + 1,
						}));
					}
					if (options.commitBeforeFailure) documents.set(project.id, document);
					await options.beforeCopyFailure?.();
					throw failure;
				}
				documents.set(project.id, document);
				return { status: 'committed', document };
			},
			deleteSharedProject: async (projectId) => documents.delete(projectId),
		},
		projectIds: () => [...documents.keys()],
	});
}

function duplicateSaveFailureFactory(
	failure: Error,
	observe: (binding: LinkedVideoOriginalBinding | null) => void,
): StorageRepositoryFactory {
	return (port, options) => {
		const repositories = createStorageRepositories(port, options);
		const delegate = repositories.projects;
		const projects: ProjectRepositoryPort = {
			createIfAbsent: async (project) => {
				if (project.id !== COPY_PROJECT_ID) return delegate.createIfAbsent?.(project) ?? null;
				observe(await repositories.linkedVideoOriginalBindings.get(COPY_PROJECT_ID, SOURCE_ID));
				throw failure;
			},
			save: (project) => delegate.save(project),
			load: (projectId, loadOptions) => delegate.load(projectId, loadOptions),
			list: () => delegate.list(),
			listRevisions: (projectId) => delegate.listRevisions(projectId),
			delete: (projectId) => delegate.delete(projectId),
		};
		return Object.freeze({ ...repositories, projects });
	};
}

function mutatingCreateFactory(): StorageRepositoryFactory {
	return (port, options) => {
		const repositories = createStorageRepositories(port, options);
		const delegate = repositories.projects;
		const projects: ProjectRepositoryPort = {
			createIfAbsent: (project) => {
				const create = delegate.createIfAbsent;
				if (typeof create !== 'function') throw new Error('Create-only project storage is unavailable.');
				return create.call(delegate, project.id === COPY_PROJECT_ID ? { ...project, title: 'Mutated shadow title' } : project);
			},
			deleteIfCurrent: (project) => delegate.deleteIfCurrent?.(project) ?? Promise.resolve(false),
			save: (project) => delegate.save(project),
			load: (projectId, loadOptions) => delegate.load(projectId, loadOptions),
			list: () => delegate.list(),
			listRevisions: (projectId) => delegate.listRevisions(projectId),
			delete: (projectId) => delegate.delete(projectId),
		};
		return Object.freeze({ ...repositories, projects });
	};
}

function linkedProject(id: string, title: string, revision = 3): AudioEditorProjectV9 {
	const source = linkedSource();
	const clip = createVideoClipV9({
		id: `${id}-bin-clip`,
		binItemId: `${id}-bin-item`,
		sourceId: source.id,
		durationFrames: source.frameCount,
		sourceDurationFrames: source.frameCount,
	});
	return createAudioEditorProjectV9({
		id, title, revision, now: NOW,
		sources: [source],
		projectBin: { clips: [clip] },
	});
}
function linkedSource(): LinkedVideoOriginalSource {
	return createVideoSourceV9({
		id: SOURCE_ID,
		storageKey: 'linked-duplicate-video-storage',
		name: 'Linked duplicate video.mp4',
		mimeType: 'video/mp4',
		frameCount: 90,
		sampleRate: 48_000,
		width: 1_920,
		height: 1_080,
		frameRate: 30,
		videoCodec: 'h264',
		audioCodec: 'aac',
		hasAudio: true,
	});
}

function sharedBindingFields(binding: LinkedVideoOriginalBinding): object {
	return {
		schemaVersion: binding.schemaVersion,
		sourceId: binding.sourceId,
		storageKey: binding.storageKey,
		locatorId: binding.locatorId,
		locatorRevision: binding.locatorRevision,
		mimeType: binding.mimeType,
		byteLength: binding.byteLength,
		sha256: binding.sha256,
		sourceShape: binding.sourceShape,
	};
}

function reference(locatorId: string, locatorRevision: string): LinkedVideoOriginalLocatorReference { return { locatorId, locatorRevision }; }
