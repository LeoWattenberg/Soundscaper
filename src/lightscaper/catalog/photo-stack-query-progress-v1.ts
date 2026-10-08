/* SPDX-License-Identifier: AGPL-3.0-only */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readPhotoStackQueryContinuationV1, type PhotoStackQueryContinuationV1 } from './photo-stack-query-types-v1.ts';
import type { PhotoCatalogQueryV1 } from './photo-query-types-v1.ts';

type Progress = Omit<PhotoStackQueryContinuationV1, 'progressSha256'>;
const keys = new WeakMap<IDBDatabase, Uint8Array>();

/** One bounded secret per issuing connection, without a retained query or catalog inventory. */
function key(database: IDBDatabase): Uint8Array {
	let current = keys.get(database);
	if (!current) { current = crypto.getRandomValues(new Uint8Array(32)); keys.set(database, current); }
	return current;
}
function signature(database: IDBDatabase, progress: Progress): string {
	return bytesToHex(hmac(sha256, key(database), new TextEncoder().encode(JSON.stringify(progress))));
}

export function issuePhotoStackQueryProgressV1(database: IDBDatabase, progress: Progress,
	query: PhotoCatalogQueryV1): PhotoStackQueryContinuationV1 {
	const normalized = readPhotoStackQueryContinuationV1({ ...progress, progressSha256: '0'.repeat(64) }, progress.catalogId, query);
	const { progressSha256: _placeholder, ...body } = normalized;
	return Object.freeze({ ...body, progressSha256: signature(database, body) });
}

export function authenticatePhotoStackQueryProgressV1(database: IDBDatabase, continuation: PhotoStackQueryContinuationV1 | null): void {
	if (!continuation) return;
	const { progressSha256, ...body } = continuation;
	if (signature(database, body) !== progressSha256) throw new TypeError('Collapsed query progress signature authentication failed.');
}
