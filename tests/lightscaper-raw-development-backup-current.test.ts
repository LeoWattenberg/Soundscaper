/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { recoveryRasterFixture, recoveryRecipe } from './helpers/lightscaper-raw-development-raster-export-fixture.ts';
import { readRepairBackupArchive } from './helpers/lightscaper-repair-backup-current-fixture.ts';
import { brushSettingsRecipe, CURRENT_SETTINGS_SELECTION, SETTINGS_TIME } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { LUT_BODY } from './helpers/lightscaper-lut-archive-fixture.ts';
import { mediaRestoreRoot } from './helpers/lightscaper-media-restore-fixture.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizePhotoDevelopPresetRowCurrentV1 } from '../src/lightscaper/storage/photo-develop-preset-row-current-v1.ts';
import { photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { createPhotoLibraryRestoreRuntimeCurrentV1 } from '../src/lightscaper/photo-library-restore-runtime-current-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { normalizePhotoCatalogArchiveV7 } from '../src/lightscaper/archive/catalog-archive-contract-v7.ts';
import { exportPhotoCatalogArchiveV7 } from '../src/lightscaper/archive/catalog-archive-export-v7.ts';
import type { BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import type { PhotoOriginalV1 } from '../src/lightscaper/catalog/types.ts';
import { MEDIA_ASSET_CHUNK_STORAGE_TYPE, MEDIA_ASSET_STREAM_CHUNK_BYTES } from '../src/common/editor/storage/media-asset-chunk-schema.ts';

type Fixture = Awaited<ReturnType<typeof recoveryRasterFixture>>;
type Session = Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>>;
type Location = Awaited<ReturnType<typeof readPhotoLibrarySessionLocationV2>>['location'];
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const OPTIONS = { timeout: 120_000 };

async function selectedLocation(f: Fixture): Promise<Location> {
	const anchor = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, preferOpfs: false });
	try {
		await anchor.ready();
		return (await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw new Error('Backup observation cannot initialize another library.'); } })).location;
	} finally { await anchor.close(); }
}

/** Real catalog/media owners authenticate every Original and retained body.
 * The native rows are inspected only after those bounded borrows have joined. */
async function inspect(f: Fixture, location: Location, ids: readonly string[],
	brushes: readonly Readonly<BrushMaskResourceReferenceV1>[], lut: Readonly<VideoCubeLutReferenceV1>) {
	const media = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks,
		databaseName: location.mediaDatabaseName, preferOpfs: false });
	const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.native.factory, databaseName: location.catalogDatabaseName,
		verifyOriginal: media.verifyOriginal });
	try {
		await media.ready(); const root = await catalog.loadCatalog(location.catalogId); assert.ok(root);
		const photos = [], originals: { original: PhotoOriginalV1; bytes: Uint8Array<ArrayBuffer> }[] = [];
		for (const id of ids) {
			const photo = await catalog.loadPhoto(location.catalogId, id); assert.ok(photo); photos.push(photo);
			await media.verifyOriginal(photo.original);
			const body = await media.mediaRepository.loadAsset(photo.original.storageKey); assert.ok(body instanceof Blob);
			const bytes = new Uint8Array(await body.arrayBuffer()); assert.equal(sha(bytes), photo.original.contentSha256);
			originals.push({ original: photo.original, bytes });
		}
		const masks = await media.getMaskRasterResources(), luts = await media.getCubeLutResources(), borrowed: Uint8Array<ArrayBuffer>[] = [];
		const bodies = [];
		for (const reference of brushes) bodies.push(await masks.source.withBytes(reference, bytes => {
			borrowed.push(bytes); return { reference, bytes: new Uint8Array(bytes) };
		}));
		bodies.push(await luts.source.withBytes(lut, bytes => { borrowed.push(bytes); return { reference: lut, bytes: new Uint8Array(bytes) }; }));
		assert.ok(borrowed.every(bytes => bytes.every(value => value === 0)));
		const row = normalizePhotoDevelopPresetRowCurrentV1(await media.settingsRepository.get(photoDevelopPresetsKeyV1(location.catalogId)), location.catalogId);
		const native = f.native.raw(location.mediaDatabaseName), keys = new Set(originals.map(value => value.original.storageKey));
		const assets = (native.records(location.mediaDatabaseName, 'mediaAssets') as Record<string, unknown>[]).filter(value => keys.has(value.sourceId as string)).map(value => {
			const { blob, ...metadata } = value, original = originals.find(row => row.original.storageKey === metadata.sourceId)!.original;
			assert.equal(typeof metadata.mediaContentToken, 'string'); assert.equal(metadata.size, original.byteLength);
			assert.equal(metadata.sha256, original.contentSha256); assert.equal(metadata.mimeType, original.mimeType);
			if (blob instanceof Blob) { assert.equal(blob.size, original.byteLength); return { metadata, blob: { size: blob.size, type: blob.type }, chunks: [] }; }
			assert.equal(blob, undefined); assert.equal(metadata.storage, MEDIA_ASSET_CHUNK_STORAGE_TYPE);
			assert.equal(typeof metadata.mediaChunkToken, 'string'); assert.equal(metadata.mediaChunkBytes, MEDIA_ASSET_STREAM_CHUNK_BYTES);
			assert.equal(metadata.mediaChunkCount, Math.ceil(original.byteLength / MEDIA_ASSET_STREAM_CHUNK_BYTES));
			const chunks = (native.records(location.mediaDatabaseName, 'mediaAssetChunks') as Record<string, unknown>[]).filter(row => row.mediaChunkToken === metadata.mediaChunkToken);
			assert.equal(chunks.length, metadata.mediaChunkCount); assert.equal(chunks.reduce((sum, row) => sum + Number(row.byteLength), 0), original.byteLength);
			return { metadata, blob: null, chunks };
		});
		const roots = (native.records(location.mediaDatabaseName, 'catalogOriginalRoots') as Record<string, unknown>[]).filter(value => ids.includes(value.photoId as string));
		assert.equal(assets.length, ids.length); assert.equal(roots.length, ids.length); assert.ok(roots.every(value => value.importId === null));
		return { root, photos, originals, bodies, row, assets, roots };
	} finally { await Promise.all([catalog.close(), media.close()]); }
}

