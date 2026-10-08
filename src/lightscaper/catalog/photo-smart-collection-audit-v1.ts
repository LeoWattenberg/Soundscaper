/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { readValidatedPhotoCatalogRootV1 } from './documents.ts';
import { assertNotAborted, catalogTransaction } from './catalog-transaction.ts';
import { assertPhotoStackQuerySignalV1, withPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1, photoSmartCollectionKeyV1, readPhotoSmartCollectionRecordV1 } from './photo-smart-collection-record-v1.ts';
import { PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, readPhotoSmartCollectionStorageContextV1,
	readPhotoSmartCollectionSummaryRecordV1, type PhotoSmartCollectionStorageContextV1 } from './photo-smart-collection-storage-v1.ts';
import { PHOTO_SMART_COLLECTION_LIMITS_V1 } from './photo-smart-collection-v1.ts';
import { PhotoCatalogRevisionConflictError } from './repository-types.ts';
import { array, field, id, integer, oneOf, record } from './value-validation.ts';
import type { PhotoCatalogRootV1 } from './types.ts';

export const PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1 = Object.freeze({ maximumPageBytes: 8_388_608,
	maximumDefinitions: 10, maximumKeys: 64, reservedScalarBytes: 524_288 });
declare const auditBrand: unique symbol;
export interface PhotoSmartCollectionStorageAuditV1 { readonly [auditBrand]: true }
interface Binding { readonly database: IDBDatabase; readonly contextDigest: string; readonly validationDigest: string }
const proofs = new WeakMap<object, Binding>();
const phases = ['definitions', 'summaries', 'definition-index', 'summary-index'] as const;
type Phase = typeof phases[number];
type Stores = Readonly<Record<string, IDBObjectStore>>;
interface Progress { afterKey: string | null; count: number }
const encoder = new TextEncoder();
const maximumPairBytes = PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes + PHOTO_SMART_COLLECTION_LIMITS_V1.maximumSummaryBytes;

/**
 * Private progress owns one chosen root, one current root and one normalized
 * definition. Charge both roots, cumulative canonical source rows, normalized
 * record scratch (603424), caller-declared retained bytes, and 512KiB scalar/key
 * scratch per transaction. A maximum retained caller record permits four maximal
 * pairs; without it, five fit below the same hard transaction bound.
 * Maximal roots permit five maximal pairs: 8359616 < 8388608 bytes. Smaller
 * records can reach ten. This serialized-equivalent bound excludes engine/RSS.
 */
