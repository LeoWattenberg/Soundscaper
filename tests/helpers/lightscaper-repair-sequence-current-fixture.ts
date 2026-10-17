/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { PhotoLibrarySessionCurrentV1 } from '../../src/lightscaper/controller/photo-library-session-current-v1.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from '../../src/lightscaper/controller/photo-library-session-ports-current-v1.ts';
import type { PhotoLibraryCollectionHandoffRequestV1, PhotoLibraryCollectionHandoffViewV1 } from '../../src/common/editor/photo-library-collection-handoff-port-v1.ts';
import type { PhotoLibraryImageHandoffViewV2 } from '../../src/common/editor/photo-library-image-handoff-port-v2.ts';
import type { MaskRasterSourcePortV1 } from '../../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import type { CubeLutSourcePortV1 } from '../../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import type { BrushMaskResourceReferenceV1 } from '../../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../../src/common/editor/cube-lut-reference-contract.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../../src/common/editor/timeline-image-native-decode-v1.ts';
import { withPreparedBrushMaskResourceV1 } from '../../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../src/common/editor/imaging/image-develop-state-v2.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoDocumentV2 } from '../../src/lightscaper/catalog/photo-document-v2.ts';
import { normalizePhotoCatalogQueryV2 } from '../../src/lightscaper/catalog/photo-query-types-v2.ts';
import { photoStorageKey } from '../../src/lightscaper/catalog/repository-records.ts';
import { photoSmartCollectionRecordV1 } from '../../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { photoSmartCollectionSummaryRecordV1 } from '../../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { applyPhotoCommandCurrentV1 } from '../../src/lightscaper/controller/photo-commands-current-v1.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { verifyPhotoResourceReferencesCurrentV1, verifyPhotoResourcesCurrentV1 } from '../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';
import { mediaRestoreFixture } from './lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './instrumented-indexeddb-keys.ts';
import { LUT_BODY, LUT_REFERENCE, profile } from './lightscaper-masked-frame-fixture.ts';
import { decodePng, pngBytes, ORIGINAL, repairRecipe } from './lightscaper-repair-raster-export-current-fixture.ts';
import { SETTINGS_TIME } from './lightscaper-repair-settings-current-fixture.ts';

/** Future value shape is local to the test fixture until the actual legacy
 * owner RED qualifies its named successor. No future value module is imported. */
