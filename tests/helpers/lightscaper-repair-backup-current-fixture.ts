/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js/index-native.js';
import { PhotoLibrarySessionCurrentV1 } from '../../src/lightscaper/controller/photo-library-session-current-v1.ts';
import { PhotoLibrarySessionV2 } from '../../src/lightscaper/controller/photo-library-session-v2.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from '../../src/lightscaper/controller/photo-library-session-ports-current-v1.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoCatalogRepositoryV2 } from '../../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoDocumentV2 } from '../../src/lightscaper/catalog/photo-document-v2.ts';
import type { PhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { applyPhotoCommandCurrentV1 } from '../../src/lightscaper/controller/photo-commands-current-v1.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { verifyPhotoResourcesCurrentV1 } from '../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { photoDevelopPresetsKeyV1 } from '../../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { withPreparedBrushMaskResourceV1, type BrushMaskResourceReferenceV1 } from '../../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { CubeLutSourcePortV1 } from '../../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../../src/common/editor/video-color-cube-lut-v27.ts';
import type { MaskRasterSourcePortV1 } from '../../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import { normalizeImageDevelopStateCurrentV1, type ImageDevelopStateCurrentV1 } from '../../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../src/common/editor/imaging/image-develop-state-v2.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';
import { mediaRestoreFixture } from './lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './instrumented-indexeddb-keys.ts';
import { brushSettingsRecipe, FULL_SETTINGS_SELECTION, SETTINGS_TIME } from './lightscaper-repair-settings-current-fixture.ts';
import { pngBytes, ORIGINAL, repairRecipe } from './lightscaper-repair-raster-export-current-fixture.ts';
import { LUT_BODY, profile } from './lightscaper-masked-frame-fixture.ts';

export type RepairBackupPlacement = 'legacy' | 'active' | 'redo' | 'snapshot' | 'inactive';
export async function repairBackupCurrentFixture(placement: RepairBackupPlacement = 'active', count = 2) {
	const native = mediaRestoreFixture(), suffix = crypto.randomUUID();
	const mediaName = `lightscaper-repair-portable-media-${suffix}`, catalogName = `lightscaper-repair-portable-catalog-${suffix}`;
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
	Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
	const restore = () => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); };
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, databaseName: mediaName, locks: null, preferOpfs: false });
	const resourceHost = { cubeLutResources: () => media.getCubeLutResources(), maskRasterResources: () => media.getMaskRasterResources() };
	const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, databaseName: catalogName,
		verifyOriginal: media.verifyOriginal, verifyResources: (photo, signal) => verifyPhotoResourcesCurrentV1(photo, resourceHost, signal) });
	let session: PhotoLibrarySessionCurrentV1 | undefined;
	try {
		await media.ready(); const brushes = await media.getMaskRasterResources(), luts = await media.getCubeLutResources();
		const records: { photo: PhotoDocumentCurrentV1; original: Blob }[] = [], bytes = pngBytes(ORIGINAL);
		for (let index = 1; index <= count; index++) {
			const input = photoArchiveFixture(index, bytes), legacy = normalizePhotoDocumentV1({ ...input.photo, original: { ...input.photo.original, width: 3, height: 1 } });
			let photo: PhotoDocumentCurrentV1 = legacy;
			if (index === count && placement !== 'legacy') {
				if (placement === 'inactive') {
					photo = applyPhotoCommandCurrentV1(photo, { type: 'create-virtual-copy', id: 'retained', name: 'Retained repair', createdAt: SETTINGS_TIME });
					photo = applyPhotoCommandCurrentV1(photo, { type: 'set-develop', versionId: 'retained', develop: repairRecipe() });
					photo = applyPhotoCommandCurrentV1(photo, { type: 'activate-version', versionId: legacy.activeVersionId });
				} else {
					photo = applyPhotoCommandCurrentV1(photo, { type: 'record-develop', versionId: photo.activeVersionId, develop: repairRecipe(), label: 'Repair', createdAt: SETTINGS_TIME });
					if (placement === 'snapshot') photo = applyPhotoCommandCurrentV1(photo, { type: 'save-develop-snapshot', id: 'retained', name: 'Repair snapshot', createdAt: SETTINGS_TIME });
					if (placement !== 'active') photo = applyPhotoCommandCurrentV1(photo, { type: 'select-develop-history', cursor: 0 });
				}
			}
			const asset = await media.mediaRepository.writeAsset(photo.original.storageKey, input.original);
			await media.mediaRepository.catalogOriginals.stage(photo.catalogId, 'portable-seed', [{ photoId: photo.id, sourceId: photo.original.id,
				assetId: asset.sourceId, sha256: asset.sha256, size: asset.size }]); records.push({ photo, original: input.original });
		}
		let root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1',
			name: 'Current portable', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
		await catalog.createCatalog(root);
		for (let offset = 0; offset < records.length; offset += 16) root = await catalog.publishPhotos(root.id, root.revision, records.slice(offset, offset + 16).map(value => value.photo));
		for (let offset = 0; offset < records.length; offset += 16) {
			await media.mediaRepository.catalogOriginals.promote(root.id, 'portable-seed', records.slice(offset, offset + 16).map(value => value.photo.id));
		}
		const events: string[] = [], borrowed: Uint8Array<ArrayBuffer>[] = [];
		const hooks: { beforeBrush?: (reference: Readonly<BrushMaskResourceReferenceV1>, bytes: Uint8Array<ArrayBuffer>) => Promise<void>;
			beforeOriginal?: () => Promise<void>; afterBody?: () => Promise<void> } = {};
		const brushSource: MaskRasterSourcePortV1 = { withBytes<Result>(reference: Readonly<BrushMaskResourceReferenceV1>,
			consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result> {
			assert.equal(this, brushSource); events.push(`brush:${reference.storageKey}`);
			return brushes.source.withBytes(reference, async bytes => { borrowed.push(bytes); await hooks.beforeBrush?.(reference, bytes); return consume(bytes); }, options)
				.then(async value => { await hooks.afterBody?.(); return value; });
		} };
		const lutSource: CubeLutSourcePortV1 = { withBytes<Result>(reference: Readonly<VideoCubeLutReferenceV1>,
			consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result> {
			assert.equal(this, lutSource); events.push(`lut:${reference.storageKey}`);
			return luts.source.withBytes<Result>(reference, async bytes => { borrowed.push(bytes); return consume(bytes); }, options);
		} };
		const backup = { readSnapshot: (...args: Parameters<typeof catalog.readSnapshot>) => catalog.readSnapshot(...args),
			captureSmartCollectionArchiveV1: (...args: Parameters<typeof catalog.captureSmartCollectionArchiveV1>) => catalog.captureSmartCollectionArchiveV1(...args),
			async loadOriginal(original: PhotoDocumentCurrentV1['original'], signal?: AbortSignal) {
				events.push('original'); await hooks.beforeOriginal?.(); await media.verifyOriginal(original, signal);
				return media.mediaRepository.loadAsset(original.storageKey, { signal, expectedSize: original.byteLength });
			} };
		const ports: PhotoLibrarySessionPortsCurrentV1 = { catalog, stacks: catalog, backup, journal: media.settingsRepository,
			developPresetSettings: media.settingsRepository, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
			initialize: async () => root, exclusive: async (_catalogId, run, signal) => run(signal),
			verifyResources: (photo, signal) => verifyPhotoResourcesCurrentV1(photo, resourceHost, signal),
			cubeLutResources: async function () { assert.equal(this, ports); return { ...luts, source: lutSource }; },
			maskRasterResources: async function () { assert.equal(this, ports); return { ...brushes, source: brushSource }; },
			async closeResources() {
				const results = await Promise.allSettled([catalog.close(), media.close()]);
				const errors = results.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
				if (errors.length === 1) throw errors[0]; if (errors.length) throw new AggregateError(errors, 'Portable fixture cleanup failed.');
			} };
		session = new PhotoLibrarySessionCurrentV1(ports); const actual = session; await actual.readPage(); events.splice(0);
		const key = photoDevelopPresetsKeyV1(root.id);
		return { native, media, catalog, root, records, session: actual, ports, hooks, events, borrowed, key, brushSource,
			row: () => media.settingsRepository.get(key), writeRow: (value: unknown) => media.settingsRepository.put(key, value),
			async saveLegacyBrush() {
				const reference = await withPreparedBrushMaskResourceV1({ width: 3, height: 1, alpha: Uint8Array.from([255, 0, 128]) }, body => brushes.put(body.reference, body.bytes).then(() => body.reference));
				const previous = records[0]!.photo, draft = brushSettingsRecipe(reference, defaultImageDevelopStateV2());
				const photo = normalizePhotoDocumentV2({ ...previous, schemaVersion: 2, versions: [{ ...previous.versions[0]!, develop: draft }] });
				records[0]!.photo = await catalog.savePhoto(photo, previous.revision); events.splice(0); borrowed.splice(0);
				return reference;
			},
			async savePreset(withResources = false) {
				let draft: ImageDevelopStateCurrentV1 = repairRecipe();
				if (withResources) {
					const refs: Readonly<BrushMaskResourceReferenceV1>[] = [];
					for (const alpha of [[255, 0, 128], [31, 192, 64]]) refs.push(await withPreparedBrushMaskResourceV1({ width: 3, height: 1, alpha: Uint8Array.from(alpha) }, body => brushes.put(body.reference, body.bytes).then(() => body.reference)));
					await luts.importFile(new Blob([LUT_BODY])); const base = brushSettingsRecipe(refs[0]!);
					draft = normalizeImageDevelopStateCurrentV1({ ...base, effects: [profile(false)], masks: [{ ...base.masks[0]!,
						inputs: [...base.masks[0]!.inputs, { name: 'unused', sourceRef: refs[1]!.storageKey, kind: 'alpha' }] }] });
				}
				const source = await actual.develop.read({ schemaVersion: 3, photoId: records[0]!.photo.id });
				const packet = await actual.develop.settingsCurrent!.copySelected({ schemaVersion: 3, catalogId: source.catalogId, photoId: source.photoId,
					versionId: source.versionId, revision: source.revision, develop: draft, selection: FULL_SETTINGS_SELECTION });
				const preset = actual.develop.presetsCurrent!.create({ schemaVersion: 3, id: 'portable', name: 'Portable repair', settings: packet });
				await actual.develop.presetsCurrent!.write({ schemaVersion: 3, catalogId: root.id, command: { type: 'save', expectedRevision: 0, preset } });
				events.splice(0); borrowed.splice(0); return preset;
			},
			async corruptResource(storageKey: string) {
				const opening = native.factory.open(mediaName), database = await new Promise<IDBDatabase>((resolve, reject) => {
					opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); }; });
				try { await transact(database, 'analysis', 'readwrite', async stores => {
					const row = await request(stores.analysis!.get(storageKey)) as { value: { bytes: Uint8Array } };
					assert.ok(row?.value.bytes.length); row.value.bytes[0] = row.value.bytes[0]! ^ 1; await request(stores.analysis!.put(row));
				}); } finally { database.close(); }
			},
			async inspect() { return Promise.all(records.map(value => catalog.loadPhoto(root.id, value.photo.id))); },
			async legacySession() {
				const legacy = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, databaseName: catalogName, verifyOriginal: media.verifyOriginal });
				const cube = ports.cubeLutResources!, mask = ports.maskRasterResources!;
				return new PhotoLibrarySessionV2({ ...ports, catalog: legacy, stacks: legacy,
					cubeLutResources: () => Reflect.apply(cube, ports, []), maskRasterResources: () => Reflect.apply(mask, ports, []),
					backup: { ...backup, readSnapshot: (...args) => legacy.readSnapshot(...args), captureSmartCollectionArchiveV1: (...args) => legacy.captureSmartCollectionArchiveV1(...args) },
					verifyResources: undefined, closeResources: () => legacy.close() });
			},
			async close() { try { await actual.close(); } finally { restore(); } },
		};
	} catch (error) {
		const outcomes = await Promise.allSettled([session?.close(), catalog.close(), media.close()]); restore();
		const failures = outcomes.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
		if (failures.length) throw new AggregateError([error, ...failures], 'Portable fixture setup and cleanup failed.', { cause: error }); throw error;
	}
}

export async function readRepairBackupArchive(blob: Blob) {
	const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false }), entries = new Map<string, Uint8Array<ArrayBuffer>>();
	try { for (const entry of await reader.getEntries()) if (!entry.directory) entries.set(entry.filename, new Uint8Array(await entry.getData(new Uint8ArrayWriter()))); }
	finally { await reader.close(); }
	const document = JSON.parse(new TextDecoder().decode(entries.get('project.json'))) as Record<string, unknown>;
	return { document, entries };
}
export function repairBackupDestination(events: string[]) {
	const parts: Uint8Array<ArrayBuffer>[] = [];
	const writable = new WritableStream<Uint8Array>({ write(bytes) { events.push('write'); parts.push(new Uint8Array(bytes)); }, close() { events.push('commit'); }, abort() { events.push('abort'); } });
	return { parts, writable, createWritable: async () => { events.push('open'); return writable; } };
}
