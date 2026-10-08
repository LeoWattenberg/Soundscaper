/* SPDX-License-Identifier: AGPL-3.0-only */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readPhotoStackQueryContinuationV2, type PhotoStackQueryContinuationV2 } from './photo-stack-query-types-v2.ts';
import type { PhotoCatalogQueryV2 } from './photo-query-types-v2.ts';

type Progress = Omit<PhotoStackQueryContinuationV2, 'progressSha256'>;
const keys = new WeakMap<IDBDatabase, Uint8Array>();

/** Bounded V2 signature authority belongs to the actual issuing connection, without retained query inventories. */
function signature(database: IDBDatabase, progress: Progress): string {
	let key = keys.get(database);
	if (!key) { key = crypto.getRandomValues(new Uint8Array(32)); keys.set(database, key); }
	return bytesToHex(hmac(sha256, key, new TextEncoder().encode(JSON.stringify(progress))));
}

export function issuePhotoStackQueryProgressV2(database: IDBDatabase, progress: Progress, query: PhotoCatalogQueryV2): PhotoStackQueryContinuationV2 {
	const normalized = readPhotoStackQueryContinuationV2({ ...progress, progressSha256: '0'.repeat(64) }, progress.catalogId, query);
	const { progressSha256: _placeholder, ...body } = normalized;
	return Object.freeze({ ...body, progressSha256: signature(database, body) });
}

export function authenticatePhotoStackQueryProgressV2(database: IDBDatabase, continuation: PhotoStackQueryContinuationV2 | null): void {
	if (!continuation) return;
	const { progressSha256, ...body } = continuation;
	if (signature(database, body) !== progressSha256) throw new TypeError('Collapsed query V2 progress signature authentication failed.');
}