export interface RepairSequenceCaptureView extends Omit<PhotoLibraryCollectionHandoffViewV1, 'schemaVersion'> {
	readonly schemaVersion: 2;
	readonly maskRasterReferences: PhotoLibraryImageHandoffViewV2['maskRasterReferences'];
	readonly withMaskRasterBytes: PhotoLibraryImageHandoffViewV2['withMaskRasterBytes'];
}
export interface RepairSequenceFixtureOptions {
	readonly count?: number; readonly mixed?: boolean; readonly selectAll?: boolean;
	readonly originalBytes?: Uint8Array<ArrayBuffer>; readonly retainedPlacement?: 'redo' | 'snapshot' | 'inactive';
}
export function sequenceOutcome<Value>(work: Promise<Value>) {
	return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

/** Actual Current repositories, native DB stores, original roots and resource
 * owners. The optional decoder is an explicit Node PNG edge, never a browser
 * pixel claim. All selected Photos share one actual immutable Original row. */
export async function repairSequenceCurrentFixture(options: RepairSequenceFixtureOptions = {}) {
	const count = options.count ?? 4, mixed = options.mixed ?? true, selectAll = options.selectAll ?? true;
	assert.ok(Number.isSafeInteger(count) && count >= 1 && count <= 70 && (!mixed || count >= 4));
	const native = mediaRestoreFixture(), name = `lightscaper-sequence-${crypto.randomUUID()}`;
	const mediaName = `${name}-media`, catalogName = `${name}-catalog`;
	const priorRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
	Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
	const restore = () => { if (priorRange) Object.defineProperty(globalThis, 'IDBKeyRange', priorRange); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); };
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, databaseName: mediaName, preferOpfs: false, locks: null });
	const actualHost = { cubeLutResources: () => media.getCubeLutResources(), maskRasterResources: () => media.getMaskRasterResources() };
	const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, databaseName: catalogName,
		verifyOriginal: media.verifyOriginal, verifyResources: (photo, signal) => verifyPhotoResourcesCurrentV1(photo, actualHost, signal) });
	const lifecycle: { session?: PhotoLibrarySessionCurrentV1 } = {};
	try {
		await media.ready(); const masks = await media.getMaskRasterResources(), cubes = await media.getCubeLutResources();
		const bodies = new Map<string, Uint8Array<ArrayBuffer>>(), brushes: Readonly<BrushMaskResourceReferenceV1>[] = [];
		for (const alpha of [[255, 0, 128], [64, 192, 31], [17, 85, 203]]) await withPreparedBrushMaskResourceV1({ width: 3, height: 1, alpha: Uint8Array.from(alpha) }, async body => {
			await masks.put(body.reference, body.bytes); brushes.push(body.reference); bodies.set(body.reference.storageKey, body.bytes.slice());
		});
		await cubes.put(LUT_REFERENCE, LUT_BODY); bodies.set(LUT_REFERENCE.storageKey, new Uint8Array(LUT_BODY));
		const encoded = options.originalBytes ?? pngBytes(ORIGINAL), seed = photoArchiveFixture(1, encoded);
		await media.mediaRepository.writeAsset(seed.photo.original.storageKey, seed.original);
		let root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: seed.photo.catalogId,
			name: 'Current ordered sequence', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [
				{ id: 'manual', name: 'Manual selected', kind: 'manual' },
				{ id: 'smart', name: 'Smart selected', kind: 'smart', query: { kind: 'rating', minimum: 4, maximum: 5 } },
			] });
		await catalog.createCatalog(root);
		const photos: PhotoDocumentCurrentV1[] = [], selectedStart = Math.max(0, count - 4);
		for (let index = 0; index < count; index++) {
			const selected = selectAll || index >= selectedStart, slot = index - selectedStart;
			let photo: PhotoDocumentCurrentV1 = normalizePhotoDocumentV1({ ...seed.photo, id: `sequence-photo-${String(index).padStart(4, '0')}`,
				original: { ...seed.photo.original, width: 3, height: 1 }, collectionIds: selected ? ['manual'] : [], rating: selected ? 4 : 0,
				metadata: { ...seed.photo.metadata, title: selected ? 'Selected' : 'Other', fileName: `Sequence ${String(count - index).padStart(4, '0')}.png` },
				versions: [{ ...seed.photo.versions[0]!, name: `Recipe ${String(index)}` }] });
			if (mixed && slot === 0) photo = applyPhotoCommandCurrentV1(photo, { type: 'record-develop', versionId: photo.activeVersionId,
				develop: namedBrushRecipe(repairRecipe(), brushes.slice(0, 2)), label: 'Current declared repair', createdAt: SETTINGS_TIME });
			else if (mixed && slot === 1) {
				const develop = namedBrushRecipe(repairRecipe(), [brushes[2]!]);
				if (options.retainedPlacement === 'inactive') {
					photo = applyPhotoCommandCurrentV1(photo, { type: 'create-virtual-copy', id: 'inactive-repair', name: 'Inactive repair', createdAt: SETTINGS_TIME });
					photo = applyPhotoCommandCurrentV1(photo, { type: 'set-develop', versionId: 'inactive-repair', develop });
					photo = applyPhotoCommandCurrentV1(photo, { type: 'activate-version', versionId: seed.photo.activeVersionId });
				} else {
					photo = applyPhotoCommandCurrentV1(photo, { type: 'record-develop', versionId: photo.activeVersionId, develop, label: 'Retained repair', createdAt: SETTINGS_TIME });
					if (options.retainedPlacement === 'snapshot') photo = applyPhotoCommandCurrentV1(photo, { type: 'save-develop-snapshot', id: 'retained-repair', name: 'Retained repair', createdAt: SETTINGS_TIME });
					photo = applyPhotoCommandCurrentV1(photo, { type: 'select-develop-history', cursor: 0 });
				}
			} else if (mixed && slot === 2) photo = normalizePhotoDocumentV2({ ...photo, schemaVersion: 2,
				versions: [{ ...photo.versions[0]!, develop: namedBrushRecipe(defaultImageDevelopStateV2(), [brushes[0]!]) }] });
			else photo = normalizePhotoDocumentV2({ ...photo, schemaVersion: 2,
				versions: [{ ...photo.versions[0]!, develop: normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects: [profile(false)] }) }] });
			photos.push(photo);
		}
		for (let offset = 0; offset < photos.length; offset += 16) {
			const batch = photos.slice(offset, offset + 16); root = await catalog.publishPhotos(root.id, root.revision, batch);
			await media.mediaRepository.catalogOriginals.retain(root.id, batch.map(photo => ({ photoId: photo.id, assetId: photo.original.storageKey,
				sourceId: photo.original.id, sha256: photo.original.contentSha256, size: photo.original.byteLength })));
		}
		while (!(await catalog.rebuildQueryIndexPageV2(root.id)).ready) { /* Actual bounded index owner. */ }
		const context = await catalog.readSmartCollectionSnapshotV1(root.id, null);
		const definition = { schemaVersion: 1 as const, kind: 'photo-smart-collection' as const, catalogId: root.id, id: 'saved', revision: 0,
			name: 'Saved descending selected', query: normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query',
				predicate: { kind: 'text', column: 'title', operator: 'equals', value: 'Selected' }, sort: { field: 'photo-id', direction: 'descending' } }) };
		await catalog.saveSmartCollection(definition, null, { expectedCatalogRevision: context.context.catalogRevision,
			expectedIndexRevision: context.context.indexRevision, expectedStateRevision: context.context.collectionStateRevision });
		const events: string[] = [], borrowed: Uint8Array<ArrayBuffer>[] = [], closed = { resources: 0, emptyPages: 0 };
		const hooks: { original?: () => Promise<void>; beforeBrush?: (reference: Readonly<BrushMaskResourceReferenceV1>, bytes: Uint8Array<ArrayBuffer>) => Promise<void>;
			afterBrush?: () => Promise<void>; verifyBrush?: () => Promise<void>; verifyLut?: () => Promise<void>; nativeDecode?: () => Promise<void>; nativeClose?: () => void } = {};
		const brushSource: MaskRasterSourcePortV1 = { withBytes(reference, consume, options) {
			assert.equal(this, brushSource); events.push(`brush:${reference.storageKey}`);
			return masks.source.withBytes(reference, async bytes => { borrowed.push(bytes); await hooks.beforeBrush?.(reference, bytes); return consume(bytes); }, options)
				.then(async value => { await hooks.afterBrush?.(); return value; });
		} };
		const lutSource: CubeLutSourcePortV1 = { withBytes(reference, consume, options) {
			assert.equal(this, lutSource); events.push(`lut:${reference.storageKey}`);
			return cubes.source.withBytes(reference, bytes => { borrowed.push(bytes); return consume(bytes); }, options);
		} };
		const selectedMasks = Object.freeze({ ...masks, source: brushSource, async verifyReferencesV1(references: readonly Readonly<BrushMaskResourceReferenceV1>[], signal?: AbortSignal) {
			assert.equal(this, selectedMasks); events.push('verify:brush'); await hooks.verifyBrush?.(); assert.ok(masks.verifyReferencesV1);
			return Reflect.apply(masks.verifyReferencesV1, masks, [references, signal]);
		} });
		const selectedLuts = Object.freeze({ ...cubes, source: lutSource, async verifyReferencesV1(references: readonly Readonly<VideoCubeLutReferenceV1>[], signal?: AbortSignal) {
			assert.equal(this, selectedLuts); events.push('verify:lut'); await hooks.verifyLut?.(); assert.ok(cubes.verifyReferencesV1);
			return Reflect.apply(cubes.verifyReferencesV1, cubes, [references, signal]);
		} });
		const backup = { readSnapshot: catalog.readSnapshot.bind(catalog), captureSmartCollectionArchiveV1: catalog.captureSmartCollectionArchiveV1.bind(catalog),
			async loadOriginal(original: PhotoDocumentCurrentV1['original'], signal?: AbortSignal) {
				assert.equal(this, backup); events.push('original'); await hooks.original?.(); await media.verifyOriginal(original, signal);
				return media.mediaRepository.loadAsset(original.storageKey, { signal, expectedSize: original.byteLength });
			} };
		const verificationHost = { cubeLutResources: () => Promise.resolve(selectedLuts), maskRasterResources: () => Promise.resolve(selectedMasks) };
		const ports: PhotoLibrarySessionPortsCurrentV1 = { catalog, smartCollections: catalog, stacks: catalog, backup,
			journal: media.settingsRepository, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
			initialize: async () => { const value = await catalog.loadCatalog(root.id); assert.ok(value); return value; }, exclusive: async (_id, run, signal) => run(signal),
			cubeLutResources: async function () { assert.equal(this, ports); return selectedLuts; },
			maskRasterResources: async function () { assert.equal(this, ports); return selectedMasks; },
			verifyResources: (photo, signal) => verifyPhotoResourcesCurrentV1(photo, verificationHost, signal),
			async closeResources() { closed.resources++; const outcomes = await Promise.allSettled([catalog.close(), media.close()]);
				const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : []);
				if (failures.length === 1) throw failures[0]; if (failures.length) throw new AggregateError(failures, 'Sequence native fixture cleanup failed.'); }
		};
		const readQuery = catalog.readQueryPageV2;
		catalog.readQueryPageV2 = async function (...args) { const page = await Reflect.apply(readQuery, this, args); if (!page.items.length && page.continuation) closed.emptyPages++; return page; };
		const session = new PhotoLibrarySessionCurrentV1(ports); lifecycle.session = session;
		await session.readPage(); events.splice(0); borrowed.splice(0);
		const rootNow = await catalog.loadCatalog(root.id); assert.ok(rootNow);
		const manualBinding = Object.freeze({ catalogId: root.id, collectionId: 'manual', scope: 'catalog' as const, expectedCatalogRevision: rootNow.revision });
		const smartBinding = Object.freeze({ ...manualBinding, collectionId: 'smart' });
		const savedBinding = Object.freeze({ ...manualBinding, collectionId: 'saved', scope: 'saved-query' as const, expectedDefinitionRevision: definition.revision });
		const selectedPhotos = photos.filter(photo => photo.collectionIds.includes('manual'));
		let nextId = 0;
		const dependencies = { openImage: async function (this: unknown, input: Parameters<OpenFramescaperBrowserNativeImageV1>[0]) {
			assert.equal(this, dependencies); events.push('native-open'); const image = decodePng(input.bytes);
			return { metadata: { width: image.width, height: image.height, frameCount: 1, topology: 'single' as const, runtimeVersion: 'actual-node-png-edge' },
				async decodeFrame(index: number) { assert.equal(index, 0); await hooks.nativeDecode?.(); events.push('native-decode'); return { rgba: image.pixels.slice(), durationMicroseconds: null }; },
				close() { events.push('native-close'); image.pixels.fill(0); hooks.nativeClose?.(); } };
		}, createId: () => `sequence-owned-${String(++nextId)}`, now: () => SETTINGS_TIME };
		return { native, catalog, media, ports, session, root: rootNow, definition, photos, selectedPhotos, encoded, original: seed.original,
			manualBinding, smartBinding, savedBinding, resources: { luts: [LUT_REFERENCE], brushes: brushes.slice(0, 2), retainedOnly: brushes[2]! },
			bodies, events, borrowed, hooks, closed, backup, brushSource, lutSource, dependencies,
			binding(kind: 'manual' | 'smart' | 'saved' = 'manual') { return kind === 'saved' ? savedBinding : kind === 'smart' ? smartBinding : manualBinding; },
			capture<Value>(consume: (view: Readonly<RepairSequenceCaptureView>) => Value | Promise<Value>, signalOptions: Readonly<{ signal?: AbortSignal }> = {}, binding: Readonly<PhotoLibraryCollectionHandoffRequestV1> = manualBinding): Promise<Value> {
				const descriptor = Object.getOwnPropertyDescriptor(session, 'collectionHandoffCurrent'), current = descriptor?.value as PhotoLibrarySessionCurrentV1['collectionHandoff'] | undefined;
				const port = current ?? session.collectionHandoff;
				return Reflect.apply(port.withCapture, port, [binding, consume, signalOptions]) as Promise<Value>;
			},
			async verifyReferences(references: Parameters<typeof verifyPhotoResourceReferencesCurrentV1>[0], signal?: AbortSignal) {
				await verifyPhotoResourceReferencesCurrentV1(references, { cubeLutResources: () => ports.cubeLutResources!(), maskRasterResources: () => ports.maskRasterResources!() }, signal);
			},
			change(value: unknown, index = selectedStart) { const photo = normalizePhotoDocumentCurrentV1(value), key = photoStorageKey(root.id, photos[index]!.id);
				native.raw(catalogName).seedRecord(catalogName, 'photos', { key, document: photo }); photos[index] = photo; },
			changeDefinition(value: unknown) { native.raw(catalogName).seedRecord(catalogName, 'photoSmartCollections', photoSmartCollectionRecordV1(value));
				native.raw(catalogName).seedRecord(catalogName, 'photoSmartCollectionSummaries', photoSmartCollectionSummaryRecordV1(value)); },
			async corruptResource(key: string) { const database = await openNative(mediaName);
				try { await transact(database, 'analysis', 'readwrite', async stores => { const row = await request(stores.analysis!.get(key)) as { value: { bytes: Uint8Array } };
					assert.ok(row?.value.bytes.length); row.value.bytes[0] = row.value.bytes[0]! ^ 1; await request(stores.analysis!.put(row)); }); } finally { database.close(); } },
			async inspect() { const values = await Promise.all(photos.map(photo => catalog.loadPhoto(root.id, photo.id)));
				const body = await media.mediaRepository.loadAsset(seed.photo.original.storageKey); assert.ok(body);
				const roots = []; let afterKey: string | null = null;
				do { const page = await media.mediaRepository.catalogOriginals.readPage({ catalogId: root.id, afterKey }); roots.push(...page.roots); afterKey = page.afterKey; } while (afterKey);
				return { photos: values, root: await catalog.loadCatalog(root.id), roots, bytes: Array.from(new Uint8Array(await body.arrayBuffer())) }; },
			async close() { try { await session.close(); } finally { restore(); } },
		};
	} catch (error) {
		await Promise.allSettled([lifecycle.session?.close(), catalog.close(), media.close()]); restore(); throw error;
	}
	function namedBrushRecipe(base: unknown, references: readonly Readonly<BrushMaskResourceReferenceV1>[]) {
		const admitted = normalizeImageDevelopStateCurrentV1(base);
		return normalizeImageDevelopStateCurrentV1({ ...admitted, effects: [profile(false)], masks: [{ schemaVersion: 2, name: 'Declared sequence paint', id: 'painted', kind: 'matte',
			inputs: references.map((reference, index) => ({ name: `paint-${String(index)}`, kind: 'alpha', sourceRef: reference.storageKey })),
			nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'paint-0' }], outputNodeId: 'alpha' }], maskBindings: [] });
	}
	function openNative(databaseName: string): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const opening = native.factory.open(databaseName);
		opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); }; }); }
}
