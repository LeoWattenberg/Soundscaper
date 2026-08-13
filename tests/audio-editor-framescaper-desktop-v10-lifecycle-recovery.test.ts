/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ProjectDuplicationIndeterminateError } from '../src/common/editor/storage/project-duplication.ts';
import type { LinkedVideoOriginalSource } from '../src/common/editor/storage/linked-video-original-resolver.ts';
import { snapshotFramescaperDesktopV10Project } from '../src/framescaper/desktop-project-library-v10-renderer-contract.ts';
import { FramescaperDesktopProjectLibraryV10IndeterminateError } from '../src/framescaper/desktop-project-library-v10-renderer.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import type { FramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import {
	FramescaperDesktopV10MainFixture,
	lifecycleFixture,
	projectFixture,
	webLifecycleFixture,
} from './helpers/framescaper-desktop-v10-store-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const DELETE_INTENT_PREFIX = 'framescaper.desktop-v10.delete-intent.v1:';

test('validated commits rebase same-project, cross-project, and absent witnesses', async (context) => {
	const fixture = await lifecycleFixture(context);
	const first = projectFixture({ id: 'witness-rebase-first', revision: 0 });
	const second = projectFixture({ id: 'witness-rebase-second', revision: 0 });
	fixture.main.seed(first);
	fixture.main.seed(second);
	await fixture.store.loadProject(first.id);
	await fixture.store.loadProject(second.id);
	assert.equal(await fixture.store.loadProject('witness-rebase-absent'), null);
	fixture.main.seed(projectFixture({ id: 'external-catalog-project', revision: 0 }));

	const first1 = { ...first, revision: 1, title: 'First revision one' };
	const first2 = { ...first1, revision: 2, title: 'First revision two' };
	const second1 = { ...second, revision: 1, title: 'Second revision one' };
	assert.deepEqual(await fixture.store.saveProject(first1), first1);
	assert.deepEqual(await fixture.store.saveProject(first2), first2);
	assert.deepEqual(await fixture.store.saveProject(second1), second1);
	const created = projectFixture({ id: 'witness-rebase-absent', revision: 0 });
	assert.deepEqual(await fixture.store.createProjectIfAbsent(created), created);
});

test('lost publication acknowledgements recover exact save and create outcomes', async (context) => {
	const fixture = await lifecycleFixture(context);
	const current = projectFixture({ id: 'lost-publication-save', revision: 0 });
	fixture.main.seed(current);
	await fixture.store.loadProject(current.id);
	fixture.main.finishFailureAfterCommit = new Error('lost publication acknowledgement');
	const saved = { ...current, revision: 1, title: 'Recovered save' };
	assert.deepEqual(await fixture.store.saveProject(saved), saved);

	const created = projectFixture({ id: 'lost-publication-create', revision: 0 });
	assert.deepEqual(await fixture.store.createProjectIfAbsent(created), created);
	assert.deepEqual(await fixture.localStore.loadProject(saved.id), saved);
	assert.deepEqual(await fixture.localStore.loadProject(created.id), created);
});

test('unreadable publication acknowledgement recovery is explicitly indeterminate', async (context) => {
	const fixture = await lifecycleFixture(context);
	const current = projectFixture({ id: 'indeterminate-publication-save', revision: 0 });
	fixture.main.seed(current);
	await fixture.store.loadProject(current.id);
	fixture.main.finishFailureAfterCommit = new Error('lost publication acknowledgement');
	fixture.main.readFailures.set(current.id, new Error('publication recovery unreadable'));
	await assert.rejects(fixture.store.saveProject({
		...current, revision: 1, title: 'Indeterminate save',
	}), (error) => error instanceof FramescaperDesktopProjectLibraryV10IndeterminateError
		&& error.operation === 'publication' && error.outcome === 'indeterminate'
		&& !('committed' in error));
});

