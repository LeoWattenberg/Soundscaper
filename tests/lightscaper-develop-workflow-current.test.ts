/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryDevelopWorkflowCurrentV1, type ExecutePhotoDevelopCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-current-v1.ts';
import { createPhotoLibraryDevelopSessionV3, type PhotoLibraryDevelopSessionHostV3 } from '../src/lightscaper/controller/photo-library-develop-session-v3.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoCommandOwnerCurrentV1 } from '../src/lightscaper/controller/photo-command-owner-current-v1.ts';
import { PhotoLibrarySessionLifetime } from '../src/lightscaper/controller/photo-library-session-lifetime.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import { normalizeVideoMaskMatteGraphV1OrV2 } from '../src/common/editor/video-mask-matte-name-v2.ts';
import type { PhotoLibraryDevelopAcknowledgementV3, PhotoLibraryDevelopPortV3 } from '../src/common/editor/photo-library-develop-port-v3.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { gradientGraph } from './helpers/lightscaper-masked-frame-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const TIME = '2026-10-11T00:00:00.000Z';
function repairs() {
	return replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV2(), { schemaVersion: 1, spots: [
		{ id: 'clone', mode: 'clone', enabled: false, target: { x: 0.5, y: 0.5 }, source: { x: 0.25, y: 0.5 }, radius: 0.1, feather: 0.5, opacity: 1 },
		{ id: 'heal', mode: 'heal', enabled: false, target: { x: 0.7, y: 0.5 }, source: { x: 0.2, y: 0.5 }, radius: 0.2, feather: 0, opacity: 0.5 },
	] });
}
async function fixture() {
	const raw = createInstrumentedIndexedDB(), databaseName = `lightscaper-workflow-current-${crypto.randomUUID()}`;
	const repository = new PhotoCatalogRepositoryCurrentV1({ indexedDB: raw as unknown as IDBFactory, databaseName, verifyOriginal: async () => undefined });
	const seed = photoArchiveFixture(1), lifetime = new PhotoLibrarySessionLifetime();
	await repository.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1', name: 'Current workflow',
		revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	await repository.publishPhotos('catalog-1', 0, [seed.photo]);
	const host: PhotoLibraryDevelopSessionHostV3 = { repository, ready: async () => 'catalog-1', operation: (run, signal) => lifetime.operation(run, signal),
		edit: (photoId, run, signal) => lifetime.mutation(async admitted => {
			const owner = await PhotoCommandOwnerCurrentV1.open(repository, 'catalog-1', photoId);
			try { return await run(owner, admitted); } finally { await owner.close(); }
		}, signal) };
	const actual = createPhotoLibraryDevelopSessionV3(host), hooks = { current: true, refresh: async (): Promise<unknown> => undefined,
		acquire: async (): Promise<PhotoLibraryDevelopPortV3> => actual };
	const execute: ExecutePhotoDevelopCurrentV1 = async (action, signal) => {
		const admitted = signal ?? lifetime.signal;
		return action({ signal: admitted, acquire: () => hooks.acquire(), isCurrent: () => hooks.current, refresh: () => hooks.refresh() });
	};
	return { repository, raw, databaseName, seed, lifetime, actual, hooks, execute, close: () => lifetime.close(() => repository.close()) };
}
async function enteredBeforeSettlement(work: Promise<unknown>, entered: Promise<void>): Promise<void> {
	await Promise.race([entered, work.then(() => assert.fail('The held workflow settled before entering its actual capability.'), (error: unknown) => { throw error; })]);
}

