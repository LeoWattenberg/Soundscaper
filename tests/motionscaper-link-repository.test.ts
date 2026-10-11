/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { openFramescaperCompositionLinkRepository } from '../src/framescaper/editor-composition-link-repository.ts';
import { openFramescaperSuccessorRepository } from '../src/framescaper/editor-project-successor-repository.ts';
import { openFramescaperSuccessorDatabase } from '../src/framescaper/editor-project-successor-database.ts';
import { request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import type { MotionAsset } from '../src/common/editor/motion-asset.ts';

const bytes = new Uint8Array([1, 2, 3, 4]); const digest = digestScapeBytes(bytes);
const asset: MotionAsset = { id: 'image', kind: 'image', name: 'Image', mimeType: 'image/png', width: 1, height: 1, hasAlpha: true,
	sha256: digest, byteLength: bytes.length, storageKey: `motion-sha256:${digest}` };
function offer(revision: number, width = 1920) {
	const project = createMotionscaperProject({ id: 'motion', compositionId: 'main', title: `Title ${revision}`, width });
	return createMotionCompositionOffer('main', createMotionscaperRevision({ ...project, revision, assets: [asset, { ...asset, id: 'alias' }] }));
}
const readAsset = () => Promise.resolve({ size: bytes.length, stream: () => new Blob([bytes]).stream() });
function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((callback) => { resolve = callback; }); return { promise, resolve };
}

test('M10 receiver durably publishes its complete closure in the successor namespace and retains historical revisions offline', async () => {
	const factory = createInstrumentedIndexedDB(); const indexedDB = factory as unknown as IDBFactory;
	const repository = await openFramescaperCompositionLinkRepository({ indexedDB, line: 'successor' });
	try {
		const first = await repository.receive('frame', 'linked', offer(1), { readAsset });
		assert.equal(first.accepted.revision.revision, 1); assert.equal(factory.recordCount('kw-media-motionscaper-editor-v1', 'projects'), 0);
		assert.equal(factory.recordCount('kw-media-framescaper-editor-v1', 'projects'), 0);
		assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'assets'), 1); assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'staging'), 0);
		await repository.receive('frame', 'linked', offer(2), { readAsset });
		assert.equal((await repository.loadRevision('motion', offer(1).revision.digest))?.digest, offer(1).revision.digest);
		await repository.close();
		const reopened = await openFramescaperCompositionLinkRepository({ indexedDB, line: 'successor' });
		try {
			assert.equal((await reopened.load('frame', 'linked'))?.accepted.revision.revision, 2);
			const body = await reopened.readAsset(asset); assert.ok(body); assert.deepEqual(new Uint8Array(await new Response(body.stream()).arrayBuffer()), bytes);
		} finally { await reopened.close(); }
	} finally { await repository.close(); }
});

test('M10 corrupt transfers and atomic state publication failures leave accepted snapshots and bytes intact without orphan staging', async () => {
	const factory = createInstrumentedIndexedDB(); const repository = await openFramescaperCompositionLinkRepository({ indexedDB: factory as unknown as IDBFactory, line: 'successor' });
	try {
		await repository.receive('frame', 'linked', offer(1), { readAsset });
		await assert.rejects(repository.receive('frame', 'linked', offer(2), { readAsset: async () => ({ size: bytes.length, stream: () => new Blob([new Uint8Array([9, 2, 3, 4])]).stream() }) }), /digest/u);
		factory.failNextPutForStore('linkStates', new Error('disk failure'));
		await assert.rejects(repository.receive('frame', 'linked', offer(2), { readAsset }), /disk failure/u);
		assert.equal((await repository.load('frame', 'linked'))?.accepted.revision.revision, 1);
		assert.equal(await repository.loadRevision('motion', offer(2).revision.digest), null);
		assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'staging'), 0); assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'chunks'), 1);
	} finally { await repository.close(); }
});

test('M10 pending conform, Undo pause and Resume are durable and retain all closures needed by history', async () => {
	const factory = createInstrumentedIndexedDB(); const indexedDB = factory as unknown as IDBFactory;
	const repository = await openFramescaperCompositionLinkRepository({ indexedDB, line: 'successor' });
	try {
		await repository.receive('frame', 'linked', offer(1), { readAsset }); await repository.receive('frame', 'linked', offer(2), { readAsset });
		await repository.restore('frame', 'linked', offer(1)); await repository.receive('frame', 'linked', offer(3), { readAsset });
		const paused = await repository.load('frame', 'linked'); assert.equal(paused?.paused, true); assert.equal(paused?.pending?.revision.revision, 3);
		await repository.close(); const reopened = await openFramescaperCompositionLinkRepository({ indexedDB, line: 'successor' });
		try {
			assert.equal((await reopened.resume('frame', 'linked')).accepted.revision.revision, 3);
			assert.equal((await reopened.receive('frame', 'linked', offer(4, 1280), { readAsset })).accepted.revision.revision, 3);
			assert.equal((await reopened.conform('frame', 'linked')).accepted.revision.revision, 4);
			await assert.rejects(reopened.restore('frame', 'linked', offer(0)), /retained/u);
		} finally { await reopened.close(); }
	} finally { await repository.close(); }
});

