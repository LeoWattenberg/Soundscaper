/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { repairPresetsFixture } from './helpers/lightscaper-repair-presets-current-fixture.ts';
import { brushSettingsRecipe } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { rawRecoveryDngFixtureV1 } from './helpers/lightscaper-raw-recovery-dng-current-fixture.ts';
import { rawWorkerFixtureV1 } from './helpers/lightscaper-raw-worker-current-fixture.ts';
import { rawRecoveryWorkerFixtureV2 } from './helpers/lightscaper-raw-recovery-worker-current-fixture.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { copyImageDevelopSelectedSettingsV3, mergeImageDevelopSelectedSettingsV3 } from '../src/common/editor/imaging/image-develop-settings-selected-v3.ts';
import { readPhotoDevelopPresetForProfileV1 } from '../src/lightscaper/storage/internal/photo-develop-presets-kernel-v1.ts';
import type { PhotoLibraryDevelopImportRequestCurrentV1 } from '../src/common/editor/photo-library-develop-import-port-current-v1.ts';
import type { PhotoLibraryImportItemV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Fixture = Awaited<ReturnType<typeof repairPresetsFixture>>;
const OPTIONS = { concurrency: false, timeout: 30_000 };
const FULL = Object.freeze({ effectTypes: 'all' as const, geometry: true, localAdjustments: true, repairs: true, rawDevelopment: true });
const FILE_BYTES = rawRecoveryDngFixtureV1({ orientation: 6 }).bytes;
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function files(count = 1) { return Array.from({ length: count }, (_, index) => new File([FILE_BYTES], `Recovery ${String(index + 1)}.DNG`, { type: 'image/png', lastModified: 0 })); }
function choice(f: Fixture, revision = 1, id = 'raw-recovery'): PhotoLibraryDevelopImportRequestCurrentV1 {
	return { schemaVersion: 3, developPreset: { schemaVersion: 3, catalogId: f.root.id, presetId: id, expectedRevision: revision } };
}
function importer(f: Fixture) { const value = f.session.developImportCurrent; assert.ok(value); return value; }
function observed<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }

async function savePreset(f: Fixture, brush = false) {
	const retained = brush ? await f.installBrush() : undefined;
	const base = retained ? brushSettingsRecipe(retained.reference) : f.source().develop;
	assert.equal(base.processVersion, 3);
	const draft = normalizeImageDevelopStateV4({ ...base, processVersion: 4, rawDevelopment: { schemaVersion: 1, mode: 'recovery' } });
	const photo = f.photos[0]!, settings = f.session.develop.settingsCurrent, presets = f.session.develop.presetsCurrent; assert.ok(settings && presets);
	const packet = await settings.copySelected({ schemaVersion: 3, catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId,
		revision: photo.revision, develop: draft, selection: FULL });
	assert.equal(packet.schemaVersion, 4);
	const preset = presets.create({ schemaVersion: 3, id: 'raw-recovery', name: 'Recover highlights', settings: packet });
	const ack = await presets.write({ schemaVersion: 3, catalogId: f.root.id, command: { type: 'save', expectedRevision: 0, preset } });
	return { draft, retained, packet, preset, ack };
}

/** Existing selected native catalog/media owners and actual production workers.
 * Only browser transport and pinned external fetches are adapted for Node. */