test('Current workflow preserves exact repairs through effects, geometry, gestures, native Save, snapshot/copy/history and reopen', async () => {
	const f = await fixture(), owner = new PhotoLibraryDevelopWorkflowCurrentV1({ execute: f.execute, now: () => TIME });
	try {
		await owner.open('photo-1'); assert.equal(owner.snapshot().document?.schemaVersion, 3); assert.equal(owner.snapshot().draft?.processVersion, 1);
		owner.edit(repairs());
		const tone = createVideoEffectV2('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } });
		const detail = createVideoEffectV2('white-balance-v1', { id: 'detail' });
		owner.setEffects([tone, detail]); const draft = owner.snapshot().draft; assert.ok(draft && draft.processVersion === 3);
		owner.edit({ ...draft, masks: [normalizeVideoMaskMatteGraphV1OrV2({ ...gradientGraph(), schemaVersion: 2, name: 'Retained sky' })], maskBindings: [{ effectId: 'tone', maskId: 'mask' }],
			geometry: { ...draft.geometry, flipHorizontal: true } });
		const beforeGesture = owner.snapshot().draft;
		owner.beginGesture(); owner.previewEffect('tone', { exposure: 2 }); owner.cancelGesture(); assert.deepEqual(owner.snapshot().draft, beforeGesture);
		owner.beginGesture(); owner.previewEffect('tone', { exposure: 0.5 }); owner.commitGesture(); owner.setEffects([detail, tone]);
		assert.deepEqual(owner.snapshot().draft?.maskBindings, [{ effectId: 'tone', maskId: 'mask' }]);
		owner.setEffects([detail]); assert.deepEqual(owner.snapshot().draft?.maskBindings, []);
		const intended = owner.snapshot().draft; assert.ok(intended?.processVersion === 3); assert.deepEqual(intended.repairs, repairs().repairs);
		const saved = await owner.save('Repairs and effects'); assert.ok(saved); assert.equal(saved.schemaVersion, 3); assert.deepEqual(saved.snapshot.develop, intended);
		await owner.apply({ type: 'save-develop-snapshot', versionId: 'version-1', id: 'saved', name: 'Saved', createdAt: TIME });
		await owner.apply({ type: 'create-virtual-copy', id: 'copy', name: 'Copy', sourceVersionId: 'version-1', createdAt: TIME });
		assert.equal(owner.snapshot().document?.versionId, 'copy'); assert.deepEqual(owner.snapshot().draft, intended);
		await owner.apply({ type: 'activate-version', versionId: 'version-1' });
		await owner.apply({ type: 'select-develop-history', versionId: 'version-1', cursor: 0 }); assert.equal(owner.snapshot().draft?.processVersion, 1);
		const stored = await f.repository.loadPhoto('catalog-1', 'photo-1'); assert.ok(stored); assert.equal(stored.schemaVersion, 3);
		assert.deepEqual(stored.versions.find(version => version.id === 'copy')?.develop, intended); assert.deepEqual(stored.original, f.seed.photo.original);
		await owner.apply({ type: 'restore-develop-snapshot', versionId: 'version-1', snapshotId: 'saved', label: 'Restored', createdAt: TIME });
		assert.deepEqual(owner.snapshot().draft, intended);
		await owner.close(); const reopened = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.raw as unknown as IDBFactory,
			databaseName: f.databaseName, verifyOriginal: async () => undefined });
		try { assert.deepEqual((await reopened.loadPhoto('catalog-1', 'photo-1'))?.versions[0]?.develop, intended); } finally { await reopened.close(); }
	} finally { await owner.close(); await f.close(); }
});

test('Current edits refuse repair downgrade and over-budget effects before entry traps, preserving local draft and gesture state', async () => {
	const f = await fixture(), owner = new PhotoLibraryDevelopWorkflowCurrentV1({ execute: f.execute }); let traps = 0;
	try {
		await owner.open('photo-1'); owner.edit(repairs()); const before = owner.snapshot().draft;
		assert.throws(() => owner.edit(defaultImageDevelopStateV2())); assert.deepEqual(owner.snapshot().draft, before);
		const effects = Array.from({ length: 257 }, () => new Proxy({}, { ownKeys() { traps++; throw Error('Over-limit effect reflected.'); } }));
		assert.throws(() => Reflect.apply(owner.setEffects, owner, [effects])); assert.equal(traps, 0); assert.deepEqual(owner.snapshot().draft, before);
		owner.beginGesture(); owner.cancelGesture(); assert.deepEqual(owner.snapshot().draft, before);
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.revision, 0);
	} finally { await owner.close(); await f.close(); }
});

test('Current CAS conflict keeps the complete dirty repair recipe and reload uses the actual newer revision', async () => {
	const f = await fixture(), owner = new PhotoLibraryDevelopWorkflowCurrentV1({ execute: f.execute, now: () => TIME });
	try {
		await owner.open('photo-1'); owner.edit(repairs()); const draft = owner.snapshot().draft;
		const photo = await f.repository.loadPhoto('catalog-1', 'photo-1'); assert.ok(photo);
		await f.repository.savePhoto({ ...photo, metadata: { ...photo.metadata, title: 'External update' } }, photo.revision);
		assert.equal(await owner.save('Conflict'), null); assert.ok(owner.snapshot().error); assert.equal(owner.snapshot().dirty, true); assert.deepEqual(owner.snapshot().draft, draft);
		owner.discard(); await owner.reload(); assert.equal(owner.snapshot().document?.revision, 1); assert.equal(owner.snapshot().dirty, false);
	} finally { await owner.close(); await f.close(); }
});

