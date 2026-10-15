/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoLibraryDevelopSessionCurrentV1, normalizePhotoLibraryDevelopCommandCurrentV1,
	type PhotoLibraryDevelopSessionHostCurrentV1 } from '../src/lightscaper/controller/photo-library-develop-session-current-v1.ts';
import { createPhotoLibraryDevelopSessionV3 } from '../src/lightscaper/controller/photo-library-develop-session-v3.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoCommandOwnerCurrentV1 } from '../src/lightscaper/controller/photo-command-owner-current-v1.ts';
import { PhotoLibrarySessionLifetime } from '../src/lightscaper/controller/photo-library-session-lifetime.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { rawRecoveryDngFixtureV1 } from './helpers/lightscaper-raw-recovery-dng-current-fixture.ts';

const TIME = '2026-10-20T00:00:00.000Z';
function recipe() {
	return normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV2(), processVersion: 4,
		rawDevelopment: { schemaVersion: 1, mode: 'recovery' }, repairs: { schemaVersion: 1, spots: [] } });
}
async function fixture() {
	const indexedDB = createInstrumentedIndexedDB(), databaseName = `raw-develop-session-${crypto.randomUUID()}`;
	const repository = new PhotoCatalogRepositoryCurrentV1({ indexedDB: indexedDB as unknown as IDBFactory, databaseName, verifyOriginal: async () => undefined });
	const raw = rawRecoveryDngFixtureV1(), seed = photoArchiveFixture(1, raw.bytes), lifetime = new PhotoLibrarySessionLifetime();
	// Actual owned DNG identity; this test qualifies native scalar publication,
	// not RAW decoding (qualified independently with the production worker).
	const photo = normalizePhotoDocumentV1({ ...seed.photo, original: { ...seed.photo.original, name: 'Recovery.dng',
		mimeType: 'image/x-adobe-dng', width: raw.width, height: raw.height } });
	await repository.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1', name: 'RAW source settings',
		revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	await repository.publishPhotos('catalog-1', 0, [photo]);
	const state = { failAfterWrite: false, reads: 0 };
	const host: PhotoLibraryDevelopSessionHostCurrentV1 = { repository, ready: async () => { state.reads++; return 'catalog-1'; },
		operation: (run, signal) => lifetime.operation(run, signal),
		edit: (photoId, run, signal) => lifetime.mutation(async admitted => {
			const owner = await PhotoCommandOwnerCurrentV1.open(repository, 'catalog-1', photoId);
			let result: Awaited<ReturnType<typeof run>>;
			try { result = await run(owner, admitted); } finally { await owner.close(); }
			if (state.failAfterWrite) throw new Error('Selected lease failed after durable commit.'); return result;
		}, signal) };
	return { repository, host, state, photo, lifetime, port: createPhotoLibraryDevelopSessionCurrentV1(host), close: () => lifetime.close(() => repository.close()) };
}

test('Current Session records RAW process4 under Photo3 and returns its real durable ACK after surrounding lease failure', async () => {
	const f = await fixture();
	try {
		const before = await f.port.read({ schemaVersion: 3, photoId: f.photo.id }); f.state.failAfterWrite = true;
		const ack = await f.port.apply({ schemaVersion: 3, photoId: f.photo.id, expectedRevision: before.revision,
			command: { type: 'record-develop', versionId: before.versionId, develop: recipe(), label: 'Recover', createdAt: TIME } });
		assert.equal(ack.schemaVersion, 3); assert.deepEqual(ack.notices, ['cleanup-failed']); assert.equal(ack.snapshot.revision, 1);
		assert.deepEqual(ack.snapshot.develop, recipe()); assert.equal(ack.snapshot.history.cursor, 1);
		const stored = await f.repository.loadPhoto('catalog-1', f.photo.id); assert.ok(stored); assert.equal(stored.schemaVersion, 3);
		assert.deepEqual(stored.versions[0]!.develop, recipe()); assert.deepEqual(stored.original, f.photo.original);
		assert.deepEqual((await f.port.read({ schemaVersion: 3, photoId: f.photo.id })).develop, recipe());
		const fixed = createPhotoLibraryDevelopSessionV3({ repository: f.repository, ready: f.host.ready, operation: f.host.operation, edit: f.host.edit });
		await assert.rejects(fixed.read({ schemaVersion: 3, photoId: f.photo.id }));
		await assert.rejects(fixed.apply({ schemaVersion: 3, photoId: f.photo.id, expectedRevision: 1,
			command: { type: 'save-develop-snapshot', versionId: before.versionId, id: 'forbidden', name: 'Forbidden V3 snapshot', createdAt: TIME } }));
		assert.equal((await f.repository.loadPhoto('catalog-1', f.photo.id))?.revision, 1);
	} finally { await f.close(); }
});

