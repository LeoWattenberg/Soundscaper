/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { PhotoLibraryImportItemV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { readStoredPhotoV1OrV2 } from '../src/lightscaper/catalog/photo-catalog-records-v2.ts';
import { PhotoLibrarySessionLifetime } from '../src/lightscaper/controller/photo-library-session-lifetime.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2 as CATALOG } from '../src/lightscaper/storage/photo-library-location-v2.ts';
import { PhotoMediaStoreV1, PHOTO_MEDIA_NAMESPACES_V1 as MEDIA } from '../src/lightscaper/storage/photo-media-store.ts';
import { remainsPending, settle } from './helpers/async-test-control.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { controlledLocks, installAcquisitionPlatform, observed, WriterAcquisitionFixture, type AcquisitionCut } from './helpers/lightscaper-opfs-writer-acquisition-fixture.ts';

const OPTIONS = { concurrency: false, timeout: 5_000 };
const PRIOR = Uint8Array.of(8, 3, 7, 2);
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQlNf/DwACAwFflwzAewAAAABJRU5ErkJggg==', 'base64'));
const OTHER_PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function entered<Value>(gate: Promise<void>, work: ReturnType<typeof observed<Value>>, description: string): Promise<void> {
	await Promise.race([gate, work.then(result => {
		if (!result.ok) throw result.error;
		throw new Error(`Actual operation settled without ${description}.`);
	})]);
}
async function pending(work: Promise<unknown>, closing: Promise<unknown>, cleanup: () => number, delayMs = 0): Promise<void> {
	for (let turn = 0; turn < 3; turn++) {
		await settle(1, { delayMs }); assert.equal(await remainsPending(work), true, 'Acquisition owner settled before its real terminal/cleanup.');
		assert.equal(await remainsPending(closing), true, 'Close bypassed the admitted acquisition.'); assert.equal(cleanup(), 0);
	}
}
function unchanged(fixture: WriterAcquisitionFixture): void { assert.deepEqual(fixture.files.get('prior.blob')?.bytes, PRIOR); }

async function cancelledAcquisition(cut: Exclude<AcquisitionCut, 'close-result'>, timeoutMs?: number, acquisitionFailure?: Error) {
	const fixture = new WriterAcquisitionFixture(), { client, worker } = fixture.client(timeoutMs);
	fixture.seed('prior.blob', PRIOR); fixture.arm(cut); fixture.acquisitionFailure = acquisitionFailure;
	const lifetime = new PhotoLibrarySessionLifetime(), caller = new AbortController(), reason = Symbol(`first-${cut}`);
	let resourceCloses = 0;
	assert.equal(await client.initialize(fixture.directory as unknown as FileSystemDirectoryHandle), true);
	const work = observed(lifetime.mutation(signal => client.openWriter('media-asset-chunk-write', 'new.blob', signal), caller.signal));
	let closing: Promise<void> | undefined;
	try {
		await entered(fixture.entered.promise, work, `${cut} acquisition hold`);
		unchanged(fixture); assert.ok(fixture.path); assert.equal(fixture.file().bytes.byteLength, 0);
		caller.abort(reason); closing = lifetime.close(async () => { resourceCloses++; client.close(); });
		assert.equal(lifetime.close(async () => assert.fail('Second cleanup.')), closing); caller.abort(Symbol('later'));
		await assert.rejects(lifetime.operation(async () => assert.fail('New work entered.')), /closed/u);
		await pending(work, closing, () => resourceCloses, timeoutMs === undefined ? 0 : 10);
		assert.equal(worker.terminated, 0); unchanged(fixture);
		assert.equal(fixture.events.some(value => value.startsWith('remove-enter:')), false, 'Reclamation entered before acquisition terminal.');
		if (cut !== 'open-result') assert.equal(fixture.file().calls.includes('truncate'), false);
		assert.equal(fixture.file().calls.includes('write'), false);
		fixture.release.resolve(); await entered(fixture.removalEntered.promise, work, 'real unsignalled reclamation');
		await pending(work, closing, () => resourceCloses, timeoutMs === undefined ? 0 : 10);
		assert.equal(worker.terminated, 0); assert.equal(fixture.files.has('new.blob'), true); unchanged(fixture);
		fixture.removalRelease.resolve(); const result = await work; await closing; await worker.drain();
		assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, reason), true);
		assert.equal(fixture.files.has('new.blob'), false); assert.equal(resourceCloses, 1); assert.equal(worker.terminated, 1);
		assert.equal(fixture.file().calls.filter(value => value === 'close').length, Number(cut !== 'file'));
		if (cut !== 'open-result') assert.equal(fixture.file().calls.includes('truncate'), false);
		assert.equal(fixture.file().calls.includes('write'), false); unchanged(fixture);
	} finally {
		fixture.releaseAll(); await work; await observed(closing ?? lifetime.close(async () => client.close())); await fixture.dispose();
	}
}

