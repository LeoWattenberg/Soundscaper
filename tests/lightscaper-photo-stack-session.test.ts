/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import { admitPhotoLibraryStackCommandV1 } from '../src/lightscaper/controller/photo-library-stacks-v1.ts';
import type { PhotoLibrarySessionPortsV1 } from '../src/lightscaper/controller/photo-library-session-ports.ts';
import type { PhotoLibraryStackCommandV1, PhotoLibraryStackBindingV1 } from '../src/common/editor/photo-library-stack-port-v1.ts';

async function fixture() {
	const indexedDB = createInstrumentedIndexedDB();
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory, databaseName: 'stack-session', verifyOriginal: async () => undefined });
	const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1',
		name: 'Library', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	const initial = photoArchiveFixture().photo;
	const photos = Array.from({ length: 4 }, (_, index) => normalizePhotoDocumentV1({ ...initial, id: `photo-${String(index)}`, catalogId: root.id,
		original: { ...initial.original, id: `original-${String(index)}`, storageKey: `body-${String(index)}` } }));
	await repository.createCatalog(root); await repository.publishPhotos(root.id, 0, photos);
	const calls = { initialize: 0, locks: 0, close: 0, identities: 0 };
	const ports: { -readonly [Key in keyof PhotoLibrarySessionPortsV1]: PhotoLibrarySessionPortsV1[Key] } = {
		catalog: repository, stacks: repository,
		initialize: async () => { calls.initialize += 1; return (await repository.loadCatalog(root.id))!; },
		closeResources: async () => { calls.close += 1; await repository.close(); },
		createId: () => `stack-${String(++calls.identities)}`,
		exclusive: async (_catalog, operation, signal) => { calls.locks += 1; return operation(signal); },
		journal: { get: async () => undefined, putIfAbsent: async () => { throw new Error('Unexpected journal mutation'); }, deleteIfCurrent: async () => { throw new Error('Unexpected journal mutation'); } },
		media: { writeAsset: async () => { throw new Error('Unexpected media write'); }, custody: {
			findDigestPage: async () => { throw new Error('Unexpected digest scan'); }, stage: async () => { throw new Error('Unexpected custody stage'); },
			promote: async () => { throw new Error('Unexpected custody promotion'); }, releaseStaged: async () => { throw new Error('Unexpected custody release'); },
			readPage: async () => { throw new Error('Unexpected custody scan'); },
		} },
	};
	return { indexedDB, repository, ports, calls, photos, owner: new PhotoLibrarySessionV1(ports) };
}
function create(): PhotoLibraryStackCommandV1 {
	return { schemaVersion: 1, type: 'create', catalogId: 'catalog-1', expectedCatalogRevision: 1, expectedStateRevision: 0,
		photoIds: ['photo-0', 'photo-1'], coverPhotoId: 'photo-0' };
}
function binding(snapshot: Awaited<ReturnType<PhotoLibrarySessionV1['readStackSnapshot']>>): PhotoLibraryStackBindingV1 {
	assert.ok(snapshot.stack);
	return { schemaVersion: 1, catalogId: snapshot.context.catalogId, catalogRevision: snapshot.context.catalogRevision,
		indexRevision: snapshot.context.indexRevision, stateRevision: snapshot.context.stateRevision,
		stackId: snapshot.stack.id, stackRevision: snapshot.stack.revision };
}

