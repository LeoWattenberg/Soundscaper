/* SPDX-License-Identifier: AGPL-3.0-only */

import { fingerprintNativeMediaPlan } from '../../src/common/editor/native-media-plan-canonical-form.ts';
import { normalizeVideoVisualPresetV1 } from '../../src/common/editor/video-visual-preset-v24.ts';
import { KeyValueRepository } from '../../src/common/editor/storage/key-value-repository.ts';
import { request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { photoDevelopPresetsKeyV1 } from '../../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { repairSettingsFixture, FULL_SETTINGS_SELECTION } from './lightscaper-repair-settings-current-fixture.ts';
import type { ImageDevelopStateCurrentV1 } from '../../src/common/editor/imaging/image-develop-state-current-v1.ts';
import type { ImageDevelopSelectionV3, ImageDevelopSettingsPacketV3 } from '../../src/common/editor/imaging/image-develop-settings-contract-v3.ts';

/** Honest normalized Packet3 plus the actual owning visual identity hash.
 * The fixture creates no proof; native owners must authenticate every body. */
export function currentPreset(packet: Readonly<ImageDevelopSettingsPacketV3>, id = 'repair-preset', name = 'Repair preset') {
	return Object.freeze({ schemaVersion: 3 as const, kind: 'image-develop-preset' as const,
		identity: normalizeVideoVisualPresetV1({ schemaVersion: 1, kind: 'video-preset', id, name,
			modelKind: 'adjustment-layer', authoredStateSha256: fingerprintNativeMediaPlan(packet).sha256 }), settings: packet });
}

/** The selected Session and additional native settings owners share the exact
 * physical namespace. Transparent observers only hold genuine native CAS ACKs. */
export async function repairPresetsFixture(count = 2) {
	const f = await repairSettingsFixture(count), anchor = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, preferOpfs: false });
	let media: PhotoMediaStoreV1 | undefined, catalog: PhotoCatalogRepositoryCurrentV1 | undefined;
	const putDescriptor = Object.getOwnPropertyDescriptor(KeyValueRepository.prototype, 'putIfAbsent');
	const replaceDescriptor = Object.getOwnPropertyDescriptor(KeyValueRepository.prototype, 'replaceIfCurrent');
	const put = KeyValueRepository.prototype.putIfAbsent, replace = KeyValueRepository.prototype.replaceIfCurrent;
	const key = photoDevelopPresetsKeyV1(f.photos[0]!.catalogId), writes: { kind: 'put' | 'replace'; acknowledged: boolean }[] = [];
	const hooks = { afterWrite: async (_acknowledged: boolean): Promise<void> => undefined };
	const restore = () => {
		for (const [method, descriptor] of [['putIfAbsent', putDescriptor], ['replaceIfCurrent', replaceDescriptor]] as const) {
			if (descriptor) Object.defineProperty(KeyValueRepository.prototype, method, descriptor);
			else Reflect.deleteProperty(KeyValueRepository.prototype, method);
		}
	};
	Object.defineProperty(KeyValueRepository.prototype, 'putIfAbsent', { configurable: true, value: async function (this: KeyValueRepository, ...args: Parameters<typeof put>) {
		const acknowledged = await Reflect.apply(put, this, args) as boolean;
		if (args[0] === key) { writes.push({ kind: 'put', acknowledged }); await hooks.afterWrite(acknowledged); } return acknowledged;
	} });
	Object.defineProperty(KeyValueRepository.prototype, 'replaceIfCurrent', { configurable: true, value: async function (this: KeyValueRepository, ...args: Parameters<typeof replace>) {
		const acknowledged = await Reflect.apply(replace, this, args) as boolean;
		if (args[0] === key) { writes.push({ kind: 'replace', acknowledged }); await hooks.afterWrite(acknowledged); } return acknowledged;
	} });
	try {
		await anchor.ready(); const selected = await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw new Error('Preset fixture cannot initialize another namespace.'); } });
		await anchor.close();
		media = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, databaseName: selected.location.mediaDatabaseName, preferOpfs: false });
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.native.factory, databaseName: selected.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
		await media.ready(); const owner = media, root = await catalog.loadCatalog(f.photos[0]!.catalogId);
		if (!root) throw new Error('The actual preset fixture catalog is missing.');
		const resources = { cubeLutResources: () => owner.getCubeLutResources(), maskRasterResources: () => owner.getMaskRasterResources() };
		const others = new Set<PhotoMediaStoreV1>();
		return { ...f, root, settings: owner.settingsRepository, resources, writes, presetHooks: hooks, key,
			row: () => owner.settingsRepository.get(key),
			writeRow: (row: unknown) => owner.settingsRepository.put(key, row),
			async corruptResource(storageKey: string) {
				const opening = f.native.factory.open(selected.location.mediaDatabaseName), database = await new Promise<IDBDatabase>((resolve, reject) => {
					opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); }; });
				try { await transact(database, 'analysis', 'readwrite', async stores => {
					const row = await request(stores.analysis!.get(storageKey)) as { value: { bytes: Uint8Array } };
					if (!row?.value.bytes.length) throw new Error('An actual native preset resource body is required.');
					row.value.bytes[0] = row.value.bytes[0]! ^ 1; await request(stores.analysis!.put(row));
				}); } finally { database.close(); }
			},
			packet(develop: ImageDevelopStateCurrentV1 = f.source().develop, selection: ImageDevelopSelectionV3 = FULL_SETTINGS_SELECTION) {
				return f.session.develop.settingsCurrent!.copy({ schemaVersion: 3, develop, selection });
			},
			async selectedPacket(develop: ImageDevelopStateCurrentV1 = f.source().develop, selection: ImageDevelopSelectionV3 = FULL_SETTINGS_SELECTION) {
				return f.session.develop.settingsCurrent!.copySelected({ ...f.source(0, develop), selection });
			},
			async openSettings() {
				const current = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, databaseName: selected.location.mediaDatabaseName, preferOpfs: false });
				others.add(current); await current.ready(); return current.settingsRepository;
			},
			async reopen() { await f.session.close(); return import('../../src/lightscaper/photo-library-session-runtime-current-v1.ts').then(module => module.createPhotoLibrarySessionCurrentV1(f.options)); },
			async close() {
				const outcomes = await Promise.allSettled([f.close(), ...[...others, owner].map(current => current.close()), catalog!.close(), anchor.close()]);
				restore(); const errors = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : []);
				if (errors.length) throw new AggregateError(errors, 'Preset fixture cleanup failed.');
			},
		};
	} catch (error) {
		const outcomes = await Promise.allSettled([media?.close(), catalog?.close(), anchor.close(), f.close()]); restore();
		const errors = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : []);
		if (errors.length) throw new AggregateError([error, ...errors], 'Preset fixture setup and cleanup failed.', { cause: error }); throw error;
	}
}