test('ordinary authoritative absence never erases an occupied local V18 shadow', async (context) => {
	const fixture = await lifecycleFixture(context, linkedVideoOptions([]));
	const local = projectFixture({ id: 'nondestructive-absence', revision: 0, multicamera: true });
	const created = await fixture.localStore.projectRepository.createIfAbsent?.(local);
	assert.ok(created);
	const source = linkedSource(local);
	const binding = await fixture.localStore.bindLinkedVideoOriginal(local.id, source, 'locator_null_read');
	assert.equal(await fixture.store.loadProject(local.id), null);
	assert.deepEqual(await fixture.localStore.loadProject(local.id), local);
	let transientCount = 0;
	await fixture.localStore.linkedVideoOriginalLifecycle?.maintainOpenedProject(local.id, (transient) => {
		transientCount = transient.length;
		return null;
	});
	assert.equal(transientCount, 1);
	assert.deepEqual(await fixture.localStore.getLinkedVideoOriginalBinding(local.id, source.id), binding);
	await assert.rejects(fixture.store.createProjectIfAbsent(local), /absent V18 shadow|create/iu);
	assert.deepEqual(await fixture.localStore.loadProject(local.id), local);
});

test('source and catalog races refuse stale delete and duplicate witnesses', async (context) => {
	const fixture = await lifecycleFixture(context);
	const source = projectFixture({ id: 'stale-lifecycle-source', revision: 0 });
	fixture.main.seed(source);
	await fixture.store.loadProject(source.id);
	fixture.main.seed({ ...source, revision: 1, title: 'Remote source edit' });
	await assert.rejects(fixture.store.deleteProject(source.id), /compare|stale|expected|actual|witness/iu);
	assert.deepEqual((await fixture.store.listProjects()).map(({ id }) => id), [source.id]);

	await fixture.store.loadProject(source.id);
	fixture.main.beforeDuplicate = () => {
		fixture.main.seed({ ...source, revision: 2, title: 'Alias race edit' });
	};
	await assert.rejects(fixture.store.duplicateProject(source.id, {
		id: 'stale-lifecycle-copy', title: 'Must refuse',
	}), /compare|stale|expected|actual/iu);
	assert.equal((await fixture.store.listProjects()).some(({ id }) => id === 'stale-lifecycle-copy'), false);
	await assert.rejects(fixture.store.deleteProject(source.id), /witness/iu);
});

test('lost acknowledgements recover exact duplicate and delete outcomes', async (context) => {
	const fixture = await lifecycleFixture(context);
	const source = projectFixture({ id: 'lost-ack-source', revision: 0, multicamera: true });
	fixture.main.seed(source);
	fixture.main.duplicateFailureAfterCommit = new Error('lost duplicate acknowledgement');
	const copy = await fixture.store.duplicateProject(source.id, {
		id: 'lost-ack-copy', title: 'Recovered duplicate',
	}) as FramescaperProjectV18;
	assert.equal(copy.id, 'lost-ack-copy');
	assert.equal(copy.multicameraGroups[0]?.projectId, 'lost-ack-copy');
	assert.deepEqual(await fixture.localStore.loadProject(copy.id), copy);

	await fixture.store.loadProject(source.id);
	fixture.main.deleteFailureAfterCommit = new Error('lost delete acknowledgement');
	await fixture.store.deleteProject(source.id);
	assert.equal(await fixture.localStore.loadProject(source.id), null);
	assert.deepEqual((await fixture.store.listProjects()).map(({ id }) => id), [copy.id]);
});

test('unreadable duplicate recovery remains indeterminate for alias retention', async (context) => {
	const releases: unknown[] = [];
	const fixture = await lifecycleFixture(context, linkedVideoOptions(releases));
	const source = projectFixture({ id: 'indeterminate-source', revision: 0, multicamera: true });
	fixture.main.seed(source);
	await fixture.store.loadProject(source.id);
	const linked = linkedSource(source);
	await fixture.localStore.bindLinkedVideoOriginal(source.id, linked, 'locator_indeterminate');
	fixture.main.duplicateFailureAfterCommit = new Error('lost duplicate acknowledgement');
	fixture.main.beforeDuplicate = () => {
		fixture.main.readFailures.set('indeterminate-copy', new Error('recovery unreadable'));
	};
	await assert.rejects(fixture.store.duplicateProject(source.id, {
		id: 'indeterminate-copy', title: 'Indeterminate copy',
	}), (error) => error instanceof ProjectDuplicationIndeterminateError
		&& error.projectId === 'indeterminate-copy');
	assert.deepEqual((await fixture.store.listProjects()).map(({ id }) => id).sort(), [
		'indeterminate-copy', 'indeterminate-source',
	]);
	assert.ok(await fixture.localStore.getLinkedVideoOriginalBinding('indeterminate-copy', linked.id));
	assert.deepEqual(releases, []);
});