test('neutral command admission detaches ordered IDs, refuses hostile/future/exhausted inputs before readiness or ID allocation', async () => {
	const f = await fixture(); let getters = 0;
	const admitted = admitPhotoLibraryStackCommandV1(create());
	assert.ok(Object.isFrozen(admitted));
	assert.equal(admitted.type, 'create');
	if (admitted.type === 'create') assert.ok(Object.isFrozen(admitted.photoIds));
	for (const command of [
		Object.defineProperty(create(), 'photoIds', { get() { getters += 1; return []; } }),
		{ ...create(), schemaVersion: 2 }, { ...create(), id: 'forged' }, { ...create(), photoIds: ['photo-0', 'photo-0'] },
		{ ...create(), photoIds: Array.from({ length: 65 }, (_, n) => `p-${String(n)}`) },
		{ ...create(), expectedCatalogRevision: Number.MAX_SAFE_INTEGER },
		{ ...create(), expectedStateRevision: Number.MAX_SAFE_INTEGER },
	]) await assert.rejects(f.owner.applyStack(command as PhotoLibraryStackCommandV1));
	await assert.rejects(f.owner.readStackSummaryPage({ cursor: 'x'.repeat(2049) }));
	assert.equal(getters, 0); assert.deepEqual(f.calls, { initialize: 0, locks: 0, close: 0, identities: 0 });
	await f.owner.close();
});

test('real repository session creates and edits one stack through scalar snapshots without changing originals', async () => {
	const f = await fixture();
	const membership = await f.owner.readStackMemberships(['photo-0', 'photo-1']);
	assert.deepEqual(membership.memberships.map(row => row.stackId), [null, null]);
	const before = await f.repository.loadPhoto('catalog-1', 'photo-0');
	const created = await f.owner.applyStack(create());
	assert.equal(created.action, 'created'); assert.equal(created.stack?.id, 'stack-1'); assert.equal(created.catalogRevision, 2); assert.equal(created.stateRevision, 1);
	const snapshot = await f.owner.readStackSnapshot('photo-0'); assert.deepEqual(snapshot.stack, created.stack);
	const names = await f.owner.readStackMembers(binding(snapshot), ['photo-1', 'photo-0']);
	assert.deepEqual(names.rows.map(row => row.photoId), ['photo-1', 'photo-0']);
	assert.deepEqual(Object.keys(names.rows[0]!).sort(), ['fileName', 'photoId', 'photoRevision']);
	const summaries = await f.owner.readStackSummaryPage(); assert.equal(summaries.rows.length, 1); assert.equal(summaries.cursor, null);
	const edited = await f.owner.applyStack({ schemaVersion: 1, type: 'update', catalogId: 'catalog-1', expectedCatalogRevision: 2,
		expectedStateRevision: 1, id: 'stack-1', expectedStackRevision: 0, photoIds: ['photo-1', 'photo-0'], coverPhotoId: 'photo-1' });
	assert.equal(edited.stack?.revision, 1); assert.equal(edited.stack?.coverPhotoId, 'photo-1');
	assert.deepEqual(await f.repository.loadPhoto('catalog-1', 'photo-0'), before);
	await assert.rejects(f.owner.readStackMembers(binding(snapshot), ['photo-0']), /revision|changed/iu);
	const dissolved = await f.owner.applyStack({ schemaVersion: 1, type: 'dissolve', catalogId: 'catalog-1', expectedCatalogRevision: 3,
		expectedStateRevision: 2, id: 'stack-1', expectedStackRevision: 1 });
	assert.equal(dissolved.stack, null); assert.equal((await f.owner.readStackSnapshot('photo-0')).stack, null);
	await f.owner.close();
});

test('command arrays and captured revisions detach before held readiness lets callers mutate their draft', async () => {
	const f = await fixture(), hold = deferred<void>(), entered = deferred<void>();
	const initialize = f.ports.initialize;
	f.ports.initialize = async signal => { entered.resolve(); await hold.promise; return initialize(signal); };
	const ids = ['photo-0', 'photo-1']; const command = { ...create(), photoIds: ids };
	const work = f.owner.applyStack(command); await entered.promise;
	ids[0] = 'absent'; command.expectedCatalogRevision = 100;
	hold.resolve(); const result = await work;
	assert.equal(result.catalogRevision, 2); assert.deepEqual(result.stack?.photoIds, ['photo-0', 'photo-1']); await f.owner.close();
});

