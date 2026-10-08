/* SPDX-License-Identifier: AGPL-3.0-only */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { PhotoSmartCollectionV1 } from './photo-smart-collection-v1.ts';
import { readPhotoSavedQueryContinuationV1, type PhotoSavedQueryContinuationV1 } from './photo-smart-collection-query-types-v1.ts';

type Progress = Omit<PhotoSavedQueryContinuationV1, 'progressSha256'>;
const keys = new WeakMap<IDBDatabase, Uint8Array>();
function signature(database: IDBDatabase, progress: Progress): string {
	let key = keys.get(database);
	if (!key) { key = crypto.getRandomValues(new Uint8Array(32)); keys.set(database, key); }
	return bytesToHex(hmac(sha256, key, new TextEncoder().encode(JSON.stringify(progress))));
}
/** The whole saved selection and physical progress share one issuing-connection authority. */
export function issuePhotoSavedQueryProgressV1(database: IDBDatabase, progress: Progress): PhotoSavedQueryContinuationV1 {
	const normalized = readPhotoSavedQueryContinuationV1({ ...progress, progressSha256: '0'.repeat(64) }, progress.catalogId, progress.collectionId, progress.mode);
	const { progressSha256: _placeholder, ...body } = normalized;
	return Object.freeze({ ...body, progressSha256: signature(database, body) });
}
export function authenticatePhotoSavedQueryProgressV1(database: IDBDatabase, continuation: PhotoSavedQueryContinuationV1 | null): void {
	if (!continuation) return;
	const { progressSha256, ...body } = continuation;
	if (signature(database, body) !== progressSha256) throw new TypeError('Saved query progress signature authentication failed.');
}
export function photoSavedDefinitionDigestV1(value: PhotoSmartCollectionV1): string {
	return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
}
