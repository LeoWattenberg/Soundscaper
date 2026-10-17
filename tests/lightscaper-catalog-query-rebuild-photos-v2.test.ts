/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openPhotoCatalogDatabaseV1 } from '../src/lightscaper/catalog/catalog-database.ts';
import { normalizePhotoDocumentV2, serializePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { indexState, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-index-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { rebuildPhotoQueryIndexPageForPhotosV2 as rebuild } from '../src/lightscaper/catalog/photo-query-rebuild-photos-v2.ts';
import { rebuildPhotoQueryIndexPageV1 } from '../src/lightscaper/catalog/photo-query-rebuild-v1.ts';
import { readPhotoQueryPageV1 } from '../src/lightscaper/catalog/photo-query-pages-v1.ts';
import { readPhotoQueryPageV2 } from '../src/lightscaper/catalog/photo-query-pages-v2.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });
const DATABASE = 'current-rebuild';
const current = (index: number) => normalizePhotoDocumentV2({ ...queryPhotoV1(index), schemaVersion: 2,
	versions: [{ ...queryPhotoV1(index).versions[0], develop: { ...defaultImageDevelopStateV1(), processVersion: 2,
		effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled: false, params: { lut: null } }] } }] });
async function seeded(count = 65) {
	const raw = createInstrumentedIndexedDB(), database = await openPhotoCatalogDatabaseV1(raw as unknown as IDBFactory, DATABASE, () => undefined);
	const photos = Array.from({ length: count }, (_, index) => index % 2 ? queryPhotoV1(index) : current(index));
	const root = { ...queryCatalogRootV1(), revision: 1, photoCount: photos.length };
	raw.seedRecord(DATABASE, 'catalogs', root); raw.seedRecord(DATABASE, 'catalogStates', indexState(root, 1));
	for (const photo of photos) {
		raw.seedRecord(DATABASE, 'photos', { key: `catalog|${photo.id}`, document: photo });
		raw.seedRecord(DATABASE, 'summaries', photoSummary(photo));
	}
	return { raw, database, photos, root };
}
const buildStore = (profile: 1 | 2) => profile === 1 ? 'photoQueryBuildStates' : 'photoQueryBuildStatesV2';
const rowStore = (profile: 1 | 2) => profile === 1 ? 'photoQueryRows' : 'photoQueryRowsV2';

test('both bounded metadata profiles rebuild all mixed Photo1/2 sources and preserve source bytes', async () => {
	for (const profile of [1, 2] as const) {
		const f = await seeded(), before = f.raw.records(DATABASE, 'photos'); let ready = false, steps = 0;
		while (!ready) {
			const page = profile === 1 ? await rebuild(f.database, 'catalog', 1) : await rebuild(f.database, 'catalog', 2);
			assert.ok(page.processed <= 16); assert.ok(page.bytes <= 8_388_608); ready = page.ready; steps++;
		}
		assert.equal(steps, 5); assert.equal(f.raw.recordCount(DATABASE, rowStore(profile)), 65);
		assert.deepEqual(f.raw.records(DATABASE, rowStore(profile)), f.photos.map(photo => profile === 1 ? projectPhotoQueryRowV1(photo) : projectPhotoQueryRowV2(photo)));
		const first = profile === 1 ? await readPhotoQueryPageV1(f.database, 'catalog') : await readPhotoQueryPageV2(f.database, 'catalog');
		assert.equal(first.items.length, 64); assert.ok(first.continuation);
		const last = profile === 1 ? await readPhotoQueryPageV1(f.database, 'catalog', { continuation: first.continuation })
			: await readPhotoQueryPageV2(f.database, 'catalog', { continuation: first.continuation });
		assert.equal(last.items.length, 1); assert.equal(last.continuation, null);
		assert.deepEqual(f.raw.records(DATABASE, 'photos'), before);
		assert.ok(f.raw.stats.cursorRequests.every((entry: { delivered: number }) => entry.delivered <= 65));
		assert.equal(f.raw.stats.countRequests.length, 0); assert.equal(f.raw.stats.getAllRequests.length, 0); f.database.close();
	}
});

test('named legacy rebuild still refuses a real Photo2 while current source admission accepts it', async () => {
	const f = await seeded(1); await assert.rejects(rebuildPhotoQueryIndexPageV1(f.database, 'catalog'));
	assert.equal(f.raw.recordCount(DATABASE, 'photoQueryRows'), 0);
	assert.equal((await rebuild(f.database, 'catalog', 1)).ready, true); f.database.close();
});

test('corrupt later-page source and native progress failure roll back only the current step', async () => {
	for (const profile of [1, 2] as const) {
		const f = await seeded(20); const first = profile === 1 ? await rebuild(f.database, 'catalog', 1) : await rebuild(f.database, 'catalog', 2);
		assert.equal(first.processed, 16); const previous = f.raw.records(DATABASE, buildStore(profile));
		const photo = f.photos[18]!;
		f.raw.seedRecord(DATABASE, 'photos', { key: `catalog|${photo.id}`, document: { ...photo, schemaVersion: 3 } });
		await assert.rejects(profile === 1 ? rebuild(f.database, 'catalog', 1) : rebuild(f.database, 'catalog', 2));
		assert.equal(f.raw.recordCount(DATABASE, rowStore(profile)), 16); assert.deepEqual(f.raw.records(DATABASE, buildStore(profile)), previous);
		f.raw.seedRecord(DATABASE, 'photos', { key: `catalog|${photo.id}`, document: photo });
		f.raw.failNextPutForStore(buildStore(profile), new Error('Current progress refused'));
		await assert.rejects(profile === 1 ? rebuild(f.database, 'catalog', 1) : rebuild(f.database, 'catalog', 2), /progress refused/u);
		assert.equal(f.raw.recordCount(DATABASE, rowStore(profile)), 16); assert.deepEqual(f.raw.records(DATABASE, buildStore(profile)), previous);
		assert.equal((profile === 1 ? await rebuild(f.database, 'catalog', 1) : await rebuild(f.database, 'catalog', 2)).ready, true); f.database.close();
	}
});

