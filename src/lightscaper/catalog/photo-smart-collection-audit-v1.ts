/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readValidatedPhotoCatalogRootV1 } from './documents.ts';
import { assertPhotoStackQuerySignalV1, withPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1 } from './photo-smart-collection-record-v1.ts';
import { photoSmartCollectionAuditContextDigestV1, scanPhotoSmartCollectionStorageV1 } from './photo-smart-collection-audit-kernel.ts';
import type { PhotoSmartCollectionStorageContextV1 } from './photo-smart-collection-storage-v1.ts';
import { PhotoCatalogRevisionConflictError } from './repository-types.ts';
import { field, integer, record } from './value-validation.ts';

export { PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1 } from './photo-smart-collection-audit-kernel.ts';
declare const auditBrand: unique symbol;
export interface PhotoSmartCollectionStorageAuditV1 { readonly [auditBrand]: true }
interface Binding { readonly database: IDBDatabase; readonly contextDigest: string; readonly validationDigest: string }
const proofs = new WeakMap<object, Binding>();

/** Only this writer wrapper can issue a database/candidate-bound single-use proof. */
export async function auditPhotoSmartCollectionStorageV1(database: IDBDatabase, validationRoot: unknown,
	options: unknown): Promise<PhotoSmartCollectionStorageAuditV1> {
	const input = record(options, 'smart collection audit options', ['expectedCatalogRevision', 'signal', 'retainedBytes'], ['expectedCatalogRevision']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const retainedBytes = Object.hasOwn(input, 'retainedBytes') ? integer(field(input, 'retainedBytes'), 0,
		PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes, 'retained caller bytes') : 0;
	const chosen = readValidatedPhotoCatalogRootV1(validationRoot);
	const expected = integer(field(input, 'expectedCatalogRevision'), 0, Number.MAX_SAFE_INTEGER, 'expected catalog revision');
	if (chosen.revision !== expected) throw new PhotoCatalogRevisionConflictError('catalog');
	const validationDigest = digest(chosen);
	return withPhotoStackQuerySignalV1(signal, async privateSignal => {
		const contextDigest = await scanPhotoSmartCollectionStorageV1(database, { catalogId: chosen.id, validationRoot: chosen,
			expectedRevision: expected, retainedBytes, signal: privateSignal });
		const proof = Object.freeze({}) as PhotoSmartCollectionStorageAuditV1;
		proofs.set(proof, { database, contextDigest, validationDigest });
		return proof;
	});
}

/** The final RW transaction supplies fresh context; archive sources never grant write authority. */
export function assertPhotoSmartCollectionStorageAuditV1(audit: unknown, database: IDBDatabase,
	context: PhotoSmartCollectionStorageContextV1, validationRoot: unknown): void {
	const binding = typeof audit === 'object' && audit !== null ? proofs.get(audit) : undefined;
	if (!binding || binding.database !== database) throw new TypeError('Invalid, consumed or foreign smart collection audit.');
	if (binding.validationDigest !== digest(readValidatedPhotoCatalogRootV1(validationRoot))) throw new TypeError('Smart collection audit belongs to another root candidate.');
	if (binding.contextDigest !== photoSmartCollectionAuditContextDigestV1(context)) throw new PhotoCatalogRevisionConflictError('catalog');
	proofs.delete(audit as object);
}
function digest(value: unknown): string { return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value)))); }