async function withNative<Result>(run: (f: Fixture, workers: Readonly<{ canonical: Awaited<ReturnType<typeof rawWorkerFixtureV1>>; recovery: Awaited<ReturnType<typeof rawRecoveryWorkerFixtureV2>> }>) => Promise<Result>): Promise<Result> {
	const f = await repairPresetsFixture(1), canonical = await rawWorkerFixtureV1(), recovery = await rawRecoveryWorkerFixtureV2();
	const keys = ['Worker', 'fetch'] as const, previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, 'Worker', { configurable: true, value: function (_url: URL, options: WorkerOptions) {
		if (options.name === 'lightscaper-libraw-recovery') return recovery.createWorker(); assert.equal(options.name, 'lightscaper-libraw'); return canonical.createWorker();
	} });
	Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: unknown) => {
		const path = url === 'https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm' ? new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url)
			: url === 'https://assets.soundscaper.org/runtime/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm'
				? process.env.LIGHTSCAPER_RECOVERY_WASM ?? new URL('../runtime-assets/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm', import.meta.url) : null;
		assert.ok(path); return new Response(new Uint8Array(await readFile(path)));
	} });
	let outcome: { value: Result } | { error: unknown };
	try { outcome = { value: await run(f, { canonical, recovery }) }; } catch (error) { outcome = { error }; }
	const failures = 'error' in outcome ? [outcome.error] : [];
	for (const result of await Promise.allSettled([f.close(), canonical.close(), recovery.close()])) if (result.status === 'rejected') failures.push(result.reason as unknown);
	for (const [index, key] of keys.entries()) { const descriptor = previous[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
	if (failures.length === 1) throw failures[0]; if (failures.length > 1) throw new AggregateError(failures, 'RAW import fixture and retirement failed.', { cause: failures[0] });
	if ('value' in outcome) return outcome.value; throw new Error('RAW import fixture has no result.');
}

async function inspect(f: Fixture, photoId: string) {
	const anchor = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, preferOpfs: false });
	let media: PhotoMediaStoreV1 | undefined, catalog: PhotoCatalogRepositoryCurrentV1 | undefined;
	try {
		await anchor.ready(); const { location } = await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw new Error('RAW import observation cannot allocate another namespace.'); } });
		media = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, databaseName: location.mediaDatabaseName, preferOpfs: false });
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.native.factory, databaseName: location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
		const photo = await catalog.loadPhoto(f.root.id, photoId); assert.ok(photo); await media.verifyOriginal(photo.original);
		const body = await media.mediaRepository.loadAsset(photo.original.storageKey); assert.ok(body instanceof Blob);
		const raw = f.native.raw(location.mediaDatabaseName), roots = (raw.records(location.mediaDatabaseName, 'catalogOriginalRoots') as Record<string, unknown>[]).filter(row => row.photoId === photoId);
		const assets = (raw.records(location.mediaDatabaseName, 'mediaAssets') as Record<string, unknown>[]).filter(row => row.sourceId === photo.original.storageKey).map(row => {
			const { blob, ...scalar } = row, mediaContentToken = row.mediaContentToken;
			assert.ok(typeof mediaContentToken === 'string' && mediaContentToken.length > 0, 'The real committed Original requires its native content token.');
			return { ...scalar, mediaContentToken, ...(blob instanceof Blob ? { blob: { size: blob.size, type: blob.type } } : {}) };
		});
		return { photo, bytes: new Uint8Array(await body.arrayBuffer()), roots, assets };
	} finally { await Promise.all([catalog?.close(), media?.close(), anchor.close()]); }
}

