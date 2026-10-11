/* SPDX-License-Identifier: AGPL-3.0-only */

import { withBrushMaskResourceV1, normalizeBrushMaskResourceReferenceV1,
	type BrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { createPhotoMaskRasterReachabilityV1 } from '../catalog/photo-mask-raster-reachability-v1.ts';
import { catalogTransaction } from '../catalog/catalog-transaction.ts';
import { array, field, record, unique } from '../catalog/value-validation.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import type { PhotoCatalogArchiveMaskRasterResourceV6 } from '../archive/catalog-archive-contract-v6.ts';
import type { PhotoLibraryRestoreAllocationV1 } from './photo-library-restore-ownership-v1.ts';
import { assertMediaRestoreOwnerV1 } from './photo-media-restore-read-v1.ts';
import { readMediaRestoreCatalogPageV2 } from './photo-media-restore-read-v2.ts';
import { checkMediaRestoreSignalV1 } from './photo-media-restore-signal-v1.ts';

const NativeBytes = Uint8Array, TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, FILL = NativeBytes.prototype.fill;
const PREFIX = 'brush-mask-', REFERENCE_FIELDS = Object.freeze(['storageKey', 'sha256', 'width', 'height', 'byteLength']);

export function admitPhotoMediaRestoreMaskRasterReferenceV1(value: unknown): Readonly<BrushMaskResourceReferenceV1> {
	const input = record(value, 'restore brush reference', REFERENCE_FIELDS);
	const reference = normalizeBrushMaskResourceReferenceV1(field(input, 'storageKey'));
	for (const key of REFERENCE_FIELDS) if (field(input, key) !== reference[key as keyof BrushMaskResourceReferenceV1]) {
		throw new TypeError('Restore brush reference differs from its canonical identity.');
	}
	return reference;
}

/** Closed scalar declarations grant no body authority. Each complete native
 * SCMASK01 body is independently authenticated during delivery and finish. */
export function admitPhotoMediaRestoreMaskRastersV1(value: unknown): readonly Readonly<PhotoCatalogArchiveMaskRasterResourceV6>[] {
	const rows = array(value, 'restore brush resources', 0, 4094).map(value => {
		const row = record(value, 'restore brush declaration', ['id', 'entry', 'reference']);
		const reference = admitPhotoMediaRestoreMaskRasterReferenceV1(field(row, 'reference'));
		const entry = `assets/masks/${reference.sha256}.scmask`;
		if (field(row, 'id') !== reference.storageKey || field(row, 'entry') !== entry) {
			throw new TypeError('Restore brush declaration differs from its exact namespace/reference.');
		}
		return Object.freeze({ id: reference.storageKey, entry, reference });
	});
	unique(rows.map(row => row.id), 'restore brush identities'); unique(rows.map(row => row.entry), 'restore brush entries');
	return Object.freeze(rows.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/** Complete owning Photos include inactive versions, history/redo, snapshots
 * and every disabled/unbound/unused declaration. Only bounded scalar identities
 * survive the serial <=64-binding pages; preset portability remains unchanged. */
export async function auditPhotoMediaRestoreMaskRasterReachabilityV1(media: IDBDatabase, catalog: IDBDatabase,
	allocation: PhotoLibraryRestoreAllocationV1, root: PhotoCatalogRootV1,
	declared: readonly Readonly<PhotoCatalogArchiveMaskRasterResourceV6>[], signal: AbortSignal): Promise<void> {
	const closure = createPhotoMaskRasterReachabilityV1(); let after: string | null = null, count = 0;
	for (;;) {
		const page = await readMediaRestoreCatalogPageV2(catalog, allocation, root, after, signal, photo => closure.addPhoto(photo));
		if (!page.length) break;
		count += page.length; if (count > root.photoCount) throw new Error('Restore brush source contains excess photos.');
		after = `${root.id}|${page[page.length - 1]!.photoId}`;
	}
	if (count !== root.photoCount || JSON.stringify(closure.finish()) !== JSON.stringify(declared.map(row => row.reference))) {
		throw new Error('Restore reachable and declared brush inventories differ.');
	}
	await catalogTransaction(media, ['settings', 'analysis'], 'readonly', async stores => {
		await assertMediaRestoreOwnerV1(stores, allocation); await assertPhotoMediaRestoreMaskRastersV1(stores.analysis!, declared, signal);
	}, signal);
}

/** One authenticated body point read and a <=64-key reserved-prefix page at a
 * time. Unknown/future brush namespaces cannot hide beside generic analysis.
 * Each owned structured-clone body is wiped even when row admission fails. */
export async function assertPhotoMediaRestoreMaskRastersV1(store: IDBObjectStore,
	declared: readonly Readonly<PhotoCatalogArchiveMaskRasterResourceV6>[], signal: AbortSignal): Promise<void> {
	for (const resource of declared) { checkMediaRestoreSignalV1(signal); await verifyOwnedRow(await request(store.get(resource.id)), resource, signal); }
	let count = 0, after: string | null = null;
	for (;;) {
		const keys = await readKeys(store, after, declared.length - count);
		if (!keys.length) break;
		for (const key of keys) { if (key !== declared[count]?.id) throw new Error('Restore brush namespace contains a different body identity.'); count++; }
		after = keys[keys.length - 1]!;
	}
	if (count !== declared.length) throw new Error('Restore brush physical inventory count differs.');
}

async function verifyOwnedRow(value: unknown, resource: Readonly<PhotoCatalogArchiveMaskRasterResourceV6>, signal: AbortSignal): Promise<void> {
	const rawRow: unknown = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'value')?.value : undefined;
	const bytes: unknown = rawRow && typeof rawRow === 'object' ? Object.getOwnPropertyDescriptor(rawRow, 'bytes')?.value : undefined;
	if (Reflect.apply(TAG, bytes, []) !== 'Uint8Array') throw new TypeError('Restore brush row requires native bytes.');
	const buffer = Reflect.apply(BUFFER, bytes, []) as ArrayBuffer;
	try {
		const wrapper = record(value, 'restore brush wrapper', ['key', 'value']);
		if (field(wrapper, 'key') !== resource.id) throw new Error('Restore brush key differs.');
		const row = record(field(wrapper, 'value'), 'restore brush body', ['schemaVersion', 'kind', 'reference', 'bytes']);
		const reference = admitPhotoMediaRestoreMaskRasterReferenceV1(field(row, 'reference'));
		if (field(row, 'schemaVersion') !== 1 || field(row, 'kind') !== 'photo-mask-raster-body'
			|| JSON.stringify(reference) !== JSON.stringify(resource.reference)) throw new Error('Restore brush row/reference differs.');
		await withBrushMaskResourceV1({ reference: resource.reference, bytes, signal }, () => undefined);
	} finally { if (Reflect.apply(SIZE, buffer, []) > 0) Reflect.apply(FILL, bytes, [0]); }
}

function readKeys(store: IDBObjectStore, after: string | null, remaining: number): Promise<readonly string[]> {
	return new Promise((resolve, reject) => {
		const keys: string[] = [], opening = store.openKeyCursor(IDBKeyRange.bound(after ?? PREFIX, `${PREFIX}\uffff`, after !== null, true));
		opening.onerror = () => { reject(opening.error ?? new Error('Could not audit brush namespace.')); };
		opening.onsuccess = () => {
			const cursor = opening.result; if (!cursor) { resolve(keys); return; }
			const key = cursor.primaryKey;
			if (typeof key !== 'string' || key.length > 1024 || (after !== null && key <= after)
				|| (keys.length && key <= keys[keys.length - 1]!) || keys.length >= remaining) {
				reject(new Error('Restore brush namespace contains excess or malformed identities.')); return;
			}
			try { normalizeBrushMaskResourceReferenceV1(key); } catch (error) { reject(error); return; }
			keys.push(key); if (keys.length === 64) resolve(keys); else cursor.continue();
		};
	});
}