test('Current Save claims its latch before a reentrant clock and preserves the captured version and repairs', async () => {
	const f = await fixture(), nested: Promise<unknown>[] = [];
	const owner = new PhotoLibraryDevelopWorkflowCurrentV1({ execute: f.execute, now() {
		nested.push(owner.apply({ type: 'select-develop-history', versionId: 'version-1', cursor: 0 })); owner.setEffects([]); return TIME;
	} });
	try {
		await owner.open('photo-1'); owner.edit(repairs()); const ack = await owner.save('Clock'); assert.ok(ack);
		assert.deepEqual(ack.snapshot.develop, repairs()); assert.deepEqual(await Promise.all(nested), [null]); assert.equal(ack.snapshot.history.cursor, 1);
	} finally { await owner.close(); await f.close(); }
});

test('Current workflow returns the real stored ACK after held delivery, Cancel/Close and failed refresh without republishing retired state', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	const holder: { save?: Promise<PhotoLibraryDevelopAcknowledgementV3 | null> } = {};
	const owner = new PhotoLibraryDevelopWorkflowCurrentV1({ execute: f.execute, now: () => TIME });
	try {
		await owner.open('photo-1'); owner.edit(repairs());
		f.hooks.acquire = async () => ({ ...f.actual, async apply(request, options) {
			const ack = await f.actual.apply(request, options); entered.resolve(); await release.promise; return ack;
		} });
		holder.save = owner.save('Native ACK'); await enteredBeforeSettlement(holder.save, entered.promise);
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.revision, 1);
		const closing = owner.close(); assert.equal(owner.close(), closing); assert.equal(await remainsPending(closing), true);
		release.resolve(); const ack = await holder.save; assert.ok(ack); assert.deepEqual(ack.snapshot.develop, repairs()); await closing;
		assert.equal(owner.snapshot().visible, false); assert.equal(owner.snapshot().receipt, null);
		const next = new PhotoLibraryDevelopWorkflowCurrentV1({ execute: f.execute, now: () => TIME });
		try {
			await next.open('photo-1'); const value = next.snapshot().draft; assert.ok(value?.processVersion === 3);
			next.edit({ ...value, repairs: { schemaVersion: 1, spots: [] } }); f.hooks.refresh = async () => { throw Proxy.revocable({}, {}).proxy; };
			const receipt = await next.save('Clear'); assert.ok(receipt); assert.equal(receipt.snapshot.develop.processVersion, 3);
			assert.equal(next.snapshot().notice, 'refresh-failed'); assert.equal(next.snapshot().receipt, receipt);
		} finally { await next.close(); }
	} finally { release.resolve(); await Promise.allSettled(holder.save ? [holder.save] : []); await owner.close(); await f.close(); }
});

test('Current acquire pins the original execution context receiver while held and rejects stale presentation without saving', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), holder: { open?: Promise<unknown> } = {}; let metadata = 0;
	const context = { signal: f.lifetime.signal, async acquire() { assert.equal(this, context); entered.resolve(); await release.promise; return f.actual; },
		isCurrent() { assert.equal(this, context); return f.hooks.current; }, async refresh() { assert.equal(this, context); } };
	Reflect.set(context, 'isCurrent', new Proxy(context.isCurrent, { get() { metadata++; throw Error('Callable metadata reflected.'); } }));
	const owner = new PhotoLibraryDevelopWorkflowCurrentV1({ execute: async action => action(context) });
	try {
		holder.open = owner.open('photo-1'); await enteredBeforeSettlement(holder.open, entered.promise);
		Reflect.set(context, 'isCurrent', () => assert.fail('Replacement currentness')); Reflect.set(context, 'refresh', () => assert.fail('Replacement refresh'));
		f.hooks.current = false; release.resolve(); await holder.open;
		assert.equal(owner.snapshot().document, null); assert.equal(metadata, 0); assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.revision, 0);
	} finally { release.resolve(); await Promise.allSettled(holder.open ? [holder.open] : []); await owner.close(); await f.close(); }
});
