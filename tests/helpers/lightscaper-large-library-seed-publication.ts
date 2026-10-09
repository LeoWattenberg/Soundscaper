/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray } from '../../src/common/editor/closed-domain-value.ts';
import { request } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { catalogTransaction } from '../../src/lightscaper/catalog/catalog-transaction.ts';
import { readValidatedPhotoCatalogRootV1 } from '../../src/lightscaper/catalog/documents.ts';
import { photoCatalogRestorePhotoRecordsV1 } from '../../src/lightscaper/catalog/photo-catalog-restore-records-v1.ts';
import { indexState, readIndexState } from '../../src/lightscaper/catalog/repository-records.ts';
import { PHOTO_CATALOG_STORES, PHOTO_CATALOG_REPOSITORY_LIMITS } from '../../src/lightscaper/catalog/repository-types.ts';
import { readPhotoQueryBuildStateV1 } from '../../src/lightscaper/catalog/photo-query-index-v1.ts';
import { readPhotoQueryBuildStateV2 } from '../../src/lightscaper/catalog/photo-query-index-storage-v2.ts';
import { PHOTO_LARGE_LIBRARY_SPECIFICATION_V1 as SPEC } from '../../src/lightscaper/quality/large-library-workload-v1.ts';
import type { PhotoDocumentV1 } from '../../src/lightscaper/catalog/types.ts';

const pending = new WeakSet<IDBDatabase>();
const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;

/**
 * Test-only seed assembly after genuine managed original publication. Every
 * batch still retains custody and publishes at most sixteen photos atomically.
 * No production import/verification authority is cached or substituted. Source
 * and derived payload accounting is not a whole-heap/native-storage bound.
 */
export async function publishLargePhotoLibrarySeedBatchV1(database: IDBDatabase, rootValue: unknown,
	values: readonly unknown[], retain: (photos: readonly PhotoDocumentV1[]) => Promise<void>) {
	if (pending.has(database)) throw new Error('A seed publication is pending.');
	pending.add(database);
	try {
		const nativeTransaction = database.transaction.bind(database);
		if (typeof retain !== 'function') throw new TypeError('Seed publication requires custody retention.');
		const root = readValidatedPhotoCatalogRootV1(rootValue);
		const inputs = readClosedDomainArray(values, 'native seed photos', 1, SPEC.publicationBatchSize);
		const packets = inputs.map(value => photoCatalogRestorePhotoRecordsV1(root, value));
		const keys = new Set<string>(); let membershipWrites = 0;
		for (const packet of packets) {
			const photo = packet.photo.document, original = photo.original;
			if (photo.revision !== 0 || bytes(photo) > SPEC.maximumDocumentBytes || packet.queryV1 === null
				|| original.width !== SPEC.width || original.height !== SPEC.height || original.byteLength !== SPEC.sourceByteLength
				|| original.contentSha256 !== SPEC.sourceSha256 || original.mimeType !== 'image/png' || original.retention !== 'managed') {
				throw new RangeError('Seed publication requires bounded pinned initial photos.');
			}
			if (keys.has(packet.photo.key)) throw new RangeError('Seed publication requires distinct photo IDs.');
			keys.add(packet.photo.key); membershipWrites += packet.memberships.length;
		}
		if (membershipWrites > PHOTO_CATALOG_REPOSITORY_LIMITS.maximumMembershipWrites) throw new RangeError('Seed memberships exceed their publication bound.');
		const next = readValidatedPhotoCatalogRootV1({ ...root, revision: root.revision + 1, photoCount: root.photoCount + packets.length });
		let admittedBytes = bytes(root) + bytes(next);
		for (const packet of packets) for (const value of [packet.photo, packet.summary, packet.queryV1, packet.queryV2, ...packet.memberships]) admittedBytes += bytes(value);
		if (admittedBytes > PHOTO_CATALOG_REPOSITORY_LIMITS.maximumImportBytes) throw new RangeError('Seed publication exceeds its source/projection byte bound.');
		// Captured callback owns the same per-batch custody operation as the old fixture.
		await retain(Object.freeze(packets.map(packet => packet.photo.document)));
		const port = { transaction: nativeTransaction } as IDBDatabase;
		let pointReads = 0, nativeWrites = 0;
		const result = await catalogTransaction(port, PHOTO_CATALOG_STORES, 'readwrite', async stores => {
			const get = (store: string) => { pointReads++; return request(stores[store].get(root.id)) as Promise<unknown>; };
			const [rootRaw, indexRaw, build1Raw, build2Raw] = await Promise.all([
				get('catalogs'), get('catalogStates'), get('photoQueryBuildStates'), get('photoQueryBuildStatesV2'),
			]);
			const current = readValidatedPhotoCatalogRootV1(rootRaw), state = readIndexState(indexRaw);
			if (JSON.stringify(current) !== JSON.stringify(root) || state.id !== root.id
				|| state.rootRevision !== root.revision || state.photoCount !== root.photoCount) throw new RangeError('Seed publication context changed.');
			const build1 = readPhotoQueryBuildStateV1(build1Raw, root.id), build2 = readPhotoQueryBuildStateV2(build2Raw, root.id);
			for (const build of [build1, build2]) if (!build.ready || build.afterKey !== null || build.indexedCount !== root.photoCount) {
				throw new RangeError('Seed publication requires complete paired query indexes.');
			}
			const nextState = indexState(next, state.indexRevision + 1);
			const nextBuild1 = readPhotoQueryBuildStateV1({ ...build1, indexedCount: next.photoCount }, root.id);
			const nextBuild2 = readPhotoQueryBuildStateV2({ ...build2, indexedCount: next.photoCount }, root.id);
			admittedBytes += bytes(nextState) + bytes(nextBuild1) + bytes(nextBuild2);
			if (admittedBytes > PHOTO_CATALOG_REPOSITORY_LIMITS.maximumImportBytes) throw new RangeError('Seed publication control rows exceed the byte bound.');
			const writes: Promise<unknown>[] = [];
			const add = (store: string, value: unknown) => { nativeWrites++; writes.push(request(stores[store].add(value))); };
			const put = (store: string, value: unknown) => { nativeWrites++; writes.push(request(stores[store].put(value))); };
			for (const packet of packets) {
				add('photos', packet.photo); add('summaries', packet.summary);
				add('photoQueryRows', packet.queryV1); add('photoQueryRowsV2', packet.queryV2);
				for (const membership of packet.memberships) add('memberships', membership);
			}
			put('catalogs', next); put('catalogStates', nextState);
			put('photoQueryBuildStates', nextBuild1); put('photoQueryBuildStatesV2', nextBuild2);
			await Promise.all(writes); return next;
		});
		return Object.freeze({ root: result, trace: Object.freeze({ photos: packets.length, maximumResidentPhotos: packets.length,
			nativeTransactions: 1, pointReads, nativeWrites, admittedBytes, getAllRequests: 0, cursorRequests: 0 }) });
	} finally { pending.delete(database); }
}
