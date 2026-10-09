/* SPDX-License-Identifier: AGPL-3.0-only */

import { withCubeLutResourceV1 } from '../../common/editor/imaging/cube-lut-resource-v1.ts';
import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { normalizeCubeLutProfileEffectV1 } from '../../common/editor/video-cube-lut-profile-v1.ts';
import { createPhotoCubeLutReachabilityV1 } from '../catalog/photo-cube-lut-reachability-v1.ts';
import { catalogTransaction } from '../catalog/catalog-transaction.ts';
import { array, field, record, unique } from '../catalog/value-validation.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import type { PhotoCatalogArchiveLutResourceV5 } from '../archive/catalog-archive-contract-v5.ts';
import type { PhotoLibraryRestoreAllocationV1 } from './photo-library-restore-ownership-v1.ts';
import { assertMediaRestoreOwnerV1 } from './photo-media-restore-read-v1.ts';
import { readMediaRestoreCatalogPageV2 } from './photo-media-restore-read-v2.ts';
import { readPhotoMediaRestorePresetsV2, type PhotoMediaRestorePresetBindingV2 } from './photo-media-restore-presets-v2.ts';
import { checkMediaRestoreSignalV1 } from './photo-media-restore-signal-v1.ts';

const NativeBytes = Uint8Array, TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, FILL = NativeBytes.prototype.fill;
const PREFIX = 'lut-sha256:';

/** Scalar declarations only; complete body and reachable inventory proof is separate. */
export function admitPhotoMediaRestoreLutsV1(value: unknown): readonly Readonly<PhotoCatalogArchiveLutResourceV5>[] {
	const rows = array(value, 'restore LUT resources', 0, 4094).map(value => {
		const row = record(value, 'restore LUT declaration', ['id', 'entry', 'reference']);
		const reference = normalizeCubeLutProfileEffectV1({ id: 'restore-lut', type: 'cube-lut-profile-v1', enabled: false,
			params: { lut: field(row, 'reference') } }).params.lut;
		if (!reference || field(row, 'id') !== reference.storageKey || field(row, 'entry') !== `assets/luts/${reference.sha256}.cube`) {
			throw new TypeError('Restore LUT declaration differs from its exact namespace/reference.');
		}
		return Object.freeze({ id: reference.storageKey, entry: `assets/luts/${reference.sha256}.cube`, reference });
	});
	unique(rows.map(row => row.id), 'restore LUT identities');
	return Object.freeze(rows.sort((left, right) => left.reference.sha256 < right.reference.sha256 ? -1 : left.reference.sha256 > right.reference.sha256 ? 1 : 0));
}

/** Walk every admitted photo version/redo/snapshot and full/partial preset.
 * Only bounded immutable scalar references remain; no catalog document array. */
export async function auditPhotoMediaRestoreLutReachabilityV1(media: IDBDatabase, catalog: IDBDatabase,
	allocation: PhotoLibraryRestoreAllocationV1, root: PhotoCatalogRootV1, presets: PhotoMediaRestorePresetBindingV2 | null,
	declared: readonly Readonly<PhotoCatalogArchiveLutResourceV5>[], signal: AbortSignal): Promise<void> {
	const closure = createPhotoCubeLutReachabilityV1();
	await catalogTransaction(media, ['settings'], 'readonly', async stores => {
		await assertMediaRestoreOwnerV1(stores, allocation);
		const row = await readPhotoMediaRestorePresetsV2(stores.settings!, root.id, presets);
		for (const preset of row?.presets ?? []) closure.addPreset(preset);
	}, signal);
	let after: string | null = null, count = 0;
	for (;;) {
		const page = await readMediaRestoreCatalogPageV2(catalog, allocation, root, after, signal, photo => closure.addPhoto(photo));
		if (!page.length) break;
		count += page.length; if (count > root.photoCount) throw new Error('Restore LUT source contains excess photos.');
		after = `${root.id}|${page[page.length - 1]!.photoId}`;
	}
	if (count !== root.photoCount || JSON.stringify(closure.finish()) !== JSON.stringify(declared.map(row => row.reference))) {
		throw new Error('Restore reachable and declared LUT inventories differ.');
	}
	await catalogTransaction(media, ['settings', 'analysis'], 'readonly', async stores => {
		await assertMediaRestoreOwnerV1(stores, allocation); await assertPhotoMediaRestoreLutsV1(stores.analysis!, declared, signal);
	}, signal);
}

