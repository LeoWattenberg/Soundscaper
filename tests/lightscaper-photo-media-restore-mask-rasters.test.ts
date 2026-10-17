/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after } from 'node:test';
import { createPhotoMediaRestoreCandidateV2, type PhotoMediaRestoreCandidateV2 } from '../src/lightscaper/storage/photo-media-restore-candidate-v2.ts';
import { createPhotoCatalogRestoreStageV2 } from '../src/lightscaper/catalog/photo-catalog-restore-stage-v2.ts';
import { normalizePhotoDocumentV2, type PhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { createPhotoDevelopWorkspaceV2, commitPhotoDevelopWorkspaceV2, selectPhotoDevelopHistoryV2 } from '../src/lightscaper/catalog/photo-develop-workspace-v2.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { withBrushMaskResourceV1, withPreparedBrushMaskResourceV1, type BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { PhotoMaskRasterRepositoryV1 } from '../src/lightscaper/storage/photo-mask-raster-repository-v1.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mediaRestoreFixture, mediaRestoreAllocation, mediaRestoreRoot, mediaRestorePhoto, mediaRestoreChunks } from './helpers/lightscaper-media-restore-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const ORIGINAL = new Uint8Array([1, 2, 3]), ALPHA = [0, 255, 127, 64], STEP = { label: 'Brush edit', createdAt: '2026-10-11T00:00:00.000Z' };
const BODY = new Uint8Array([83, 67, 77, 65, 83, 75, 48, 49, 2, 0, 0, 0, 2, 0, 0, 0, ...ALPHA]);
type Location = 'active' | 'disabled' | 'unbound' | 'unused' | 'inactive' | 'history' | 'redo' | 'snapshot';
interface Declaration { readonly id: string; readonly entry: string; readonly reference: Readonly<BrushMaskResourceReferenceV1>; }
type Candidate = PhotoMediaRestoreCandidateV2 & { writeMaskRaster(reference: unknown, bytes: unknown): Promise<void>; };
const prepared = () => withPreparedBrushMaskResourceV1({ width: 2, height: 2, alpha: new Uint8Array(ALPHA) }, view => {
	const sha256 = createHash('sha256').update(BODY).digest('hex');
	assert.deepEqual(view.bytes, BODY); assert.deepEqual(view.reference, { storageKey: `brush-mask-v1:2:2:${sha256}`, sha256, width: 2, height: 2, byteLength: 20 });
	return { reference: view.reference, bytes: view.bytes.slice() };
});
const declaration = (reference: Readonly<BrushMaskResourceReferenceV1>): Declaration => ({ id: reference.storageKey, entry: `assets/masks/${reference.sha256}.scmask`, reference });
const options = (f: ReturnType<typeof mediaRestoreFixture>, maskRasters: readonly Declaration[], signal?: AbortSignal) => ({ indexedDB: f.factory,
	allocation: mediaRestoreAllocation(), root: mediaRestoreRoot(1), maskRasters, ...(signal === undefined ? {} : { signal }) });