test('foreign catalog commands and member bindings refuse through the borrowed writer without publishing', async () => {
	const f = await fixture();
	await assert.rejects(f.owner.applyStack({ ...create(), catalogId: 'foreign' }), /catalog/iu);
	assert.equal(f.calls.identities, 0); assert.equal((await f.repository.readStackState('catalog-1')).stackCount, 0);
	await f.owner.applyStack(create());
	const snapshot = await f.owner.readStackSnapshot('photo-0');
	await assert.rejects(f.owner.readStackMembers(binding(snapshot), ['photo-2']), /member/iu);
	await assert.rejects(f.owner.readStackMembers({ ...binding(snapshot), catalogId: 'foreign' }, ['photo-0']), /catalog/iu);
	await f.owner.close();
});

test('a held stack write occupies the one writer and Close joins its late durable acknowledgment', async () => {
	const f = await fixture(), hold = deferred<void>(), entered = deferred<void>();
	f.ports.stacks = { ...stackMethods(f.repository), saveStack: async (...args) => {
		const result = await f.repository.saveStack(...args); entered.resolve(); await hold.promise; return result;
	} };
	const work = f.owner.applyStack(create()); await entered.promise;
	await assert.rejects(f.owner.applyStack(create()), /pending/iu);
	const closing = f.owner.close(); assert.equal(await remainsPending(closing), true); assert.equal(f.calls.close, 0);
	hold.resolve(); const result = await work; assert.equal(result.action, 'created'); await closing;
	assert.equal(f.calls.close, 1); assert.equal(f.calls.identities, 1);
});

test('Close joins a held scalar read and suppresses its canceled result before releasing resources', async () => {
	const f = await fixture(), hold = deferred<void>(), entered = deferred<void>();
	await f.owner.readStackMemberships([]);
	f.ports.stacks = { ...stackMethods(f.repository), readStackMembershipPage: async (...args) => {
		const result = await f.repository.readStackMembershipPage(...args); entered.resolve(); await hold.promise; return result;
	} };
	const work = f.owner.readStackMemberships(['photo-0']); await entered.promise;
	const rejected = assert.rejects(work, { name: 'AbortError' });
	const closing = f.owner.close(); assert.equal(await remainsPending(closing), true); assert.equal(f.calls.close, 0);
	hold.resolve(); await rejected; await closing; assert.equal(f.calls.close, 1);
});

test('abort during a held precommit save retains exclusion until settlement and creates no durable grouping', async () => {
	const f = await fixture(), hold = deferred<void>(), entered = deferred<void>(), stop = new AbortController();
	f.ports.stacks = { ...stackMethods(f.repository), saveStack: async (...args) => {
		entered.resolve(); await hold.promise; return f.repository.saveStack(...args);
	} };
	const work = f.owner.applyStack(create(), { signal: stop.signal }); await entered.promise;
	const rejected = assert.rejects(work, { name: 'AbortError' }); stop.abort();
	await assert.rejects(f.owner.applyStack(create()), /pending/iu);
	assert.equal(await remainsPending(work), true); hold.resolve(); await rejected;
	assert.equal(f.indexedDB.recordCount('stack-session', 'photoStacks'), 0);
	assert.equal((await f.repository.readStackState('catalog-1')).revision, 0); await f.owner.close();
});

test('held lazy initialization joins Close without starting any stack read or allocating an ID', async () => {
	const f = await fixture(), hold = deferred<void>(), entered = deferred<void>(); let reads = 0;
	const initial = f.ports.initialize;
	f.ports.initialize = async signal => { entered.resolve(); await hold.promise; return initial(signal); };
	f.ports.stacks = { ...stackMethods(f.repository), readStackState: async (...args) => { reads += 1; return f.repository.readStackState(...args); } };
	const work = f.owner.applyStack(create()); await entered.promise;
	const refused = assert.rejects(work, { name: 'AbortError' });
	const closing = f.owner.close(); assert.equal(await remainsPending(closing), true); hold.resolve(); await refused; await closing;
	assert.equal(reads, 0); assert.equal(f.calls.identities, 0); assert.equal(f.calls.close, 1);
});