/** One exact body point read at a time, then a <=64-key prefix page. Generic
 * computed analysis remains allowed. This joins native requests and c243 body
 * authentication; the owned structured-clone raw bytes are wiped afterward. */
export async function assertPhotoMediaRestoreLutsV1(store: IDBObjectStore,
	declared: readonly Readonly<PhotoCatalogArchiveLutResourceV5>[], signal: AbortSignal): Promise<void> {
	for (const resource of declared) {
		checkMediaRestoreSignalV1(signal);
		await verifyOwnedRow(await request(store.get(resource.id)), resource, signal);
	}
	let count = 0, after: string | null = null;
	for (;;) {
		const keys = await readKeys(store, after, declared.length - count);
		if (!keys.length) break;
		for (const key of keys) {
			if (key !== declared[count]?.id) throw new Error('Restore LUT namespace contains a different body identity.'); count++;
		}
		after = keys[keys.length - 1]!;
	}
	if (count !== declared.length) throw new Error('Restore LUT physical inventory count differs.');
}
async function verifyOwnedRow(value: unknown, resource: Readonly<PhotoCatalogArchiveLutResourceV5>, signal: AbortSignal): Promise<void> {
	// The request owns this structured clone. Capture its inert byte field before
	// closed row/reference admission can reject; malformed metadata also retires it.
	const rawRow: unknown = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'value')?.value : undefined;
	const bytes: unknown = rawRow && typeof rawRow === 'object' ? Object.getOwnPropertyDescriptor(rawRow, 'bytes')?.value : undefined;
	if (Reflect.apply(TAG, bytes, []) !== 'Uint8Array') throw new TypeError('Restore LUT row requires native bytes.');
	const buffer = Reflect.apply(BUFFER, bytes, []) as ArrayBuffer;
	try {
		const wrapper = record(value, 'restore LUT wrapper', ['key', 'value']);
		if (field(wrapper, 'key') !== resource.id) throw new Error('Restore LUT key differs.');
		const row = record(field(wrapper, 'value'), 'restore LUT body', ['schemaVersion', 'kind', 'reference', 'bytes']);
		const reference = normalizeCubeLutProfileEffectV1({ id: 'restore-body', type: 'cube-lut-profile-v1', enabled: false,
			params: { lut: field(row, 'reference') } }).params.lut;
		if (field(row, 'schemaVersion') !== 1 || field(row, 'kind') !== 'photo-cube-lut-body'
			|| JSON.stringify(reference) !== JSON.stringify(resource.reference)) throw new Error('Restore LUT row/reference differs.');
		await withCubeLutResourceV1({ reference: resource.reference, bytes, signal }, () => undefined);
	} finally { if (Reflect.apply(SIZE, buffer, []) > 0) Reflect.apply(FILL, bytes, [0]); }
}
function readKeys(store: IDBObjectStore, after: string | null, remaining: number): Promise<readonly string[]> {
	return new Promise((resolve, reject) => {
		const keys: string[] = [], opening = store.openKeyCursor(IDBKeyRange.bound(after ?? PREFIX, `${PREFIX}\uffff`, after !== null, true));
		opening.onerror = () => { reject(opening.error ?? new Error('Could not audit LUT namespace.')); };
		opening.onsuccess = () => {
			const cursor = opening.result; if (!cursor) { resolve(keys); return; }
			const key = cursor.primaryKey;
			if (typeof key !== 'string' || !/^lut-sha256:[0-9a-f]{64}$/u.test(key) || (after !== null && key <= after)
				|| (keys.length && key <= keys[keys.length - 1]!) || keys.length >= remaining) {
				reject(new Error('Restore LUT namespace contains excess or malformed identities.')); return;
			}
			keys.push(key); if (keys.length === 64) resolve(keys); else cursor.continue();
		};
	});
}