// These tests exercise production Worker classes through explicit Node ports,
// never a browser worker/native OPFS claim. Real runtime envelopes are forwarded.
for (const cut of ['file', 'access', 'open-result'] as const) test(`Light Session Close joins actual OPFS ${cut} acquisition and reclamation`, OPTIONS, async () => {
	await cancelledAcquisition(cut);
});

for (const cut of ['file', 'open-result'] as const) test(`cancelled ${cut} acquisition and Close outlive real broker deadlines through cleanup`, OPTIONS, async () => {
	await cancelledAcquisition(cut, 10);
});

test('a cancelled real acquisition ERROR terminal joins cleanup and preserves the local first reason', OPTIONS, async () => {
	await cancelledAcquisition('file', undefined, new Error('controlled acquisition terminal failure'));
});

test('runtime removes a file created before cancellation and joins the real remove outcome', OPTIONS, async () => {
	const fixture = new WriterAcquisitionFixture(), { worker, client } = fixture.client(); fixture.seed('prior.blob', PRIOR); fixture.arm('file');
	assert.equal(await client.initialize(fixture.directory as unknown as FileSystemDirectoryHandle), true);
	const work = observed(worker.runtime.handle({ id: 'direct-open', type: 'open-writer', operationId: 'media-asset-chunk-write', path: 'new.blob' }));
	try {
		await entered(fixture.entered.promise, work, 'created-file hold');
		await worker.runtime.handle({ id: 'direct-open', type: 'cancel' }); fixture.release.resolve();
		await entered(fixture.removalEntered.promise, work, 'post-creation cancellation cleanup');
		await settle(3); assert.equal(await remainsPending(work), true); assert.equal(fixture.file().calls.includes('access'), false);
		fixture.removalRelease.resolve(); const result = await work;
		assert.equal(result.ok, false); if (!result.ok) assert.ok(result.error instanceof Error && result.error.name === 'AbortError');
		assert.equal(fixture.files.has('new.blob'), false); unchanged(fixture);
	} finally { fixture.releaseAll(); await work; client.close(); await fixture.dispose(); }
});

test('actual runtime acquisition failure retains its exact primary and distinct failed cleanup', OPTIONS, async () => {
	const fixture = new WriterAcquisitionFixture(), { worker, client } = fixture.client(), primary = new Error('controlled access refusal'), cleanup = new Error('controlled removal refusal');
	fixture.arm('access'); fixture.acquisitionFailure = primary; fixture.removeFailure = cleanup;
	assert.equal(await client.initialize(fixture.directory as unknown as FileSystemDirectoryHandle), true);
	const work = observed(worker.runtime.handle({ id: 'direct-error', type: 'open-writer', operationId: 'media-asset-chunk-write', path: 'new.blob' }));
	try {
		await entered(fixture.entered.promise, work, 'actual error-terminal acquisition'); fixture.release.resolve();
		await entered(fixture.removalEntered.promise, work, 'failed acquisition cleanup'); await settle(3); assert.equal(await remainsPending(work), true);
		fixture.removalRelease.resolve(); const result = await work; assert.equal(result.ok, false);
		if (!result.ok) { assert.ok(result.error instanceof AggregateError); assert.equal(result.error.cause, primary); assert.deepEqual(result.error.errors, [primary, cleanup]); }
		assert.equal(fixture.files.has('new.blob'), true); assert.equal(fixture.file().calls.includes('truncate'), false);
	} finally { fixture.releaseAll(); await work; client.close(); await fixture.dispose(); }
});