async function nativeFrames(session: Session, photoId: string) {
	const saved = await session.develop.read({ schemaVersion: 3, photoId }), original = session.develop.original;
	assert.ok(original?.withDerivedFrame); assert.equal(saved.develop.processVersion, 4);
	const bound = { schemaVersion: 1 as const, photoId, expectedRevision: saved.revision };
	const words = await original.withFrame(bound, view => { assert.equal(view.frame.descriptor.sampleFormat, 'unorm16'); return Array.from(view.frame.pixels); });
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1({ source: session.cubeLuts.source, maskSource: session.maskRasterSource });
	const borrowed: ArrayBuffer[] = [];
	const developed = await original.withDerivedFrame({ ...bound, profile: 'highlight-recovery-v1' }, view => {
		assert.equal(view.frame.descriptor.sampleFormat, 'float32'); borrowed.push(view.frame.pixels.buffer);
		return runtime.withFullResolution({ frame: view.frame, develop: saved.develop, signal: new AbortController().signal }, output => {
			assert.equal(output.frame.descriptor.sampleFormat, 'float32'); borrowed.push(output.frame.pixels.buffer);
			return { descriptor: output.frame.descriptor, pixels: Array.from(output.frame.pixels), histogram: output.histogram };
		});
	});
	assert.ok(borrowed.every(buffer => new Uint8Array(buffer).every(value => value === 0)));
	assert.ok(developed.pixels.some((value, index) => index % 4 !== 3 && value > 1), 'Native recovery remains HDR through full Develop.');
	return { saved, words, developed };
}

