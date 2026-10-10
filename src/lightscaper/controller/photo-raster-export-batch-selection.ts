/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainRecord as record, readClosedDomainField as field } from '../../common/editor/closed-domain-value.ts';
import type { ExecutePhotoDevelopV2 as ExecutePhotoDevelopCurrent } from '../../common/editor/controller/shared/photo-library-develop-workflow-v2.ts';

export interface PhotoRasterBatchSelection { readonly photoId: string; readonly fileName: string; }
export interface PreparedPhotoRasterBatchSelection {
	readonly catalogId: string;
	readonly members: readonly Readonly<{ photoId: string; versionId: string; expectedRevision: number; sourceFileName: string }>[];
}

/** One visible page, detached synchronously in the menu gesture. */
export function capturePhotoRasterBatchSelection(value: unknown): readonly Readonly<PhotoRasterBatchSelection>[] {
	const seen = new Set<string>();
	return Object.freeze(array(value, 'Selected photo export', 1, 64).map(value => {
		const item = record(value, 'Selected photo export', ['photoId', 'fileName']);
		const photoId = identity(field(item, 'photoId', 'Selected photo export'));
		const fileName = field(item, 'fileName', 'Selected photo export');
		if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 512) throw new TypeError('Selected photo export requires a bounded filename.');
		if (seen.has(photoId)) throw new RangeError('Selected photo export repeats a photo.');
		seen.add(photoId); return Object.freeze({ photoId, fileName });
	}));
}

/** Existing executeDevelop owns the catalog generation and joins borrowed reads.
 * This captures scalar active-version admission, never original/LUT authority. */
export async function preparePhotoRasterBatchSelection(value: unknown, execute: ExecutePhotoDevelopCurrent, signal: AbortSignal): Promise<Readonly<PreparedPhotoRasterBatchSelection>> {
	const selection = capturePhotoRasterBatchSelection(value);
	let catalogId: string | null = null;
	const members: PreparedPhotoRasterBatchSelection['members'][number][] = [];
	const outcome = await execute(async context => {
		context.signal.throwIfAborted(); signal.throwIfAborted();
		if (!context.isCurrent()) throw new DOMException('Photo export catalog changed.', 'AbortError');
		const port = await context.acquire(), read = port.read;
		if (port.schemaVersion !== 2 || typeof read !== 'function') throw new TypeError('Photo export requires current develop reads.');
		for (const selected of selection) {
			context.signal.throwIfAborted(); signal.throwIfAborted();
			const snapshot: unknown = await Reflect.apply(read, port, [{ schemaVersion: 2, photoId: selected.photoId }, { signal: context.signal }]);
			context.signal.throwIfAborted(); signal.throwIfAborted();
			if (!context.isCurrent()) throw new DOMException('Photo export catalog changed.', 'AbortError');
			// Read only admitted own scalar fields; accessors cannot stand in for publication.
			const own = (key: string): unknown => {
				const descriptor = Object.getOwnPropertyDescriptor(snapshot, key);
				if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Photo export snapshot requires own scalar fields.');
				return descriptor.value;
			};
			const catalog = identity(own('catalogId')), versionId = identity(own('versionId')), revision = own('revision');
			if (own('schemaVersion') !== 2 || own('photoId') !== selected.photoId || own('activeVersionId') !== versionId
				|| typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || (catalogId !== null && catalogId !== catalog)) {
				throw new RangeError('Selected photo export publication changed.');
			}
			catalogId = catalog;
			members.push(Object.freeze({ photoId: selected.photoId, versionId, expectedRevision: revision, sourceFileName: selected.fileName }));
		}
	}, signal);
	signal.throwIfAborted();
	if (outcome !== 'completed' || catalogId === null || members.length !== selection.length) throw new DOMException('Photo export catalog changed.', 'AbortError');
	return Object.freeze({ catalogId, members: Object.freeze(members) });
}
function identity(value: unknown): string {
	if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) throw new TypeError('Photo export requires stable identity.');
	return value;
}