function candidate(value: PhotoMediaRestoreCandidateV2): Candidate {
	const method = Object.getOwnPropertyDescriptor(value, 'writeMaskRaster');
	assert.ok(method && Object.hasOwn(method, 'value') && typeof method.value === 'function', 'Actual restore candidate must expose the admitted brush body writer.');
	return value as Candidate;
}
function photo(reference: Readonly<BrushMaskResourceReferenceV1>, location: Location = 'active'): PhotoDocumentV2 {
	const source = mediaRestorePhoto(), master = { ...source.versions[0]!, develop: defaultImageDevelopStateV2() };
	const develop = normalizeImageDevelopStateV1OrV2({ ...master.develop,
		effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled: location !== 'disabled', params: { exposure: -1 } }],
		masks: [{ schemaVersion: 1, id: 'brush', kind: 'matte', inputs: [{ name: 'paint', kind: 'alpha', sourceRef: reference.storageKey }],
			nodes: location === 'unused' ? [{ id: 'output', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }]
				: [{ id: 'output', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'output' }],
		maskBindings: location === 'unbound' || location === 'unused' ? [] : [{ effectId: 'tone', maskId: 'brush' }] });
	if (location === 'inactive') return normalizePhotoDocumentV2({ ...source, schemaVersion: 2, versions: [master,
		{ ...master, id: 'inactive', kind: 'virtual-copy', name: 'Retained brush', develop }] });
	if (location === 'history' || location === 'redo' || location === 'snapshot') {
		let workspace = createPhotoDevelopWorkspaceV2(master.develop, STEP);
		if (location === 'history') workspace = commitPhotoDevelopWorkspaceV2(createPhotoDevelopWorkspaceV2(develop, STEP), master.develop, { ...STEP, label: 'Clean current edit' });
		else if (location === 'redo') workspace = selectPhotoDevelopHistoryV2(commitPhotoDevelopWorkspaceV2(workspace, develop, STEP), 0);
		else workspace = { ...workspace, snapshots: [{ id: 'snapshot', name: 'Retained brush', createdAt: STEP.createdAt, develop }] };
		return normalizePhotoDocumentV2({ ...source, schemaVersion: 2, versions: [{ ...master, workspace }] });
	}
	return normalizePhotoDocumentV2({ ...source, schemaVersion: 2, versions: [{ ...master, develop }] });
}
async function catalog(f: ReturnType<typeof mediaRestoreFixture>, document: PhotoDocumentV2) {
	const stage = await createPhotoCatalogRestoreStageV2({ indexedDB: f.factory, databaseName: f.names.catalogDatabaseName,
		root: mediaRestoreRoot(1), savedState: null, restoreAllocation: mediaRestoreAllocation() });
	try { await stage.writePhoto(document); await stage.finish(); return stage; } catch (error) { await stage.rollback(); throw error; }
}
async function database(f: ReturnType<typeof mediaRestoreFixture>): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => { const opening = f.factory.open(f.names.mediaDatabaseName);
		opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); }; });
}

test('allocated restore authenticates every retained Photo brush declaration and reopens exact immutable body bytes', async () => {
	const body = await prepared();
	for (const location of ['active', 'disabled', 'unbound', 'unused', 'inactive', 'history', 'redo', 'snapshot'] as const) {
		const f = mediaRestoreFixture(), owner = candidate(await createPhotoMediaRestoreCandidateV2(options(f, [declaration(body.reference)])));
		const document = photo(body.reference, location), wire = JSON.stringify(document), stage = await catalog(f, document);
		try {
			await owner.writeOriginal(document, mediaRestoreChunks(ORIGINAL)); await owner.writeMaskRaster(body.reference, body.bytes);
			const raw = f.raw(f.names.mediaDatabaseName), initialReads = raw.stats.getAllRequests.length;
			raw.seedRecord(f.names.mediaDatabaseName, 'analysis', { key: 'source-analysis:legitimate', value: { cached: true } });
			const ack = await owner.finish(); assert.equal(ack.photoCount, 1); assert.equal(ack.originalCount, 1); assert.equal(ack.originalByteLength, 3);
			assert.equal(ack.lutCount, 0); assert.equal(ack.lutByteLength, 0); assert.equal(await owner.finish(), ack);
			assert.equal(raw.records(f.names.mediaDatabaseName, 'catalogOriginalRoots')[0]!.importId, null);
			assert.equal(raw.records(f.names.mediaDatabaseName, 'mediaAssets').length, 1); assert.equal(JSON.stringify(document), wire);
			await owner.close(); const db = await database(f), repository = new PhotoMaskRasterRepositoryV1({ memory: getMemoryDatabase(f.names.mediaDatabaseName), database: async () => db });
			let borrowed: Uint8Array | undefined;
			try { await repository.withBytes(body.reference, bytes => { borrowed = bytes; assert.deepEqual(bytes, body.bytes);
				return withBrushMaskResourceV1({ reference: body.reference, bytes }, value => assert.deepEqual([...value.alpha], ALPHA)); });
				assert.ok(borrowed?.every(byte => byte === 0)); } finally { await repository.close(); db.close(); }
			assert.equal(raw.stats.getAllRequests.length, initialReads); assert.equal(raw.stats.activeTransactions, 0);
			assert.equal(f.opens.some(open => open.name === 'lightscaper-photo-media-v2'), false, 'Bodies must stay in the actual allocated namespace.');
		} finally { await owner.rollback(); await stage.rollback(); }
	}
});

