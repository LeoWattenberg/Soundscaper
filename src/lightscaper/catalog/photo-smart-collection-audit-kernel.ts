/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { assertNotAborted, catalogTransaction } from './catalog-transaction.ts';
import { PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1, photoSmartCollectionKeyV1, readPhotoSmartCollectionRecordV1 } from './photo-smart-collection-record-v1.ts';
import { PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, readPhotoSmartCollectionStorageContextV1,
	readPhotoSmartCollectionSummaryRecordV1, type PhotoSmartCollectionStorageContextV1 } from './photo-smart-collection-storage-v1.ts';
import { PHOTO_SMART_COLLECTION_LIMITS_V1 } from './photo-smart-collection-v1.ts';
import { PhotoCatalogRevisionConflictError } from './repository-types.ts';
import { array, field, id, oneOf, record } from './value-validation.ts';
import { LIGHTSCAPER_CATALOG_LIMITS, type PhotoCatalogRootV1 } from './types.ts';
import type { PhotoSmartCollectionV1 } from './photo-smart-collection-v1.ts';

export const PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1 = Object.freeze({ maximumPageBytes: 8_388_608,
	maximumDefinitions: 10, maximumKeys: 64, reservedScalarBytes: 524_288 });
const phases = ['definitions', 'summaries', 'definition-index', 'summary-index'] as const;
type Phase = typeof phases[number];
type Stores = Readonly<Record<string, IDBObjectStore>>;
interface Progress { afterKey: string | null; count: number }
const encoder = new TextEncoder();
const maximumPairBytes = PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes + PHOTO_SMART_COLLECTION_LIMITS_V1.maximumSummaryBytes;

/** Internal bounded inventory traversal. It grants no writer authority or public progress.
 * Archive callers reserve the owning ordinary snapshot root (2MiB), authenticate
 * physical state on every page, and retain only scalar digests across transactions. */
export interface PhotoSmartCollectionAuditScanV1 {
	readonly catalogId: string;
	readonly validationRoot: PhotoCatalogRootV1 | null;
	readonly expectedRevision: number;
	readonly retainedBytes: number;
	readonly signal?: AbortSignal;
	readonly onContext?: (stores: Stores, context: PhotoSmartCollectionStorageContextV1, signal?: AbortSignal) => Promise<void>;
	readonly onDefinition?: (document: PhotoSmartCollectionV1, raw: unknown) => void;
}
export async function scanPhotoSmartCollectionStorageV1(database: IDBDatabase,
	options: PhotoSmartCollectionAuditScanV1): Promise<string> {
	const { validationRoot: chosen, catalogId, expectedRevision: expected, retainedBytes, signal } = options;
	const chosenBytes = chosen === null ? LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes : byteLength(chosen);
	let captured: string | null = null;
	for (const phase of phases) {
		const progress: Progress = { afterKey: null, count: 0 };
		let done = false;
		while (!done) {
			assertNotAborted(signal);
			done = await catalogTransaction(database, PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, 'readonly', async stores => {
				const context = await readPhotoSmartCollectionStorageContextV1(stores, catalogId, signal);
				if (context.root.revision !== expected) throw new PhotoCatalogRevisionConflictError('catalog');
				if (chosen !== null && context.root.photoCount !== chosen.photoCount) throw new RangeError('Only photo publication changes the catalog photo count.');
				const current = photoSmartCollectionAuditContextDigestV1(context);
				if (captured !== null && captured !== current) throw new PhotoCatalogRevisionConflictError('catalog');
				captured = current;
				await options.onContext?.(stores, context, signal);
				const root = chosen ?? context.root;
				if (root.collections.length + context.state.collectionCount > PHOTO_SMART_COLLECTION_LIMITS_V1.maximumCollections) {
					throw new RangeError('Combined collection count exceeds its 10000 collection budget.');
				}
				const baseBytes = chosenBytes + byteLength(context.root) + byteLength(context.index) + byteLength(context.state)
					+ PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes + retainedBytes + PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1.reservedScalarBytes;
				return auditPage(stores, phase, progress, context.state.collectionCount, root, baseBytes, signal, options.onDefinition);
			}, signal);
			assertNotAborted(signal);
			if (!done) await new Promise<void>(resolve => setTimeout(resolve, 0));
		}
	}
	assertNotAborted(signal);
	if (captured === null) throw new Error('Smart collection audit did not capture authority.');
	return captured;
}

function auditPage(stores: Stores, phase: Phase, progress: Progress, expectedCount: number,
	root: PhotoCatalogRootV1, baseBytes: number, signal?: AbortSignal, onDefinition?: PhotoSmartCollectionAuditScanV1['onDefinition']): Promise<boolean> {
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
			const key = readPhotoSmartCollectionAuditKeyV1(current.primaryKey, root.id);
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
			else if (definitions) chargedBytes += (await readAuditedPhotoSmartCollectionV1(stores, root, key, signal, onDefinition)).byteLength;
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

export async function readAuditedPhotoSmartCollectionV1(stores: Stores, root: PhotoCatalogRootV1, key: string, signal?: AbortSignal,
	onDefinition?: PhotoSmartCollectionAuditScanV1['onDefinition']): Promise<Readonly<{ document: PhotoSmartCollectionV1; byteLength: number }>> {
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
	onDefinition?.(document, raw);
	return { document, byteLength: byteLength({ key, catalogId: root.id, referenceKeys: references, document })
		+ byteLength({ key, catalogId: root.id, document: summary }) };
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
export function readPhotoSmartCollectionAuditKeyV1(value: unknown, catalogId: string): string {
	if (typeof value !== 'string' || value.length > 263) throw new TypeError('Smart collection key must be a bounded tuple.');
	const tuple = array(JSON.parse(value) as unknown, 'audited collection key', 2, 2);
	if (tuple[0] !== catalogId || value !== photoSmartCollectionKeyV1(catalogId, id(tuple[1], 'audited collection ID'))) {
		throw new TypeError('Smart collection physical key belongs to another catalog or is not canonical.');
	}
	return value;
}
function byteLength(value: unknown): number { return encoder.encode(JSON.stringify(value)).byteLength; }
function digest(value: unknown): string { return bytesToHex(sha256(encoder.encode(JSON.stringify(value)))); }
export function photoSmartCollectionAuditContextDigestV1(context: PhotoSmartCollectionStorageContextV1): string { return digest(context); }