test('Current Session captures process4 intent and refuses accessors without invoking them', () => {
	const draft = structuredClone(recipe()), mutable = { type: 'record-develop', versionId: 'version-1', develop: draft, label: 'Recovery', createdAt: TIME };
	const command = normalizePhotoLibraryDevelopCommandCurrentV1(mutable); Reflect.set(draft.rawDevelopment, 'mode', 'canonical');
	assert.equal(command.type, 'record-develop');
	if (command.type !== 'record-develop') assert.fail('The record command changed kind.'); assert.deepEqual(command.develop, recipe());
	let reads = 0; const getter = Object.defineProperty({ ...mutable }, 'develop', { enumerable: true, get() { reads++; return recipe(); } });
	assert.throws(() => normalizePhotoLibraryDevelopCommandCurrentV1(getter)); assert.equal(reads, 0);
});

test('Current Session preserves opaque preabort before hostile command admission or catalog acquisition', async () => {
	const f = await fixture(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); stop.abort(opaque.proxy); let traps = 0;
	try {
		const hostile = new Proxy({}, { ownKeys() { traps++; throw new Error('Request reflected.'); }, getOwnPropertyDescriptor() { traps++; throw new Error('Request reflected.'); } });
		let failure: unknown;
		try { await Reflect.apply(f.port.apply, f.port, [hostile, { signal: stop.signal }]); } catch (error) { failure = error; }
		assert.ok(Object.is(failure, opaque.proxy)); assert.equal(traps, 0); assert.equal(f.state.reads, 0);
		assert.equal((await f.repository.loadPhoto('catalog-1', f.photo.id))?.revision, 0);
	} finally { await f.close(); }
});

test('Current Session pins a supplied derived Original independently of its canonical fallback', async () => {
	const f = await fixture(); let canonical = 0, derived = 0;
	const original = { async withFrame<Result>(): Promise<Result> { assert.equal(this, original); canonical++; throw new Error('Canonical supplied'); },
		async withDerivedFrame<Result>(): Promise<Result> { assert.equal(this, original); derived++; throw new Error('Derived supplied'); } };
	try {
		const port = createPhotoLibraryDevelopSessionCurrentV1({ ...f.host, original }); assert.ok(port.original?.withDerivedFrame);
		Reflect.set(original, 'withFrame', () => assert.fail('Canonical replacement')); Reflect.set(original, 'withDerivedFrame', () => assert.fail('Derived replacement'));
		await assert.rejects(port.original.withFrame({ schemaVersion: 1, photoId: f.photo.id, expectedRevision: 0 }, () => undefined), /Canonical supplied/u);
		await assert.rejects(port.original.withDerivedFrame({ schemaVersion: 1, photoId: f.photo.id, expectedRevision: 0, profile: 'highlight-recovery-v1' }, () => undefined), /Derived supplied/u);
		assert.equal(canonical, 1); assert.equal(derived, 1); assert.equal(f.state.reads, 0);
	} finally { await f.close(); }
});