test('Current import lists genuine Preset4, then actual RAW preparation publishes exact process4/history4 with durable ACK and Original custody', OPTIONS, async () => {
	await withNative(async (f, workers) => {
		const saved = await savePreset(f, true), before = await f.inspect(), row = await f.row(), cap = importer(f), acknowledged: PhotoLibraryImportItemV1[] = [];
		const menu = await cap.listPresets(); assert.equal(menu.schemaVersion, 3); assert.equal(menu.revision, 1);
		assert.deepEqual(menu.presets.map(value => value.id), [saved.preset.identity.id]); assert.ok(menu.presets.every(value => !Object.hasOwn(value, 'settings')));
		const result = await cap.importFiles(files(), { ...choice(f), onAcknowledged: item => { acknowledged.push(item); } });
		assert.equal(result[0]?.status, 'imported'); assert.deepEqual(acknowledged, result); assert.ok(result[0]?.photoId);
		const retained = await inspect(f, result[0].photoId), active = retained.photo.versions.find(value => value.id === retained.photo.activeVersionId)!;
		assert.equal(retained.photo.schemaVersion, 3); assert.equal(retained.photo.revision, 0); assert.deepEqual(active.develop, saved.draft);
		assert.equal(active.workspace?.schemaVersion, 4); assert.equal(active.workspace?.cursor, 1); assert.equal(active.workspace?.entries.length, 2);
		assert.equal(active.workspace?.entries[0]?.develop.processVersion, 1); assert.deepEqual(active.workspace?.entries[1]?.develop, saved.draft);
		assert.deepEqual(retained.bytes, FILE_BYTES); assert.equal(retained.photo.original.contentSha256, digest(FILE_BYTES));
		assert.deepEqual([retained.photo.original.width, retained.photo.original.height, retained.photo.original.mimeType], [96, 128, 'image/x-adobe-dng']);
		assert.equal(retained.roots.length, 1); assert.equal(retained.roots[0]?.importId, null); assert.equal(retained.roots[0]?.sha256, digest(FILE_BYTES));
		assert.equal(retained.assets.length, 1); assert.equal(typeof retained.assets[0]?.mediaContentToken, 'string');
		assert.deepEqual(await f.inspect(), before); assert.deepEqual(await f.row(), row); assert.ok(f.borrowed.every(bytes => bytes.every(value => value === 0)));
		assert.equal(workers.canonical.active(), 0); assert.equal(workers.canonical.statistics.joined, 1);
		const original = f.session.develop.original; assert.ok(original?.withDerivedFrame);
		await original.withDerivedFrame({ schemaVersion: 1, photoId: retained.photo.id, expectedRevision: 0, profile: 'highlight-recovery-v1' }, view => {
			assert.equal(view.frame.descriptor.sampleFormat, 'float32'); assert.equal(view.rawFlip, 6); assert.ok(view.frame.pixels.some(value => value > 1));
		});
		assert.equal(workers.recovery.active(), 0); assert.equal(workers.recovery.statistics.joined, 1); assert.deepEqual(await inspect(f, retained.photo.id), retained);
		const reopened = await f.reopen(); try {
			assert.deepEqual((await reopened.develop.read({ schemaVersion: 3, photoId: retained.photo.id })).develop, saved.draft);
			assert.equal((await reopened.developImportCurrent!.listPresets()).revision, 1); assert.deepEqual(await inspect(f, retained.photo.id), retained);
		} finally { await reopened.close(); }
	});
});

test('Current import retains explicit Preset3 in a Row4 while fixed V3 and inherited V2 remain strict', OPTIONS, async () => {
	await withNative(async (f, workers) => {
		const saved = await savePreset(f), presets = f.session.develop.presetsCurrent; assert.ok(presets);
		const oldPacket = copyImageDevelopSelectedSettingsV3({ schemaVersion: 3, develop: f.source().develop,
			selection: { effectTypes: 'all', geometry: true, localAdjustments: true, repairs: true } });
		const old = presets.create({ schemaVersion: 3, id: 'old-three', name: 'Retained Preset3', settings: oldPacket }); assert.equal(old.schemaVersion, 3);
		await presets.write({ schemaVersion: 3, catalogId: f.root.id, command: { type: 'save', expectedRevision: 1, preset: old } });
		const row = await f.row(); assert.equal(Object.getOwnPropertyDescriptor(row as object, 'schemaVersion')?.value, 4);
		assert.deepEqual((await presets.read({ schemaVersion: 3, catalogId: f.root.id, presetId: old.identity.id, expectedRevision: 2 })).preset, old);
		await assert.rejects(readPhotoDevelopPresetForProfileV1('current3', f.settings, f.root.id, old.identity.id, 2));
		assert.throws(() => mergeImageDevelopSelectedSettingsV3({ schemaVersion: 3, target: f.source().develop, settings: saved.packet }));
		await assert.rejects(f.session.developImport.listPresets());
		await assert.rejects(f.session.developImport.importFiles(files(), { schemaVersion: 2,
			developPreset: { schemaVersion: 2, catalogId: f.root.id, presetId: saved.preset.identity.id, expectedRevision: 2 } }));
		assert.equal(workers.canonical.statistics.created, 0);
		const result = await importer(f).importFiles(files(), choice(f, 2, old.identity.id)); assert.equal(result[0]?.status, 'imported'); assert.ok(result[0]?.photoId);
		const retained = await inspect(f, result[0].photoId); assert.deepEqual(retained.photo.versions[0]?.develop, oldPacket.develop);
		assert.equal(retained.photo.versions[0]?.develop.processVersion, 3); assert.deepEqual(retained.bytes, FILE_BYTES); assert.deepEqual(await f.row(), row);
	});
});