test('M10 successor migration and composition retention share an upgrade-safe database while baseline entry points refuse linking', async () => {
	const factory = createInstrumentedIndexedDB(); const indexedDB = factory as unknown as IDBFactory;
	const migration = await openFramescaperSuccessorRepository({ indexedDB, line: 'successor' }); migration.close();
	const links = await openFramescaperCompositionLinkRepository({ indexedDB, line: 'successor' });
	try {
		await links.receive('frame:one', 'source:two', offer(1), { readAsset });
		assert.equal(await links.load('frame', 'one:source:two'), null);
		const reopened = await openFramescaperSuccessorRepository({ indexedDB, line: 'successor' }); assert.deepEqual(await reopened.list(), []); reopened.close();
		await assert.rejects(openFramescaperCompositionLinkRepository({ indexedDB, line: 'baseline' }), /successor/u);
		await assert.rejects(links.receive('frame', 'linked', { ...offer(2), version: 2 }, { readAsset }), /version/u);
	} finally { await links.close(); }
});

test('M10 upgrading an existing successor migration journal preserves both committed and interrupted original custody', async () => {
	const factory = createInstrumentedIndexedDB(); const indexedDB = factory as unknown as IDBFactory;
	const opening = indexedDB.open('kw-media-framescaper-editor-v2', 1);
	opening.onupgradeneeded = () => { for (const name of ['pending', 'projects']) opening.result.createObjectStore(name, { keyPath: 'id' }); };
	const original = await request(opening); const committed = { id: 'committed', originalArchive: new Blob(['original bytes']) }; const pending = { id: 'interrupted', originalArchive: new Blob(['pending bytes']) };
	await transact(original, ['projects', 'pending'], 'readwrite', async (stores) => { await request(stores.projects.put(committed)); await request(stores.pending.put(pending)); }); original.close();
	const upgraded = await openFramescaperSuccessorDatabase(indexedDB, 'successor');
	try {
		assert.equal(upgraded.version, 4); assert.ok(upgraded.objectStoreNames.contains('linkStates')); assert.ok(upgraded.objectStoreNames.contains('owners')); assert.ok(upgraded.objectStoreNames.contains('portableArchives'));
		await transact(upgraded, ['projects', 'pending'], 'readonly', async (stores) => {
			const saved = await request(stores.projects.get('committed')) as typeof committed; const staged = await request(stores.pending.get('interrupted')) as typeof pending;
			assert.equal(await saved.originalArchive.text(), 'original bytes'); assert.equal(await staged.originalArchive.text(), 'pending bytes');
		});
	} finally { upgraded.close(); }
});

test('M10 failure after staging a new dependency never exposes its bytes or removes historical dependencies', async () => {
	const factory = createInstrumentedIndexedDB(); const repository = await openFramescaperCompositionLinkRepository({ indexedDB: factory as unknown as IDBFactory, line: 'successor' });
	try {
		await repository.receive('frame', 'linked', offer(1), { readAsset });
		const newBytes = new Uint8Array([5, 6, 7]); const sha256 = digestScapeBytes(newBytes); const nextAsset = { ...asset, sha256, storageKey: `motion-sha256:${sha256}`, byteLength: newBytes.length };
		const next = createMotionCompositionOffer('main', createMotionscaperRevision({ ...offer(2).revision.project, assets: [nextAsset] }));
		factory.failNextPutForStore('linkStates', new Error('disk failure'));
		await assert.rejects(repository.receive('frame', 'linked', next, { readAsset: async () => ({ size: newBytes.length, stream: () => new Blob([newBytes]).stream() }) }), /disk failure/u);
		assert.equal(await repository.readAsset(nextAsset), null); assert.ok(await repository.readAsset(asset));
		assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'assets'), 1); assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'chunks'), 1); assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'staging'), 0);
	} finally { await repository.close(); }
});

test('M10 a delayed verified transfer cannot overwrite a newer accepted revision', async () => {
	const factory = createInstrumentedIndexedDB(); const repository = await openFramescaperCompositionLinkRepository({ indexedDB: factory as unknown as IDBFactory, line: 'successor' });
	try {
		await repository.receive('frame', 'linked', offer(1), { readAsset });
		const started = deferred<void>(); const release = deferred<Awaited<ReturnType<typeof readAsset>>>();
		const delayed = repository.receive('frame', 'linked', offer(2), { readAsset: () => { started.resolve(); return release.promise; } });
		await started.promise; await repository.receive('frame', 'linked', offer(3), { readAsset }); release.resolve(await readAsset());
		assert.equal((await delayed).accepted.revision.revision, 3); assert.equal((await repository.load('frame', 'linked'))?.accepted.revision.revision, 3);
		assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'staging'), 0);
	} finally { await repository.close(); }
});
