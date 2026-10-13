/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from '../../../src/common/editor/storage/indexeddb-backend.ts';
import { normalizeCatalogOriginalRoot } from '../../../src/common/editor/storage/media-catalog-original-schema.ts';
import { digestMediaContent } from '../../../src/common/editor/storage/media-content-digest.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../../../src/lightscaper/catalog/photo-resource-reachability-current-v1.ts';
import { PhotoMediaStoreV1 } from '../../../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { verifyPhotoResourceReferencesCurrentV1 } from '../../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { normalizePhotoDevelopPresetRowCurrentV1 } from '../../../src/lightscaper/storage/photo-develop-preset-row-current-v1.ts';
import { photoDevelopPresetsKeyV1 } from '../../../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { photoDevelopPresetEntryValue } from '../../../src/lightscaper/storage/photo-develop-preset-read-v2.ts';
import { validatePhotoDevelopProxyCustodyV1 } from '../../helpers/lightscaper-develop-proxy-native-observer.ts';

const READ = Blob.prototype.arrayBuffer, SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const MAXIMUM_BODY = 4096;

/** Complete custody of this two/four-photo native import fixture. It refuses
 * extra roots, authenticates all retained recipes and presets, and never
 * initializes or publishes a library. Encoded/body buffers are joined and wiped. */