test('byte-identical duplicate recovery at a later catalog revision stays indeterminate', async (context) => {
	const fixture = await lifecycleFixture(context);
	const source = projectFixture({ id: 'later-revision-source', revision: 0 });
	fixture.main.seed(source);
	fixture.main.duplicateFailureAfterCommit = new Error('lost duplicate acknowledgement');
	fixture.main.afterDuplicate = () => {
		fixture.main.seed(projectFixture({ id: 'unrelated-later-revision', revision: 0 }));
	};
	await assert.rejects(fixture.store.duplicateProject(source.id, {
		id: 'later-revision-copy',
		title: 'Byte-identical later copy',
	}), (error) => error instanceof ProjectDuplicationIndeterminateError
		&& error.projectId === 'later-revision-copy');
	assert.ok((await fixture.store.listProjects()).some(({ id }) => id === 'later-revision-copy'));
	assert.equal(await fixture.localStore.loadProject('later-revision-copy'), null);
});

test('linked-original aliases roll back on stale refusal and survive exact duplicate plus source delete', async (context) => {
	const releases: unknown[] = [];
	const fixture = await lifecycleFixture(context, linkedVideoOptions(releases));
	const source = projectFixture({ id: 'linked-lifecycle-source', revision: 0, multicamera: true });
	fixture.main.seed(source);
	await fixture.store.loadProject(source.id);
	const linked = linkedSource(source);
	const original = await fixture.localStore.bindLinkedVideoOriginal(
		source.id, linked, 'locator_linked_lifecycle',
	);
	fixture.main.beforeDuplicate = () => {
		fixture.main.seed({ ...source, revision: 1, title: 'Remote alias-race edit' });
	};
	await assert.rejects(fixture.store.duplicateProject(source.id, {
		id: 'linked-refused-copy', title: 'Refused copy',
	}), /compare|stale|expected|actual/iu);
	assert.equal(await fixture.localStore.getLinkedVideoOriginalBinding('linked-refused-copy', linked.id), null);
	assert.deepEqual(await fixture.localStore.getLinkedVideoOriginalBinding(source.id, linked.id), original);

	fixture.main.beforeDuplicate = null;
	await fixture.store.loadProject(source.id);
	const copy = await fixture.store.duplicateProject(source.id, {
		id: 'linked-live-copy', title: 'Live linked copy',
	});
	const copied = await fixture.localStore.getLinkedVideoOriginalBinding(String(copy.id), linked.id);
	assert.ok(copied);
	assert.notEqual(copied.bindingToken, original.bindingToken);
	await fixture.store.loadProject(source.id);
	await fixture.store.deleteProject(source.id);
	assert.equal(await fixture.localStore.getLinkedVideoOriginalBinding(source.id, linked.id), null);
	assert.deepEqual(await fixture.localStore.getLinkedVideoOriginalBinding(String(copy.id), linked.id), copied);
	assert.deepEqual(releases, []);
});

test('a definite delete retries only its own tombstoned raw shadow cleanup', async (context) => {
	const fixture = await lifecycleFixture(context);
	const source = projectFixture({ id: 'delete-cleanup-retry', revision: 0 });
	fixture.main.seed(source);
	await fixture.store.loadProject(source.id);
	const repository = fixture.localStore.projectRepository as typeof fixture.localStore.projectRepository & {
		deleteExact(project: FramescaperProjectV18): Promise<boolean>;
	};
	const originalDelete = repository.deleteExact.bind(repository);
	let attempts = 0;
	Object.defineProperty(repository, 'deleteExact', {
		configurable: true,
		value: async (project: FramescaperProjectV18) => {
			attempts += 1;
			if (attempts === 1) throw new Error('planned raw shadow cleanup failure');
			return originalDelete(project);
		},
	});
	await fixture.store.deleteProject(source.id);
	assert.ok(await fixture.localStore.loadProject(source.id));
	assert.equal(await fixture.store.loadProject(source.id), null);
	assert.equal(await fixture.localStore.loadProject(source.id), null);
	assert.equal(attempts, 2);
});