export async function auditPhotoSmartCollectionStorageV1(database: IDBDatabase, validationRoot: unknown,
	options: unknown): Promise<PhotoSmartCollectionStorageAuditV1> {
	const input = record(options, 'smart collection audit options', ['expectedCatalogRevision', 'signal', 'retainedBytes'], ['expectedCatalogRevision']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const retainedBytes = Object.hasOwn(input, 'retainedBytes') ? integer(field(input, 'retainedBytes'), 0,
		PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes, 'retained caller bytes') : 0;
	const chosen = readRoot(validationRoot);
	const expected = integer(field(input, 'expectedCatalogRevision'), 0, Number.MAX_SAFE_INTEGER, 'expected catalog revision');
	if (chosen.revision !== expected) throw new PhotoCatalogRevisionConflictError('catalog');
	const chosenBytes = byteLength(chosen), validationDigest = digest(chosen);
	return withPhotoStackQuerySignalV1(signal, async privateSignal => {
		let captured: string | null = null;
		for (const phase of phases) {
			const progress: Progress = { afterKey: null, count: 0 };
			let done = false;
			while (!done) {
				assertNotAborted(privateSignal);
				done = await catalogTransaction(database, PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, 'readonly', async stores => {
					const context = await readPhotoSmartCollectionStorageContextV1(stores, chosen.id, privateSignal);
					if (context.root.revision !== expected) throw new PhotoCatalogRevisionConflictError('catalog');
					if (context.root.photoCount !== chosen.photoCount) throw new RangeError('Only photo publication changes the catalog photo count.');
					const current = contextDigest(context);
					if (captured !== null && captured !== current) throw new PhotoCatalogRevisionConflictError('catalog');
					captured = current;
					if (chosen.collections.length + context.state.collectionCount > PHOTO_SMART_COLLECTION_LIMITS_V1.maximumCollections) {
						throw new RangeError('Combined collection count exceeds its 10000 collection budget.');
					}
					const baseBytes = chosenBytes + byteLength(context.root) + byteLength(context.index) + byteLength(context.state)
						+ PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes + retainedBytes + PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1.reservedScalarBytes;
					return auditPage(stores, phase, progress, context.state.collectionCount, chosen, baseBytes, privateSignal);
				}, privateSignal);
				assertNotAborted(privateSignal);
				if (!done) await new Promise<void>(resolve => setTimeout(resolve, 0));
			}
		}
		assertNotAborted(privateSignal);
		if (captured === null) throw new Error('Smart collection audit did not capture authority.');
		const proof = Object.freeze({}) as PhotoSmartCollectionStorageAuditV1;
		proofs.set(proof, { database, contextDigest: captured, validationDigest });
		return proof;
	});
}

/** The owning final RW transaction supplies its fresh context; no public cursor grants write authority. */
export function assertPhotoSmartCollectionStorageAuditV1(audit: unknown, database: IDBDatabase,
	context: PhotoSmartCollectionStorageContextV1, validationRoot: unknown): void {
	const binding = typeof audit === 'object' && audit !== null ? proofs.get(audit) : undefined;
	if (!binding || binding.database !== database) throw new TypeError('Invalid, consumed or foreign smart collection audit.');
	if (binding.validationDigest !== digest(readRoot(validationRoot))) throw new TypeError('Smart collection audit belongs to another root candidate.');
	if (binding.contextDigest !== contextDigest(context)) throw new PhotoCatalogRevisionConflictError('catalog');
	proofs.delete(audit as object);
}

function auditPage(stores: Stores, phase: Phase, progress: Progress, expectedCount: number,
	root: PhotoCatalogRootV1, baseBytes: number, signal?: AbortSignal): Promise<boolean> {
	const indexed = phase.endsWith('index'), definitions = phase === 'definitions' || phase === 'definition-index';
	const store = definitions ? stores.photoSmartCollections : stores.photoSmartCollectionSummaries;
	const prefix = JSON.stringify([root.id]).slice(0, -1) + ',';
	const source = indexed ? store.index('catalogId') : store;
	const query = indexed ? root.id : IDBKeyRange.bound(progress.afterKey ?? prefix, prefix + '\uffff', progress.afterKey !== null, true);
	const cursor = source.openKeyCursor(query);
	let delivered = 0, processed = 0, chargedBytes = baseBytes;
	return new Promise((resolve, reject) => {
		cursor.onerror = () => reject(cursor.error ?? new Error('Could not audit smart collection keys.'));
		cursor.onsuccess = () => {
			const current = cursor.result;
			if (!current) {
				if (progress.count !== expectedCount) reject(new TypeError('Smart collection record count differs from its state.'));
				else resolve(true);
				return;
			}
			void visit(current).catch(reject);
		};
		async function visit(current: IDBCursor): Promise<void> {
			assertNotAborted(signal);
			delivered++;
			const key = readScopedKey(current.primaryKey, root.id);
			if (indexed) {
				if (current.key !== root.id) throw new TypeError('Smart collection index belongs to another scope.');
				if (typeof current.continuePrimaryKey !== 'function') throw new TypeError('Bounded index seeking requires native continuePrimaryKey.');
				if (progress.afterKey !== null && key <= progress.afterKey) {
					if (delivered >= PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1.maximumKeys) throw new Error('Bounded index seeking made no progress.');
					current.continuePrimaryKey(root.id, progress.afterKey + '\u0000'); return;
				}
			} else if (current.key !== key) throw new TypeError('Smart collection primary cursor identity differs.');
			const allowance = indexed ? 4096 : definitions ? maximumPairBytes : PHOTO_SMART_COLLECTION_LIMITS_V1.maximumSummaryBytes;
			if (chargedBytes + allowance > PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1.maximumPageBytes) {
				if (processed === 0) throw new RangeError('Smart collection audit page cannot admit one record.');
				resolve(false); return;
			}
			if (++progress.count > expectedCount) throw new TypeError('Smart collection record count exceeds its state.');
			if (indexed) chargedBytes += byteLength(key);
			else if (definitions) chargedBytes += await auditDefinition(stores, root, key, signal);
			else {
				const raw: unknown = await request(store.get(key)); assertNotAborted(signal);
				const summary = readPhotoSmartCollectionSummaryRecordV1(raw, root.id, key);
				chargedBytes += byteLength({ key, catalogId: root.id, document: summary });
			}
			progress.afterKey = key; processed++;
			assertNotAborted(signal);
			if (delivered >= PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1.maximumKeys
				|| phase === 'definitions' && processed >= PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1.maximumDefinitions) resolve(false);
			else current.continue();
		}
	});
}

async function auditDefinition(stores: Stores, root: PhotoCatalogRootV1, key: string, signal?: AbortSignal): Promise<number> {
	const raw: unknown = await request(stores.photoSmartCollections.get(key)); assertNotAborted(signal);
	const document = readPhotoSmartCollectionRecordV1(raw, root.id, key);
	if (hasId(root.collections, document.id)) throw new TypeError('Root and saved collection IDs must be disjoint.');
	const input = record(raw, 'audited smart collection', ['key', 'catalogId', 'referenceKeys', 'document']);
	const references = array(field(input, 'referenceKeys'), 'audited smart collection references', 0, PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumReferenceKeys);
	// Full record admission authenticated this projection against every AST branch.
	for (const reference of references) {
		if (typeof reference !== 'string') throw new TypeError('Invalid authenticated reference.');
		const tuple = array(JSON.parse(reference) as unknown, 'audited reference', 3, 3);
		const kind = oneOf(tuple[1], ['folder', 'keyword', 'collection'] as const, 'audited reference kind');
		const referenceId = id(tuple[2], 'audited reference ID');
		if (tuple[0] !== root.id || !hasId(kind === 'folder' ? root.folders : kind === 'keyword' ? root.keywords : root.collections, referenceId)) {
			throw new ReferenceError('Saved collection references a missing catalog definition.');
		}
	}
	const rawSummary: unknown = await request(stores.photoSmartCollectionSummaries.get(key)); assertNotAborted(signal);
	const summary = readPhotoSmartCollectionSummaryRecordV1(rawSummary, root.id, key);
	if (summary.revision !== document.revision || summary.name !== document.name) throw new TypeError('Saved collection summary differs from its definition.');
	return byteLength({ key, catalogId: root.id, referenceKeys: references, document })
		+ byteLength({ key, catalogId: root.id, document: summary });
}

function hasId(values: readonly Readonly<{ id: string }>[], target: string): boolean {
	let lower = 0, upper = values.length;
	while (lower < upper) {
		const middle = Math.floor((lower + upper) / 2), value = values[middle]!;
		if (value.id === target) return true;
		if (value.id < target) lower = middle + 1; else upper = middle;
	}
	return false;
}
function readScopedKey(value: unknown, catalogId: string): string {
	if (typeof value !== 'string' || value.length > 263) throw new TypeError('Smart collection key must be a bounded tuple.');
	const tuple = array(JSON.parse(value) as unknown, 'audited collection key', 2, 2);
	if (tuple[0] !== catalogId || value !== photoSmartCollectionKeyV1(catalogId, id(tuple[1], 'audited collection ID'))) {
		throw new TypeError('Smart collection physical key belongs to another catalog or is not canonical.');
	}
	return value;
}
function readRoot(value: unknown): PhotoCatalogRootV1 {
	return readValidatedPhotoCatalogRootV1(value);
}
function byteLength(value: unknown): number { return encoder.encode(JSON.stringify(value)).byteLength; }
function digest(value: unknown): string { return bytesToHex(sha256(encoder.encode(JSON.stringify(value)))); }
function contextDigest(context: PhotoSmartCollectionStorageContextV1): string { return digest(context); }
