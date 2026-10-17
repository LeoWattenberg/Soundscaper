/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_STACK_LIMITS_V1, normalizePhotoStackStateV1, normalizePhotoStackV1 } from '../catalog/photo-stack-v1.ts';
import type { PhotoStackV1 } from '../catalog/photo-stack-v1.ts';
import type { PhotoStackContinuationV1 } from '../catalog/photo-stack-repository-v1.ts';
import type { PhotoCatalogRepositoryV1 } from '../catalog/repository.ts';
import type { PhotoCatalogSnapshotV1 } from '../catalog/repository-snapshot.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { array, field, id, integer, record } from '../catalog/value-validation.ts';

export type PhotoLibraryBackupStackPortsV1 = Pick<PhotoCatalogRepositoryV1, 'readStackState' | 'readStackPage' | 'loadStack'>;

/** Capture grouping before originals; retain scalar pages and load one explicit stack at a time. */
export async function capturePhotoLibraryBackupStacksV1(initial: PhotoCatalogSnapshotV1, ports: PhotoLibraryBackupStackPortsV1,
	verifyCatalog: () => Promise<void>, signal?: AbortSignal): Promise<AsyncIterable<PhotoStackV1>> {
	const catalogId = initial.catalog.id;
	const captured = normalizePhotoStackStateV1(await ports.readStackState(catalogId, { signal })); signal?.throwIfAborted();
	if (captured.catalogId !== catalogId || captured.stackCount > Math.floor(initial.catalog.photoCount / 2)) {
		throw new TypeError('Photo backup stack state disagrees with its catalog.');
	}
	return stacks();

	async function* stacks() {
		let continuation: PhotoStackContinuationV1 | null = null, count = 0, pageCount = 0;
		const maximumPages = Math.floor(captured.stackCount / PHOTO_STACK_LIMITS_V1.pageSize) + 1;
		do {
			signal?.throwIfAborted();
			if (++pageCount > maximumPages) throw new RangeError('Photo backup stack enumeration exceeds its page count.');
			const page = record(await ports.readStackPage(catalogId, { continuation, signal }), 'photo backup stack page', ['items', 'continuation']);
			signal?.throwIfAborted();
			const items = array(field(page, 'items'), 'photo backup stack summaries', 0, PHOTO_STACK_LIMITS_V1.pageSize);
			let previousKey: string = continuation?.afterKey ?? '';
			for (const value of items) {
				const summary = record(value, 'photo backup stack summary', ['catalogId', 'id', 'revision', 'photoCount', 'coverPhotoId']);
				const stackId = id(field(summary, 'id'), 'backup stack ID'), key = `${catalogId}|${stackId}`;
				const revision = integer(field(summary, 'revision'), 0, Number.MAX_SAFE_INTEGER, 'backup stack revision');
				const photoCount = integer(field(summary, 'photoCount'), 2, PHOTO_STACK_LIMITS_V1.maximumPhotos, 'backup stack photo count');
				const cover = id(field(summary, 'coverPhotoId'), 'backup stack cover');
				if (field(summary, 'catalogId') !== catalogId || key <= previousKey) throw new TypeError('Photo backup stack summary order or identity differs from its page.');
				previousKey = key;
				if (++count > captured.stackCount) throw new RangeError('Photo backup stack enumeration exceeds its captured count.');
				const loaded = await ports.loadStack(catalogId, stackId, { signal }); signal?.throwIfAborted();
				if (loaded === null) throw new ReferenceError('The photo backup stack is missing.');
				const stack = normalizePhotoStackV1(loaded);
				if (stack.catalogId !== catalogId || stack.id !== stackId || stack.revision !== revision
					|| stack.photoIds.length !== photoCount || stack.coverPhotoId !== cover) throw new PhotoCatalogRevisionConflictError('catalog');
				yield stack;
			}
			const raw = field(page, 'continuation');
			if (raw === null) { continuation = null; }
			else {
				const cursor = record(raw, 'photo backup stack continuation', ['catalogId', 'scope', 'catalogRevision', 'indexRevision', 'stateRevision', 'afterKey']);
				if (items.length !== PHOTO_STACK_LIMITS_V1.pageSize || field(cursor, 'catalogId') !== catalogId
					|| field(cursor, 'scope') !== 'stacks' || field(cursor, 'catalogRevision') !== initial.catalog.revision
					|| field(cursor, 'indexRevision') !== initial.indexRevision || field(cursor, 'stateRevision') !== captured.revision
					|| field(cursor, 'afterKey') !== previousKey) throw new PhotoCatalogRevisionConflictError('catalog');
				continuation = Object.freeze({ catalogId, scope: 'stacks', catalogRevision: initial.catalog.revision,
					indexRevision: initial.indexRevision, stateRevision: captured.revision, afterKey: previousKey });
			}
		} while (continuation !== null);
		if (count !== captured.stackCount) throw new RangeError('Photo backup stack enumeration differs from its captured count.');
		const current = normalizePhotoStackStateV1(await ports.readStackState(catalogId, { signal })); signal?.throwIfAborted();
		if (JSON.stringify(current) !== JSON.stringify(captured)) throw new PhotoCatalogRevisionConflictError('catalog');
		await verifyCatalog();
	}
}