test('post-delete settlement failures retain durable intent after alias cleanup', async (context) => {
	const releases: unknown[] = [];
	const fixture = await lifecycleFixture(context, linkedVideoOptions(releases));
	const source = projectFixture({ id: 'delete-settlement-failure', revision: 0, multicamera: true });
	fixture.main.seed(source);
	await fixture.store.loadProject(source.id);
	const linked = linkedSource(source);
	await fixture.localStore.bindLinkedVideoOriginal(source.id, linked, 'locator_settlement_failure');
	const settings = fixture.localStore.settingsRepository;
	const removeIntent = settings.deleteIfCurrent.bind(settings);
	let removalAttempts = 0;
	Object.defineProperty(settings, 'deleteIfCurrent', {
		configurable: true,
		value: async (key: string, expected: unknown) => {
			removalAttempts += 1;
			if (removalAttempts === 1) throw new Error('planned intent settlement failure');
			return removeIntent(key, expected);
		},
	});
	await fixture.store.deleteProject(source.id);
	assert.equal(await fixture.localStore.loadProject(source.id), null);
	assert.equal(await fixture.localStore.getLinkedVideoOriginalBinding(source.id, linked.id), null);
	assert.equal(releases.length, 1);
	assert.equal((await settings.listByPrefix(DELETE_INTENT_PREFIX)).length, 1);
	assert.equal(await fixture.store.loadProject(source.id), null);
	assert.equal((await settings.listByPrefix(DELETE_INTENT_PREFIX)).length, 0);
	assert.equal(removalAttempts, 2);
	assert.equal(releases.length, 1);
});

test('post-delete shadow verification failure leaves intent retryable after alias cleanup', async (context) => {
	const releases: unknown[] = [];
	const fixture = await lifecycleFixture(context, linkedVideoOptions(releases));
	const source = projectFixture({ id: 'delete-verification-failure', revision: 0, multicamera: true });
	fixture.main.seed(source);
	await fixture.store.loadProject(source.id);
	const linked = linkedSource(source);
	await fixture.localStore.bindLinkedVideoOriginal(source.id, linked, 'locator_verification_failure');
	const load = fixture.localStore.loadProject.bind(fixture.localStore);
	let failed = false;
	Object.defineProperty(fixture.localStore, 'loadProject', {
		configurable: true,
		value: async (...args: Parameters<typeof load>) => {
			const project = await load(...args);
			if (!failed && args[0] === source.id && project === null) {
				failed = true;
				throw new Error('planned post-delete shadow verification failure');
			}
			return project;
		},
	});
	await fixture.store.deleteProject(source.id);
	assert.equal(failed, true);
	assert.equal(await fixture.localStore.getLinkedVideoOriginalBinding(source.id, linked.id), null);
	assert.equal(releases.length, 1);
	assert.equal((await fixture.localStore.settingsRepository.listByPrefix(DELETE_INTENT_PREFIX)).length, 1);
	assert.equal(await fixture.store.loadProject(source.id), null);
	assert.equal((await fixture.localStore.settingsRepository.listByPrefix(DELETE_INTENT_PREFIX)).length, 0);
	assert.equal(releases.length, 1);
});

test('duplicate refuses an occupied local destination before main publication', async (context) => {
	const fixture = await lifecycleFixture(context, linkedVideoOptions([]));
	const source = projectFixture({ id: 'occupied-copy-source', revision: 0, multicamera: true });
	const occupied = projectFixture({ id: 'occupied-copy-destination', revision: 0, multicamera: true });
	fixture.main.seed(source);
	await fixture.store.loadProject(source.id);
	assert.ok(await fixture.localStore.projectRepository.createIfAbsent?.(occupied));
	const linked = linkedSource(source);
	await fixture.localStore.bindLinkedVideoOriginal(source.id, linked, 'locator_occupied_copy');

	await assert.rejects(fixture.store.duplicateProject(source.id, {
		id: occupied.id,
		title: 'Must stay local',
	}), /occupied local shadow/iu);
	assert.deepEqual(await fixture.localStore.loadProject(occupied.id), occupied);
	assert.equal(await fixture.localStore.getLinkedVideoOriginalBinding(occupied.id, linked.id), null);
	assert.equal((await fixture.store.listProjects()).some(({ id }) => id === occupied.id), false);
});