test('Current preset4 row drift after the first genuine RAW publication ACK retains that receipt and refuses the next target', OPTIONS, async () => {
	await withNative(async f => {
		await savePreset(f); const before = await f.inspect(), descriptor = Object.getOwnPropertyDescriptor(PhotoCatalogRepositoryCurrentV1.prototype, 'publishPhotos');
		const publish = PhotoCatalogRepositoryCurrentV1.prototype.publishPhotos, acknowledged: PhotoLibraryImportItemV1[] = [];
		let changed = false, reopened: Awaited<ReturnType<Fixture['reopen']>> | undefined;
		Object.defineProperty(PhotoCatalogRepositoryCurrentV1.prototype, 'publishPhotos', { configurable: true, value: async function (this: PhotoCatalogRepositoryCurrentV1, ...args: Parameters<typeof publish>) {
			const result = await Reflect.apply(publish, this, args) as Awaited<ReturnType<typeof publish>>;
			if (args[0] === f.root.id && !changed) { changed = true; const row = await f.row() as Record<string, unknown>; await f.writeRow({ ...row, revision: 2 }); }
			return result;
		} });
		try {
			// The real composition must capture this transparent native observer.
			reopened = await f.reopen(); const cap = reopened.developImportCurrent; assert.ok(cap);
			const result = await cap.importFiles(files(2), { ...choice(f), onAcknowledged: item => { acknowledged.push(item); } });
			assert.equal(changed, true); assert.deepEqual(result.map(value => value.status), ['imported', 'failed']); assert.deepEqual(acknowledged, [result[0]]);
			assert.ok(result[0]?.photoId); assert.deepEqual((await inspect(f, result[0].photoId)).bytes, FILE_BYTES);
			assert.equal((await reopened.readPage()).totalCount, f.photos.length + 1); assert.deepEqual(await f.inspect(), before);
		} finally {
			if (descriptor) Object.defineProperty(PhotoCatalogRepositoryCurrentV1.prototype, 'publishPhotos', descriptor); else Reflect.deleteProperty(PhotoCatalogRepositoryCurrentV1.prototype, 'publishPhotos');
			await reopened?.close();
		}
	});
});

test('Current preset4 import cancellation joins genuine retained brush authentication before Close and never starts RAW preparation', OPTIONS, async () => {
	await withNative(async (f, workers) => {
		await savePreset(f, true); const before = await f.inspect(), row = await f.row(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
		const opaque = Proxy.revocable({}, {}); opaque.revoke(); f.borrowed.length = 0;
		f.hooks.borrowedBrush = async () => { entered.resolve(); await release.promise; };
		const work = observed(importer(f).importFiles(files(), { ...choice(f), signal: stop.signal })); let closing: Promise<void> | undefined;
		try {
			await Promise.race([entered.promise, work.then(result => { if (!result.ok) throw result.error; assert.fail('No native preset body was borrowed.'); })]);
			stop.abort(opaque.proxy); closing = f.session.close(); assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true);
			assert.ok(f.borrowed.some(bytes => bytes.some(value => value !== 0))); release.resolve();
			const result = await work; assert.ok(!result.ok); assert.ok(Object.is(result.error, opaque.proxy)); await closing;
			assert.equal(workers.canonical.statistics.created, 0); assert.ok(f.borrowed.every(bytes => bytes.every(value => value === 0)));
			assert.deepEqual(await f.inspect(), before); assert.deepEqual(await f.row(), row);
		} finally { release.resolve(); await work; await closing; }
	});
});