test('late successful acquisition preserves local opaque cancellation alongside decoded cleanup refusal', OPTIONS, async () => {
	const fixture = new WriterAcquisitionFixture(), { client, worker } = fixture.client(), caller = new AbortController();
	const revoked = Proxy.revocable({}, {}); revoked.revoke(); const reason: unknown = revoked.proxy;
	fixture.arm('open-result'); fixture.removeFailure = new Error('controlled removal remains refused');
	assert.equal(await client.initialize(fixture.directory as unknown as FileSystemDirectoryHandle), true);
	const work = observed(client.openWriter('media-asset-chunk-write', 'new.blob', caller.signal));
	try {
		await entered(fixture.entered.promise, work, 'real successful result delivery'); caller.abort(reason);
		await settle(3); assert.equal(await remainsPending(work), true); fixture.release.resolve();
		await entered(fixture.removalEntered.promise, work, 'real abort/remove refusal');
		await settle(3); assert.equal(await remainsPending(work), true); fixture.removalRelease.resolve();
		const result = await work; assert.equal(result.ok, false);
		if (!result.ok) { assert.ok(result.error instanceof AggregateError); assert.equal(Object.is(result.error.cause, reason), true);
			assert.equal(result.error.errors.some((value: unknown) => Object.is(value, reason)), true);
			assert.equal(result.error.errors.some((value: unknown) => !Object.is(value, reason) && value instanceof Error && /controlled removal remains refused/u.test(value.message)), true); }
		await worker.drain(); assert.equal(fixture.file().calls.filter(value => value === 'close').length, 1);
		assert.equal(fixture.files.has('new.blob'), true, 'A failed real removal cannot be claimed successful.');
	} finally { fixture.releaseAll(); await work; client.close(); await fixture.dispose(); }
});

test('a genuinely completed close races cancellation and abort joins the real removed:false fallback', OPTIONS, async () => {
	const fixture = new WriterAcquisitionFixture(), { client, worker } = fixture.client(), caller = new AbortController();
	assert.equal(await client.initialize(fixture.directory as unknown as FileSystemDirectoryHandle), true);
	const writer = await client.openWriter('media-asset-chunk-write', 'new.blob'); fixture.arm('close-result'); fixture.path = 'new.blob';
	const closing = observed(writer.close(caller.signal)); let aborting: ReturnType<typeof observed<void>> | undefined;
	try {
		await entered(fixture.entered.promise, closing, 'real completed close delivery'); caller.abort(new Error('cancel close'));
		assert.equal((await closing).ok, false); fixture.release.resolve(); await worker.drain();
		aborting = observed(writer.abort()); await entered(fixture.removalEntered.promise, aborting, 'real removed:false fallback');
		await settle(3); assert.equal(await remainsPending(aborting), true); fixture.removalRelease.resolve(); assert.equal((await aborting).ok, true);
		await worker.drain(); assert.deepEqual(worker.requests.slice(-2).map(value => value.type), ['abort-writer', 'remove']);
		assert.equal(fixture.files.has('new.blob'), false); assert.equal(fixture.file().calls.filter(value => value === 'close').length, 1);
	} finally { fixture.releaseAll(); await closing; if (aborting) await aborting; client.close(); await fixture.dispose(); }
});