test('actual RAW4 and native Row4 backup inspect, restore and reopen retain full history, native Float32, Original custody and resource closure', OPTIONS, async () => {
	const f = await recoveryRasterFixture(); let restored: Session | undefined;
	const runtime = createPhotoLibraryRestoreRuntimeCurrentV1({ name: 'Recovered RAW backup', indexedDB: f.native.factory, locks: f.options.locks });
	try {
		const brush = (await f.installBrush([0, 96, 255])).reference, unused = (await f.installBrush([255, 128, 31])).reference;
		const lut = (await f.session.cubeLuts.importFile(new Blob([new Uint8Array(LUT_BODY)]))).reference;
		const graph = brushSettingsRecipe(brush).masks[0]!, base = recoveryRecipe();
		const recipe = normalizeImageDevelopStateV4({ ...base, effects: [{ ...base.effects[0]!, params: { exposure: -.25 } },
			{ id: 'retained-disabled-lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut } }], masks: [graph],
			repairs: { schemaVersion: 1, spots: [{ id: 'backup-clone', mode: 'clone', enabled: true, target: { x: .75, y: .5 },
				source: { x: .25, y: .5 }, radius: .025, feather: 0, opacity: 1 }] } });
		let saved = await f.session.develop.read({ schemaVersion: 3, photoId: f.saved.photoId });
		saved = (await f.session.develop.apply({ schemaVersion: 3, photoId: saved.photoId, expectedRevision: saved.revision,
			command: { type: 'record-develop', versionId: saved.versionId, develop: recipe, label: 'RAW backup recipe', createdAt: SETTINGS_TIME } })).snapshot;
		saved = (await f.session.develop.apply({ schemaVersion: 3, photoId: saved.photoId, expectedRevision: saved.revision,
			command: { type: 'save-develop-snapshot', versionId: saved.versionId, id: 'recovered', name: 'Recovered RAW', createdAt: SETTINGS_TIME } })).snapshot;
		const settings = f.session.develop.settingsCurrent, presets = f.session.develop.presetsCurrent; assert.ok(settings); assert.ok(presets);
		const presetDraft = normalizeImageDevelopStateV4({ ...recipe, masks: [{ ...graph,
			inputs: [...graph.inputs, { name: 'unused-preset-only', kind: 'alpha', sourceRef: unused.storageKey }] }] });
		const packet = await settings.copySelected({ schemaVersion: 3, catalogId: saved.catalogId, photoId: saved.photoId,
			versionId: saved.versionId, revision: saved.revision, develop: presetDraft, selection: CURRENT_SETTINGS_SELECTION });
		assert.equal(packet.schemaVersion, 4);
		const preset = presets.create({ schemaVersion: 3, id: 'recovered-preset', name: 'Recovered RAW with retained paint', settings: packet });
		assert.equal(preset.schemaVersion, 4);
		await presets.write({ schemaVersion: 3, catalogId: saved.catalogId, command: { type: 'save', expectedRevision: 0, preset } });
		const ids = [f.photos[0]!.id, saved.photoId], oldLocation = await selectedLocation(f);
		const before = await inspect(f, oldLocation, ids, [brush, unused], lut), expectedFrames = await nativeFrames(f.session, saved.photoId);
		assert.equal(before.row.schemaVersion, 4); assert.deepEqual(before.row.presets, [preset]);
		const result = await f.session.backupCatalog(); assert.ok(result.blob); assert.equal(result.byteLength, result.blob.size); assert.ok(result.byteLength < 4 * 1024 * 1024);
		const inspected = await readRepairBackupArchive(result.blob); assert.equal(inspected.document.schemaVersion, 8);
		const header = inspected.document.developPresetPack as { entry: string; rowSchemaVersion: number; revision: number; presetCount: number };
		assert.equal(header.entry, 'assets/develop-presets-v4.bin'); assert.equal(header.rowSchemaVersion, 4); assert.equal(header.revision, 1); assert.equal(header.presetCount, 1);
		const rowBytes = inspected.entries.get(header.entry); assert.ok(rowBytes);
		assert.deepEqual(JSON.parse(new TextDecoder().decode(rowBytes)) as unknown, before.row);
		assert.equal((inspected.document.maskRasters as readonly unknown[]).length, 2); assert.equal((inspected.document.lutResources as readonly unknown[]).length, 1);
		assert.throws(() => normalizePhotoCatalogArchiveV7({ ...inspected.document, schemaVersion: 7,
			developPresetPack: { ...header, entry: 'assets/develop-presets-v3.bin' } }), /preset|row|version/iu);
		assert.deepEqual(await inspect(f, oldLocation, ids, [brush, unused], lut), before);
		await f.session.close();
		const receipt = await runtime.restoreArchive(result.blob); assert.equal(receipt.photoCount, 2); assert.equal(receipt.originalCount, 2);
		assert.equal(receipt.originalByteLength, before.originals.reduce((sum, value) => sum + value.bytes.length, 0)); assert.deepEqual(receipt.notices, []);
		const newLocation = await selectedLocation(f); assert.notEqual(newLocation.mediaDatabaseName, oldLocation.mediaDatabaseName);
		assert.notEqual(newLocation.catalogDatabaseName, oldLocation.catalogDatabaseName);
		const after = await inspect(f, newLocation, ids, [brush, unused], lut);
		assert.deepEqual(after.root, before.root); assert.deepEqual(after.photos, before.photos); assert.deepEqual(after.originals, before.originals);
		assert.deepEqual(after.bodies, before.bodies); assert.deepEqual(after.row, before.row);
		assert.deepEqual(await inspect(f, oldLocation, ids, [brush, unused], lut), before, 'Restore preserves the old native namespaces and content tokens.');
		restored = await createPhotoLibrarySessionCurrentV1(f.options); assert.equal((await restored.readPage()).totalCount, 2);
		assert.deepEqual(await nativeFrames(restored, saved.photoId), expectedFrames);
		assert.equal(f.canonical.active(), 0); assert.equal(f.recovery.active(), 0);
		await restored.close(); restored = await createPhotoLibrarySessionCurrentV1(f.options);
		assert.deepEqual(await restored.develop.read({ schemaVersion: 3, photoId: saved.photoId }), expectedFrames.saved);
		const current = restored.develop.presetsCurrent; assert.ok(current);
		assert.deepEqual((await current.read({ schemaVersion: 3, catalogId: saved.catalogId, presetId: preset.identity.id, expectedRevision: 1 })).preset, preset);
		assert.deepEqual(await inspect(f, newLocation, ids, [brush, unused], lut), after);
	} finally { try { await Promise.all([restored?.close(), runtime.close()]); } finally { await f.close(); } }
});

test('RAW4 retained only in history selects Archive8 while permanent Archive7 refuses the whole Photo before Original bytes', OPTIONS, async () => {
	const f = await recoveryRasterFixture(), location = await selectedLocation(f);
	const media = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, databaseName: location.mediaDatabaseName, preferOpfs: false });
	const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.native.factory, databaseName: location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
	try {
		const saved = await f.session.develop.read({ schemaVersion: 3, photoId: f.saved.photoId });
		await f.session.develop.apply({ schemaVersion: 3, photoId: saved.photoId, expectedRevision: saved.revision, command: {
			type: 'record-develop', versionId: saved.versionId, develop: defaultImageDevelopStateV2(), label: 'Legacy active recipe', createdAt: SETTINGS_TIME } });
		const photo = await catalog.loadPhoto(location.catalogId, saved.photoId), root = await catalog.loadCatalog(location.catalogId); assert.ok(photo); assert.ok(root);
		const selected = photo.versions.find(version => version.id === photo.activeVersionId)!;
		assert.equal(selected.develop.processVersion, 2); assert.equal(selected.workspace?.schemaVersion, 4);
		assert.ok(selected.workspace?.entries.some(entry => entry.develop.processVersion === 4));
		const backup = await f.session.backupCatalog(); assert.ok(backup.blob);
		assert.equal((await readRepairBackupArchive(backup.blob)).document.schemaVersion, 8);
		await assert.rejects(Reflect.apply(exportPhotoCatalogArchiveV7, undefined, [{ ...root, photoCount: 1 },
			[{ photo, original: new Blob([f.raw]) }], [], null, [], null, undefined, undefined]) as Promise<unknown>, versionRefusal);
		assert.deepEqual(await catalog.loadPhoto(location.catalogId, saved.photoId), photo);
	} finally { try { await Promise.all([catalog.close(), media.close()]); } finally { await f.close(); } }
});

function versionRefusal(error: unknown): boolean {
	if (error instanceof RangeError || error instanceof TypeError) return /preset|row|version|process|workspace/iu.test(error.message);
	return error instanceof AggregateError && error.errors.some((reason: unknown) => versionRefusal(reason));
}

test('permanent Archive7 export rejects an explicit empty Row4 before opening a destination', async () => {
	let destinations = 0;
	const row = normalizePhotoDevelopPresetRowCurrentV1({ schemaVersion: 4, kind: 'photo-develop-presets', catalogId: 'catalog-1', revision: 1, presets: [] }, 'catalog-1');
	await assert.rejects(exportPhotoCatalogArchiveV7(mediaRestoreRoot(0), [], [], null, [], row, undefined, undefined,
		{ writable: new WritableStream<Uint8Array>({ write() { destinations++; } }) }), versionRefusal);
	assert.equal(destinations, 0);
});