export async function readRepairImportCustodyNativeV1(ids: readonly string[], observedWorker: () => Promise<void>) {
	check((ids.length === 2 || ids.length === 4) && new Set(ids).size === ids.length, 'Import observer needs exactly two or four distinct Photos.');
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks });
	let media: PhotoMediaStoreV1 | null = null, catalog: PhotoCatalogRepositoryCurrentV1 | null = null;
	let result: Awaited<ReturnType<typeof read>> | undefined, failed = false, failure: unknown;
	async function read() {
		await anchor.ready(); const selected = await location();
		media = selected.allocation ? new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks,
			databaseName: selected.location.mediaDatabaseName, preferOpfs: false }) : anchor;
		await media.ready(); const owner = media, resources = {
			cubeLutResources: () => owner.getCubeLutResources(), maskRasterResources: () => owner.getMaskRasterResources(),
		};
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB, databaseName: selected.location.catalogDatabaseName, verifyOriginal: owner.verifyOriginal });
		const root = await catalog.loadCatalog(selected.location.catalogId); check(root?.photoCount === ids.length, 'Import observer must cover the complete native catalog.');
		const records = await Promise.all(ids.map(id => catalog!.loadPhoto(root.id, id)));
		check(records.every(photo => photo !== null && photo.original.byteLength <= MAXIMUM_BODY), 'Import observer Photo or bounded Original is missing.');
		const photos = records.map(photo => { check(photo !== null, 'Import Photo missing.'); return photo; });
		const key = photoDevelopPresetsKeyV1(root.id), row = normalizePhotoDevelopPresetRowCurrentV1(photoDevelopPresetEntryValue(await owner.settingsRepository.readEntry(key)), root.id);
		check(row.presets.length <= 2, 'Import fixture has too many presets.');
		const collector = createPhotoResourceReachabilityCurrentV1();
		for (const photo of photos) collector.addPhoto(photo);
		for (const preset of row.presets) collector.addDevelop(preset.settings.develop);
		const references = collector.finish();
		check(references.luts.length + references.brushes.length <= 4
			&& [...references.luts, ...references.brushes].every(ref => ref.byteLength <= MAXIMUM_BODY), 'Import resource observer bound exceeded.');
		await verifyPhotoResourceReferencesCurrentV1(references, resources);
		const cubes = await owner.getCubeLutResources(), masks = await owner.getMaskRasterResources(), luts = [], bodies = [];
		for (const reference of references.luts) luts.push(await cubes.source.withBytes(reference, bytes => ({ reference, bytes: Array.from(bytes) })));
		for (const reference of references.brushes) bodies.push(await masks.source.withBytes(reference, bytes => ({ reference, bytes: Array.from(bytes) })));
		const keys = [...new Set(photos.map(photo => photo.original.storageKey))], native = await nativeRecords(selected.location.mediaDatabaseName, keys);
		const page = await owner.mediaRepository.catalogOriginals.readPage({ catalogId: root.id });
		check(native.roots.length === ids.length && page.roots.length === ids.length && page.afterKey === null
			&& native.roots.every(value => ids.includes(value.photoId) && value.importId === null)
			&& JSON.stringify(native.roots) === JSON.stringify(page.roots.map(normalizeCatalogOriginalRoot)), 'Complete native/public import custody differs.');
		const retained = [];
		for (const photo of photos) {
			const metadata = await owner.mediaRepository.getAssetMetadata(photo.original.storageKey), body = await owner.mediaRepository.loadAsset(photo.original.storageKey);
			check(metadata?.storage === 'opfs' && body !== null && Number(Reflect.apply(SIZE, body, [])) === photo.original.byteLength, 'Import Original must be an exact native OPFS snapshot.');
			const sha256 = await digestMediaContent(body, { chunkBytes: MAXIMUM_BODY }), backing = await Reflect.apply(READ, body, []) as ArrayBuffer;
			try {
				const original = validatePhotoDevelopProxyCustodyV1(photo, metadata, native.records.get(photo.original.storageKey), native.roots.filter(value => value.photoId === photo.id),
					{ roots: page.roots.filter(value => value.photoId === photo.id), afterKey: null }, sha256, body.size);
				retained.push({ photo, original: { ...original, bytes: Array.from(new Uint8Array(backing)) } });
			} finally { new Uint8Array(backing).fill(0); }
		}
		const finalNative = await nativeRecords(selected.location.mediaDatabaseName, keys);
		check(JSON.stringify(finalNative.roots) === JSON.stringify(native.roots)
			&& JSON.stringify([...finalNative.records]) === JSON.stringify([...native.records]), 'Import native custody changed during observation.');
		check(JSON.stringify(await catalog.loadCatalog(root.id)) === JSON.stringify(root)
			&& JSON.stringify(await Promise.all(ids.map(id => catalog!.loadPhoto(root.id, id)))) === JSON.stringify(photos), 'Import catalog changed during observation.');
		check(JSON.stringify(normalizePhotoDevelopPresetRowCurrentV1(photoDevelopPresetEntryValue(await owner.settingsRepository.readEntry(key)), root.id)) === JSON.stringify(row), 'Import preset row changed during observation.');
		check(JSON.stringify((await location()).pointer) === JSON.stringify(selected.pointer), 'Import selected namespace changed.');
		await observedWorker(); return { namespace: selected.location.namespaceToken, root, photos: retained, row, luts, bodies };
	}
	function location() {
		return withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw new Error('Import observer cannot initialize a library.'); } }));
	}
	try { result = await read(); } catch (error) { failed = true; failure = error; }
	const closed = await Promise.allSettled([...new Set([catalog, media, anchor])].filter(owner => owner !== null).map(owner => owner.close()));
	const errors = closed.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
	if (failed && !errors.length) throw failure;
	if (errors.length) throw new AggregateError(failed ? [failure, ...errors] : errors, 'Import observation and retirement failed.', failed ? { cause: failure } : undefined);
	check(result !== undefined, 'Import observation did not complete.'); return result;
}

async function nativeRecords(name: string, keys: readonly string[]) {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const opening = indexedDB.open(name); opening.addEventListener('upgradeneeded', () => opening.transaction?.abort(), { once: true });
		opening.addEventListener('error', () => reject(opening.error), { once: true }); opening.addEventListener('success', () => resolve(opening.result), { once: true });
	});
	try { return await transact(database, ['mediaAssets', 'catalogOriginalRoots'], 'readonly', async stores => {
		check(stores.mediaAssets !== undefined && stores.catalogOriginalRoots !== undefined, 'Import native stores missing.');
		const rawRoots: unknown[] = await request(stores.catalogOriginalRoots.getAll(undefined, 5)); check(rawRoots.length <= 4, 'Import fixture has extra native roots.');
		const records = new Map<string, unknown>(); for (const key of keys) records.set(key, await request(stores.mediaAssets.get(key)));
		return { roots: rawRoots.map(normalizeCatalogOriginalRoot), records };
	}); } finally { database.close(); }
}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