test('ready/count inconsistencies refuse before fast return and missing physical sources cannot claim readiness', async () => {
	for (const profile of [1, 2] as const) {
		const f = await seeded(1);
		f.raw.seedRecord(DATABASE, buildStore(profile), { id: 'catalog', schemaVersion: profile, ready: true, afterKey: null, indexedCount: 0 });
		await assert.rejects(profile === 1 ? rebuild(f.database, 'catalog', 1) : rebuild(f.database, 'catalog', 2), /count/iu);
		f.raw.seedRecord(DATABASE, buildStore(profile), { id: 'catalog', schemaVersion: profile, ready: false, afterKey: null, indexedCount: 0 });
		f.raw.seedRecord(DATABASE, 'catalogs', { ...f.root, photoCount: 2 });
		f.raw.seedRecord(DATABASE, 'catalogStates', indexState({ ...f.root, photoCount: 2 }, 1));
		await assert.rejects(profile === 1 ? rebuild(f.database, 'catalog', 1) : rebuild(f.database, 'catalog', 2), /count/iu);
		assert.equal(f.raw.recordCount(DATABASE, rowStore(profile)), 0); f.database.close();
	}
});

test('opaque native cancellation retains prior progress and leaves no active transaction', async () => {
	for (const profile of [1, 2] as const) {
		const f = await seeded(20), cancel = new AbortController(); let traps = 0;
		const reason = new Proxy({}, { get() { traps++; throw Error('Reason reflected'); }, getPrototypeOf() { traps++; throw Error('Prototype reflected'); } });
		f.raw.onNextGetForStore('catalogStates', () => cancel.abort(reason));
		let failure: unknown;
		try { await (profile === 1 ? rebuild(f.database, 'catalog', 1, cancel.signal) : rebuild(f.database, 'catalog', 2, cancel.signal)); }
		catch (error) { failure = error; }
		assert.equal(failure, reason);
		assert.equal(f.raw.recordCount(DATABASE, rowStore(profile)), 0); assert.equal(f.raw.stats.activeTransactions, 0); assert.equal(traps, 0); f.database.close();
	}
});

test('legacy current-source budget includes complete successor document and its derived row', async () => {
	const f = await seeded(1), photo = f.photos[0]!;
	const page = await rebuild(f.database, 'catalog', 1);
	assert.equal(page.bytes, new TextEncoder().encode(serializePhotoDocumentV1OrV2(photo)).byteLength
		+ new TextEncoder().encode(JSON.stringify(projectPhotoQueryRowV1(photo))).byteLength); f.database.close();
});

test('combined successor/source row budget stops before the next legal rich photo for both profiles', async () => {
	for (const profile of [1, 2] as const) {
		const f = await seeded(8), base = current(0), effects = Array.from({ length: 95 }, (_, index) => ({
			id: `effect-${index}-${'x'.repeat(100)}`, type: 'color-adjust', enabled: true, params: {} }));
		const rich = f.photos.map(photo => normalizePhotoDocumentV2({ ...photo, schemaVersion: 2,
			activeVersionId: 'version-0', versions: Array.from({ length: 64 }, (_, index) => ({ ...base.versions[0],
				id: `version-${index}`, kind: index === 0 ? 'master' : 'virtual-copy', develop: { ...base.versions[0]!.develop,
					effects: [...base.versions[0]!.develop.effects, ...effects] } })) }));
		for (const photo of rich) f.raw.seedRecord(DATABASE, 'photos', { key: `catalog|${photo.id}`, document: photo });
		const source = rich.map(photo => new TextEncoder().encode(serializePhotoDocumentV1OrV2(photo)).byteLength);
		const derived = rich.map(photo => new TextEncoder().encode(JSON.stringify(profile === 1 ? projectPhotoQueryRowV1(photo) : projectPhotoQueryRowV2(photo))).byteLength);
		let expected = 0, total = 0;
		while (expected < rich.length && total + source[expected]! + derived[expected]! <= 8_388_608) {
			total += source[expected]! + derived[expected]!; expected++;
		}
		assert.ok(expected > 0 && expected < rich.length);
		const page = profile === 1 ? await rebuild(f.database, 'catalog', 1) : await rebuild(f.database, 'catalog', 2);
		assert.equal(page.processed, expected); assert.equal(page.ready, false);
		assert.equal(page.bytes + ('derivedBytes' in page && typeof page.derivedBytes === 'number' ? page.derivedBytes : 0), total);
		assert.ok(f.raw.stats.cursorRequests.every((entry: { delivered: number }) => entry.delivered <= expected + 1)); f.database.close();
	}
});