test('restore brush writer snapshots bytes before native ACK, joins Close and refuses retired delivery', async () => {
	const body = await prepared(), f = mediaRestoreFixture(), owner = candidate(await createPhotoMediaRestoreCandidateV2(options(f, [declaration(body.reference)])));
	const entered = deferred<void>(), release = deferred<void>(); let observed = false;
	f.observeTransactions((transaction, stores, mode) => {
		if (observed || mode !== 'readwrite' || (typeof stores === 'string' ? stores : [...stores].join(',')) !== 'analysis') return; observed = true;
		let handler: IDBTransaction['oncomplete'] = null;
		Object.defineProperty(transaction, 'oncomplete', { configurable: true, set(value: IDBTransaction['oncomplete']) { handler = value; },
			get() { return (event: Event) => { entered.resolve(); void release.promise.then(() => { if (handler) Reflect.apply(handler, transaction, [event]); }); }; } });
	});
	const bytes = body.bytes.slice(), writing = owner.writeMaskRaster(body.reference, bytes); bytes.fill(0);
	try { await Promise.race([entered.promise, writing.then(() => { throw Error('Brush write settled before its native ACK witness.'); })]);
		const closing = owner.close(); assert.equal(await remainsPending(writing), true); assert.equal(await remainsPending(closing), true);
		release.resolve(); await writing; await closing;
		assert.deepEqual(f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'analysis')[0]!.value.bytes, body.bytes);
		await assert.rejects(owner.writeMaskRaster(body.reference, body.bytes), /retired|failed/iu);
	} finally { release.resolve(); await Promise.allSettled([writing, owner.rollback()]); }
});

test('duplicate and undeclared brush delivery refuse before touching caller bytes in independent candidates', async () => {
	const body = await prepared();
	for (const mode of ['duplicate', 'undeclared'] as const) {
		const f = mediaRestoreFixture(), owner = candidate(await createPhotoMediaRestoreCandidateV2(options(f, mode === 'duplicate' ? [declaration(body.reference)] : [])));
		let traps = 0;
		const hostile = new Proxy({}, { get() { traps++; throw Error('Caller bytes read.'); }, ownKeys() { traps++; throw Error('Caller bytes reflected.'); },
			getOwnPropertyDescriptor() { traps++; throw Error('Caller bytes reflected.'); }, getPrototypeOf() { traps++; throw Error('Caller bytes reflected.'); } });
		try {
			if (mode === 'duplicate') await owner.writeMaskRaster(body.reference, body.bytes);
			await assert.rejects(owner.writeMaskRaster(body.reference, hostile), mode === 'duplicate' ? /already delivered/iu : /not exactly declared/iu);
			assert.equal(traps, 0); const rows = f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'analysis');
			assert.equal(rows.length, mode === 'duplicate' ? 1 : 0); if (mode === 'duplicate') assert.deepEqual(rows[0]!.value.bytes, BODY);
			assert.equal(f.raw(f.names.mediaDatabaseName).stats.activeTransactions, 0);
		} finally { await owner.rollback(); }
	}
});