test('native pre-abort refuses acquisition without posting or reflecting the opaque reason', OPTIONS, async () => {
	const fixture = new WriterAcquisitionFixture(), { client, worker } = fixture.client(), caller = new AbortController();
	let reflected = 0; const reason = new Proxy({}, { get() { reflected++; throw new Error('reason get'); }, getPrototypeOf() { reflected++; throw new Error('reason prototype'); } });
	assert.equal(await client.initialize(fixture.directory as unknown as FileSystemDirectoryHandle), true); const count = worker.requests.length; caller.abort(reason);
	try {
		const result = await observed(client.openWriter('media-asset-chunk-write', 'new.blob', caller.signal));
		assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, reason), true);
		assert.equal(worker.requests.length, count); assert.equal(fixture.files.size, 0); assert.equal(reflected, 0);
	} finally { client.close(); await fixture.dispose(); }
});

for (const terminal of ['worker-fault', 'client-close'] as const) test(`cancelled acquisition retires private waiting on explicit ${terminal} without claiming cleanup`, OPTIONS, async () => {
	const fixture = new WriterAcquisitionFixture(), { client, worker } = fixture.client(), caller = new AbortController();
	fixture.arm('access'); assert.equal(await client.initialize(fixture.directory as unknown as FileSystemDirectoryHandle), true);
	const work = observed(client.openWriter('media-asset-chunk-write', 'new.blob', caller.signal));
	try {
		await entered(fixture.entered.promise, work, 'controlled native acquisition'); caller.abort(Symbol('first cancellation'));
		await settle(3); assert.equal(await remainsPending(work), true);
		if (terminal === 'worker-fault') worker.fail(new Error('controlled worker transport failed')); else client.close();
		const result = await work; assert.equal(result.ok, false);
		if (!result.ok) { assert.ok(result.error instanceof Error); assert.match(result.error.message, /worker|closed|terminat/iu); }
		assert.equal(worker.terminated, 1); assert.equal(client.isAvailable(), false);
		assert.equal(fixture.files.has('new.blob'), true, 'Transport termination cannot establish a native removal ACK.');
		assert.equal(fixture.file().calls.includes('truncate'), false); assert.equal(fixture.events.some(value => value.startsWith('remove-ack:')), false);
		await assert.rejects(client.openWriter('media-asset-chunk-write', 'another.blob'), /unavailable/u);
	} finally { fixture.releaseAll(); await work; client.close(); await fixture.dispose(); }
});

