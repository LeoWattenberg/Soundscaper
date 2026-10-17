/* SPDX-License-Identifier: AGPL-3.0-only */

import { id } from './value-validation.ts';
import { PHOTO_STACK_QUERY_LIMITS_V1, type PhotoStackQueryAuditV1 } from './photo-stack-query-types-v1.ts';

/** Key-only count authentication never calls the native whole-index count operation. */
export function auditPhotoStackQueryCountV1(store: IDBObjectStore, catalogId: string, expectedCount: number,
	previous: PhotoStackQueryAuditV1 | null): Promise<Readonly<{ scanned: number; continuation: PhotoStackQueryAuditV1 | null }>> {
	return new Promise((resolve, reject) => {
		let scanned = 0, count = previous?.count ?? 0;
		const afterKey = previous?.afterKey ?? null, prefix = `${catalogId}|`;
		const cursor = store.openKeyCursor(IDBKeyRange.bound(afterKey ?? prefix, `${prefix}\uffff`, afterKey !== null, true));
		cursor.onerror = () => reject(cursor.error ?? new Error('Could not authenticate stack count.'));
		cursor.onsuccess = () => {
			try {
				const current = cursor.result;
				if (!current) {
					if (count !== expectedCount) throw new TypeError('Collapsed query stack record count differs from its grouping state.');
					resolve(Object.freeze({ scanned, continuation: null })); return;
				}
				const key = current.primaryKey;
				if (current.key !== key || typeof key !== 'string' || !key.startsWith(prefix)
					|| key !== prefix + id(key.slice(prefix.length), 'audited stack ID')) throw new TypeError('Audited stack key has another catalog identity.');
				scanned++; count++;
				if (count > expectedCount) throw new TypeError('Collapsed query stack record count exceeds its grouping state.');
				if (scanned === PHOTO_STACK_QUERY_LIMITS_V1.candidates) {
					resolve(Object.freeze({ scanned, continuation: Object.freeze({ afterKey: key, count }) })); return;
				}
				current.continue();
			} catch (error) { reject(error); }
		};
	});
}