test('authenticated brush completion retains the genuine five-store native ACK after an opaque late abort', async () => {
	const body = await prepared(), f = mediaRestoreFixture(), stop = new AbortController();
	const owner = candidate(await createPhotoMediaRestoreCandidateV2(options(f, [declaration(body.reference)], stop.signal))), document = photo(body.reference), stage = await catalog(f, document);
	let completions = 0, traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('Opaque reason read.'); }, ownKeys() { traps++; throw Error('Opaque reason reflected.'); },
		getOwnPropertyDescriptor() { traps++; throw Error('Opaque reason reflected.'); }, getPrototypeOf() { traps++; throw Error('Opaque reason reflected.'); } });
	try {
		await owner.writeOriginal(document, mediaRestoreChunks(ORIGINAL)); await owner.writeMaskRaster(body.reference, body.bytes);
		f.observeTransactions((transaction, stores, mode) => {
			if (mode !== 'readwrite' || typeof stores === 'string' || [...stores].sort().join(',') !== 'analysis,catalogOriginalRoots,mediaAssetChunks,mediaAssets,settings') return;
			let handler: IDBTransaction['oncomplete'] = null;
			Object.defineProperty(transaction, 'oncomplete', { configurable: true, set(value: IDBTransaction['oncomplete']) { handler = value; },
				get() { return (event: Event) => { if (handler) Reflect.apply(handler, transaction, [event]); completions++; stop.abort(reason); }; } });
		});
		const ack = await owner.finish(); assert.equal(completions, 1); assert.equal(traps, 0); assert.equal(stop.signal.reason, reason);
		assert.equal(await owner.finish(), ack); assert.deepEqual(ack, { databaseName: f.names.mediaDatabaseName, catalogId: 'catalog-1',
			photoCount: 1, originalCount: 1, originalByteLength: 3, lutCount: 0, lutByteLength: 0 });
		const raw = f.raw(f.names.mediaDatabaseName); assert.deepEqual(raw.records(f.names.mediaDatabaseName, 'analysis')[0]!.value.bytes, BODY);
		assert.equal(raw.records(f.names.mediaDatabaseName, 'catalogOriginalRoots')[0]!.importId, null); assert.equal(raw.stats.activeTransactions, 0);
	} finally { await owner.rollback(); await stage.rollback(); }
});

test('brush declaration admission rejects malformed, duplicate and conflicting scalar inventories before namespace acquisition', async () => {
	const body = await prepared(), valid = declaration(body.reference);
	for (const declarations of [[{ ...valid, entry: 'assets/masks/near.scmask' }], [valid, valid], [{ ...valid, reference: { ...body.reference, width: 3 } }], [{ ...valid, extra: true }]]) {
		const f = mediaRestoreFixture(); await assert.rejects(createPhotoMediaRestoreCandidateV2(options(f, declarations))); assert.deepEqual(f.opens, []); assert.deepEqual(f.deleted, []);
	}
});

test('completion refuses corrupt, missing, extra and reserved future brush bodies before custody promotion', async () => {
	const body = await prepared();
	for (const mode of ['missing-delivery', 'missing-row', 'body', 'metadata', 'extra', 'future', 'unused-declaration'] as const) {
		const f = mediaRestoreFixture(), owner = candidate(await createPhotoMediaRestoreCandidateV2(options(f, [declaration(body.reference)])));
		const document = mode === 'unused-declaration' ? normalizePhotoDocumentV2({ ...mediaRestorePhoto(), schemaVersion: 2 }) : photo(body.reference), stage = await catalog(f, document);
		try {
			await owner.writeOriginal(document, mediaRestoreChunks(ORIGINAL));
			if (mode !== 'missing-delivery') await owner.writeMaskRaster(body.reference, body.bytes);
			const raw = f.raw(f.names.mediaDatabaseName), row = raw.records(f.names.mediaDatabaseName, 'analysis')[0];
			if (mode === 'missing-row') await f.remove(f.names.mediaDatabaseName, 'analysis', body.reference.storageKey);
			if (mode === 'body') { assert.ok(row); raw.seedRecord(f.names.mediaDatabaseName, 'analysis', { ...row, value: { ...row.value, bytes: new Uint8Array(body.bytes.byteLength) } }); }
			if (mode === 'metadata') { assert.ok(row); raw.seedRecord(f.names.mediaDatabaseName, 'analysis', { ...row, value: { ...row.value, reference: { ...body.reference, width: 3 } } }); }
			if (mode === 'extra' || mode === 'future') raw.seedRecord(f.names.mediaDatabaseName, 'analysis', { key: `${mode === 'future' ? 'brush-mask-v9' : 'brush-mask-v1'}:2:2:${'f'.repeat(64)}`, value: null });
			await assert.rejects(owner.finish()); assert.ok(raw.records(f.names.mediaDatabaseName, 'catalogOriginalRoots').every(root => root.importId !== null));
			assert.equal(raw.stats.activeTransactions, 0);
		} finally { await owner.rollback(); await stage.rollback(); }
	}
});