test('durable delete intent resumes exact shadow and alias cleanup after restart', async (context) => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const main = new FramescaperDesktopV10MainFixture();
	const releases: unknown[] = [];
	const environment = { indexedDB, main };
	const first = await lifecycleFixture(context, linkedVideoOptions(releases), environment);
	const source = projectFixture({ id: 'restart-delete-cleanup', revision: 0, multicamera: true });
	main.seed(source);
	await first.store.loadProject(source.id);
	const linked = linkedSource(source);
	await first.localStore.bindLinkedVideoOriginal(source.id, linked, 'locator_restart_cleanup');
	Object.defineProperty(first.localStore.projectRepository, 'deleteExact', {
		configurable: true,
		value: async () => { throw new Error('planned restart cleanup interruption'); },
	});
	await first.store.deleteProject(source.id);
	assert.ok(await first.localStore.loadProject(source.id));
	assert.deepEqual(releases, []);
	await first.localStore.close();

	const restarted = await lifecycleFixture(context, linkedVideoOptions(releases), environment);
	assert.equal(await restarted.localStore.loadProject(source.id), null);
	assert.equal(await restarted.localStore.getLinkedVideoOriginalBinding(source.id, linked.id), null);
	assert.equal((await restarted.localStore.settingsRepository.listByPrefix(DELETE_INTENT_PREFIX)).length, 0);
	assert.equal(releases.length, 1);
});

test('restart cleanup refuses a substituted local shadow and retains its intent', async (context) => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const main = new FramescaperDesktopV10MainFixture();
	const environment = { indexedDB, main };
	const first = await lifecycleFixture(context, {}, environment);
	const source = projectFixture({ id: 'restart-substituted-shadow', revision: 0 });
	main.seed(source);
	await first.store.loadProject(source.id);
	const repository = first.localStore.projectRepository as typeof first.localStore.projectRepository & {
		deleteExact(project: FramescaperProjectV18): Promise<boolean>;
	};
	const exactDelete = repository.deleteExact.bind(repository);
	Object.defineProperty(repository, 'deleteExact', {
		configurable: true,
		value: async () => { throw new Error('planned retained intent'); },
	});
	await first.store.deleteProject(source.id);
	Object.defineProperty(repository, 'deleteExact', { configurable: true, value: exactDelete });
	const replacement = { ...source, revision: 1, title: 'Local replacement' };
	assert.deepEqual(await repository.save(replacement), replacement);
	await first.localStore.close();

	await assert.rejects(lifecycleFixture(context, {}, environment), /shadow changed before exact cleanup/iu);
	const inspection = await webLifecycleFixture(context, {}, environment);
	assert.deepEqual(await inspection.localStore.loadProject(source.id), replacement);
	assert.equal((await inspection.localStore.settingsRepository.listByPrefix(DELETE_INTENT_PREFIX)).length, 1);
});

test('restart cleanup requires a newer catalog tombstone and rejects malformed durable intents', async (context) => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const main = new FramescaperDesktopV10MainFixture();
	const environment = { indexedDB, main };
	const web = await webLifecycleFixture(context, {}, environment);
	const source = projectFixture({ id: 'stale-delete-intent', revision: 0 });
	assert.ok(await web.localStore.projectRepository.createIfAbsent?.(source));
	const snapshot = snapshotFramescaperDesktopV10Project(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, source);
	const intent = Object.freeze({
		kind: 'framescaper-desktop-v10-delete-intent', version: 1,
		projectId: source.id, metadataRevision: 0, projectRevision: 0, projectSha256: snapshot.sha256,
	});
	await web.localStore.settingsRepository.putIfAbsent(
		`${DELETE_INTENT_PREFIX}${encodeURIComponent(source.id)}`,
		intent,
	);
	await web.localStore.close();
	await assert.rejects(lifecycleFixture(context, {}, environment), /newer authoritative catalog tombstone/iu);
	const inspection = await webLifecycleFixture(context, {}, environment);
	assert.deepEqual(await inspection.localStore.loadProject(source.id), source);

	await inspection.localStore.settingsRepository.putIfAbsent(
		`${DELETE_INTENT_PREFIX}malformed`,
		{ kind: 'framescaper-desktop-v10-delete-intent', version: 1, projectId: 'malformed' },
	);
	await inspection.localStore.close();
	await assert.rejects(lifecycleFixture(context, {}, environment), /closed desktop V10 delete intent|invalid/iu);
});

function linkedSource(project: FramescaperProjectV18): LinkedVideoOriginalSource {
	const source = project.sources.find((candidate) => candidate.kind === 'video');
	assert.ok(source?.kind === 'video');
	return source as unknown as LinkedVideoOriginalSource;
}

function linkedVideoOptions(releases: unknown[]) {
	return {
		linkedVideoOriginalPort: {
			load: async (locatorId: string) => ({
				blob: new Blob([`linked:${locatorId}`], { type: 'video/mp4' }),
				locatorRevision: `snapshot_${locatorId}`,
			}),
			release: async (reference: unknown) => { releases.push(reference); return true; },
		},
	};
}