test('fresh default runtime3 public import Close drains actual repository worker acquisition and preserves its prior original', OPTIONS, async () => {
	const fixture = new WriterAcquisitionFixture(), native = mediaRestoreFixture(), locks = controlledLocks(), reset = installAcquisitionPlatform(fixture, locks);
	const options = { name: 'Acquisition Close', indexedDB: native.factory, locks };
	let session: Awaited<ReturnType<typeof createPhotoLibrarySessionV3>> | undefined;
	let importing: ReturnType<typeof observed<readonly PhotoLibraryImportItemV1[]>> | undefined;
	let closing: Promise<void> | undefined;
	const descriptors: Array<readonly [object, string, PropertyDescriptor]> = [];
	try {
		assert.notEqual(sha(PNG), sha(OTHER_PNG)); const setup = await createPhotoLibrarySessionV3(options);
		try { assert.equal((await setup.readPage()).totalCount, 0);
			assert.equal((await setup.importFiles([new File([PNG], 'prior.png', { type: 'image/png', lastModified: 0 })]))[0]?.status, 'imported');
		} finally { await setup.close(); }
		const priorPhotos = native.raw(CATALOG).records(CATALOG, 'photos') as unknown[];
		assert.equal(priorPhotos.length, 1); const prior = readStoredPhotoV1OrV2(priorPhotos[0]);
		const priorRecords = native.raw(MEDIA.databaseName).records(MEDIA.databaseName, 'mediaAssets') as Array<Record<string, unknown>>;
		assert.equal(priorRecords.length, 1); const record = priorRecords[0]!; assert.equal(record.storage, 'opfs'); assert.equal(typeof record.path, 'string');
		const priorPath = record.path as string; assert.equal(sha(fixture.files.get(priorPath)!.bytes), sha(PNG));
		const priorRoots = native.raw(MEDIA.databaseName).records(MEDIA.databaseName, 'catalogOriginalRoots') as unknown[];
		let mediaCloses = 0, catalogCloses = 0;
		for (const [owner, key, increment] of [[PhotoMediaStoreV1.prototype, 'close', () => { mediaCloses++; }],
			[PhotoCatalogRepositoryV2.prototype, 'close', () => { catalogCloses++; }]] as const) {
			const descriptor = Object.getOwnPropertyDescriptor(owner, key); assert.ok(descriptor); const method = descriptor.value as () => Promise<void>;
			descriptors.push([owner, key, descriptor]); Object.defineProperty(owner, key, { ...descriptor, value: function(this: object) { increment(); return Reflect.apply(method, this, []) as Promise<void>; } });
		}
		session = await createPhotoLibrarySessionV3(options); assert.equal((await session.readPage()).totalCount, 1); mediaCloses = 0; catalogCloses = 0;
		const beforeTerminations = fixture.workers.reduce((sum, worker) => sum + worker.terminated, 0);
		fixture.arm('access'); const caller = new AbortController(), reason = Symbol('actual public import first cancellation');
		importing = observed(session.importFiles([new File([OTHER_PNG], 'new.png', { type: 'image/png', lastModified: 0 })], { signal: caller.signal }));
		await entered(fixture.entered.promise, importing, 'actual public import acquisition'); caller.abort(reason); closing = session.close(); assert.equal(session.close(), closing);
		await assert.rejects(session.readPage(), /closed/u); await pending(importing, closing, () => mediaCloses + catalogCloses);
		assert.equal(fixture.workers.reduce((sum, worker) => sum + worker.terminated, 0), beforeTerminations);
		assert.equal(fixture.events.some(value => value === `remove-enter:${fixture.path}`), false, 'Repository reclaimed before its worker acquisition terminal.');
		assert.equal(fixture.file().calls.includes('truncate'), false); assert.equal(fixture.file().calls.includes('write'), false);
		fixture.release.resolve(); await entered(fixture.removalEntered.promise, importing, 'actual repository reclamation'); await pending(importing, closing, () => mediaCloses + catalogCloses);
		fixture.removalRelease.resolve(); const result = await importing; await closing;
		assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, reason), true);
		assert.equal(mediaCloses, 1); assert.equal(catalogCloses, 1); assert.equal(fixture.file().calls.filter(value => value === 'close').length, 1);
		assert.equal(fixture.file().calls.includes('truncate'), false); assert.equal(fixture.file().calls.includes('write'), false);
		assert.ok(fixture.path); assert.equal(fixture.files.has(fixture.path), false); assert.equal(fixture.files.size, 1); assert.deepEqual(fixture.files.get(priorPath)?.bytes, PNG);
		for (const [owner, key, descriptor] of descriptors.splice(0).reverse()) Object.defineProperty(owner, key, descriptor);
		for (let reopen = 0; reopen < 2; reopen++) {
			const reopened = await createPhotoLibrarySessionV3(options);
			try { assert.equal((await reopened.readPage()).totalCount, 1); } finally { await reopened.close(); }
			assert.deepEqual(native.raw(CATALOG).records(CATALOG, 'photos'), priorPhotos);
			assert.deepEqual(native.raw(MEDIA.databaseName).records(MEDIA.databaseName, 'mediaAssets'), priorRecords);
			assert.deepEqual(native.raw(MEDIA.databaseName).records(MEDIA.databaseName, 'catalogOriginalRoots'), priorRoots);
			assert.deepEqual(fixture.files.get(priorPath)?.bytes, PNG); assert.equal(record.sourceId, prior.original.storageKey);
		}
	} finally {
		fixture.releaseAll(); if (importing) await importing; if (session) await observed(closing ?? session.close());
		for (const [owner, key, descriptor] of descriptors.reverse()) Object.defineProperty(owner, key, descriptor);
		try { await fixture.dispose(); } finally { reset(); }
	}
});