test('hostile or foreign port responses refuse closed scalar admission instead of publishing invented receipts', async () => {
	const f = await fixture(); let getters = 0;
	f.ports.stacks = { ...stackMethods(f.repository), readStackMembershipPage: async (...args) => {
		const page = await f.repository.readStackMembershipPage(...args);
		return Object.defineProperty({ ...page }, 'items', { get() { getters += 1; throw new Error('ran getter'); } });
	} };
	await assert.rejects(f.owner.readStackMemberships(['photo-0']), /data property/iu); assert.equal(getters, 0);
	f.ports.stacks = { ...stackMethods(f.repository), saveStack: async (...args) => {
		const result = await f.repository.saveStack(...args); return { ...result, catalogId: 'foreign' };
	} };
	await assert.rejects(f.owner.applyStack(create()), /acknowledgment/iu);
	assert.equal((await f.repository.readStackState('catalog-1')).stackCount, 1); await f.owner.close();
});

test('precommit abort remains a refusal, while a committed save plus lease cleanup failure returns truthful ACK notice', async () => {
	const cancelled = await fixture(); const stop = new AbortController(); stop.abort();
	await assert.rejects(cancelled.owner.applyStack(create(), { signal: stop.signal }), { name: 'AbortError' });
	assert.equal(cancelled.calls.initialize, 0); await cancelled.owner.close();
	const f = await fixture();
	await f.owner.readStackMemberships([]);
	f.ports.exclusive = async (_catalog, run, signal) => { await run(signal); throw new Error('writer release failed'); };
	const result = await f.owner.applyStack(create());
	assert.equal(result.action, 'created'); assert.deepEqual(result.notices, ['cleanup-failed']);
	assert.equal((await f.repository.readStackState('catalog-1')).stackCount, 1); await f.owner.close();
});

test('scalar reads detect concurrent index/grouping changes instead of returning mixed context', async () => {
	const f = await fixture(); await f.owner.applyStack(create());
	let changed = false;
	f.ports.stacks = { ...stackMethods(f.repository), readStackMembershipPage: async (...args) => {
		const result = await f.repository.readStackMembershipPage(...args);
		if (!changed) { changed = true; await f.repository.savePhoto({ ...f.photos[0]!, rating: 5 }, 0); }
		return result;
	} };
	await assert.rejects(f.owner.readStackMemberships(['photo-0']), /revision|changed/iu);
	assert.equal(f.calls.identities, 1); await f.owner.close();
});

test('missing optional stack capability refuses before initialization while plain library reads remain supported', async () => {
	const f = await fixture(); delete f.ports.stacks;
	await assert.rejects(f.owner.readStackMemberships(['photo-0']), /unavailable/iu);
	await assert.rejects(f.owner.applyStack(create()), /unavailable/iu);
	assert.equal(f.calls.initialize, 0); assert.equal((await f.owner.readPage()).rows.length, 4); await f.owner.close();
});

function stackMethods(repository: PhotoCatalogRepositoryV1): NonNullable<PhotoLibrarySessionPortsV1['stacks']> {
	return { readSnapshot: (...args) => repository.readSnapshot(...args), readStackState: (...args) => repository.readStackState(...args),
		readStackMembershipPage: (...args) => repository.readStackMembershipPage(...args), loadStack: (...args) => repository.loadStack(...args),
		readStackMemberPage: (...args) => repository.readStackMemberPage(...args), readStackPage: (...args) => repository.readStackPage(...args),
		readStackQueryPage: (...args) => repository.readStackQueryPage(...args),
		saveStack: (...args) => repository.saveStack(...args), dissolveStack: (...args) => repository.dissolveStack(...args) };
}
