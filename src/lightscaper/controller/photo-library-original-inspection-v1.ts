/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeCatalogOriginalRepairBindingV1, readCatalogOriginalRepairSignalV1,
	type CatalogOriginalRepairBindingV1 } from '../../common/editor/storage/media-catalog-original-repair-contract.ts';
import { catalogOriginalKey, normalizeCatalogOriginalRoot } from '../../common/editor/storage/media-catalog-original-schema.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import { array, field, id, integer, oneOf, record, text } from '../catalog/value-validation.ts';
import { normalizePhotoImportIntentV1, photoImportIntentKeyV1 } from '../import/import-intent-v1.ts';
import type { PhotoLibrarySessionPortsV1 } from './photo-library-session-ports.ts';

export type PhotoLibraryOriginalBodyInspectionV1 = Readonly<
	{ status: 'present' }
	| { status: 'missing'; reason: 'media-row' | 'directory' | 'file' | 'inline-blob' | 'chunk' }
	| { status: 'corrupt'; reason: 'size' | 'digest' }
	| { status: 'unsupported'; storage: string | null }
>;
export interface PhotoLibraryOriginalInspectionPortV1 {
	readonly inspect: (binding: CatalogOriginalRepairBindingV1, signal: AbortSignal) => Promise<PhotoLibraryOriginalBodyInspectionV1>;
}
export interface PhotoLibraryOriginalInspectionFailureV1 { readonly message: string }
export interface PhotoLibraryOriginalInspectionPageV1 {
	readonly schemaVersion: 1;
	readonly catalogId: string;
	readonly catalogName: string;
	readonly revision: number;
	readonly activeImportId: string | null;
	readonly startupFailure: PhotoLibraryOriginalInspectionFailureV1 | null;
	readonly rows: readonly Readonly<{ photoId: string; revision: number; fileName: string;
		binding: CatalogOriginalRepairBindingV1;
		inspection: PhotoLibraryOriginalBodyInspectionV1 }>[];
	readonly scanned: number;
	readonly cursor: string | null;
}
interface Cursor {
	readonly schemaVersion: 1; readonly catalogId: string; readonly revision: number;
	readonly importId: string | null; readonly phase: 'committed' | 'provisional'; readonly afterKey: string | null;
}
type Ports = Pick<PhotoLibrarySessionPortsV1, 'catalog' | 'journal' | 'media'> & { readonly originalInspection: PhotoLibraryOriginalInspectionPortV1 };

// One call admits64 scalar roots, one <=2MiB photo aggregate at a time, and a
// <=2MiB scalar result. No catalog snapshot or body bytes are materialized here.
const PAGE_SIZE = 64, MAXIMUM_PAGE_BYTES = 2 * 1024 ** 2, MAXIMUM_CURSOR_BYTES = 2048;
const domMessage = typeof DOMException === 'function' ? Object.getOwnPropertyDescriptor(DOMException.prototype, 'message')?.get : undefined;

export function admitPhotoLibraryOriginalInspectionRequestV1(value: unknown): Readonly<{ cursor: Cursor | null; signal?: AbortSignal }> {
	const input = record(value, 'original inspection request', ['cursor', 'signal'], []);
	const signal = readCatalogOriginalRepairSignalV1({ signal: Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined });
	const supplied = Object.hasOwn(input, 'cursor') ? field(input, 'cursor') : null;
	if (supplied === null || supplied === undefined) return Object.freeze({ cursor: null, signal });
	if (typeof supplied !== 'string' || new TextEncoder().encode(supplied).byteLength > MAXIMUM_CURSOR_BYTES) throw new RangeError('Original inspection cursor exceeds2KiB.');
	const cursor = record(JSON.parse(supplied) as unknown, 'original inspection cursor', ['schemaVersion', 'catalogId', 'revision', 'importId', 'phase', 'afterKey']);
	if (field(cursor, 'schemaVersion') !== 1) throw new RangeError('Unsupported original inspection cursor.');
	const catalogId = id(field(cursor, 'catalogId'), 'inspection catalog ID');
	const importId = field(cursor, 'importId') === null ? null : id(field(cursor, 'importId'), 'inspection import ID');
	const phase = oneOf(field(cursor, 'phase'), ['committed', 'provisional'] as const, 'inspection phase');
	if (phase === 'provisional' && importId === null) throw new RangeError('A provisional inspection cursor requires its active import.');
	const afterKey = field(cursor, 'afterKey');
	if (afterKey !== null) {
		if (typeof afterKey !== 'string' || afterKey.length > 1024) throw new TypeError('Original inspection continuation requires a bounded root key.');
		const keys = array(JSON.parse(afterKey) as unknown, 'inspection root key', 3, 3);
		const photoId = id(keys[2], 'inspection photo ID');
		if (afterKey !== catalogOriginalKey(catalogId, phase === 'committed' ? null : importId, photoId)) throw new RangeError('Inspection root continuation belongs to another scope.');
	}
	return Object.freeze({ cursor: Object.freeze({ schemaVersion: 1, catalogId,
		revision: integer(field(cursor, 'revision'), 0, Number.MAX_SAFE_INTEGER, 'inspection revision'), importId, phase, afterKey }), signal });
}

/** Caller owns the catalog writer lease. This scan neither repairs nor recovers any durable state. */
export async function readPhotoLibraryOriginalInspectionPageV1(catalogId: string, ports: Ports, cursor: Cursor | null,
	startupFailure: PhotoLibraryOriginalInspectionFailureV1 | null, signal: AbortSignal): Promise<PhotoLibraryOriginalInspectionPageV1> {
	const snapshot = await capture();
	if (cursor && (cursor.catalogId !== catalogId || cursor.revision !== snapshot.root.revision
		|| cursor.importId !== snapshot.importId)) throw new Error('Original inspection catalog revision or active intent changed.');
	const phase = cursor?.phase ?? 'committed', importId = phase === 'committed' ? null : snapshot.importId;
	const afterKey = cursor?.afterKey ?? null;
	const raw = await ports.media.custody.readPage({ catalogId, importId, afterKey }, { signal }); signal.throwIfAborted();
	const page = record(raw, 'original inspection root page', ['roots', 'afterKey']);
	const roots = array(field(page, 'roots'), 'inspection roots', 0, PAGE_SIZE).map(normalizeCatalogOriginalRoot);
	const continuation = field(page, 'afterKey');
	if (continuation !== null && (typeof continuation !== 'string' || continuation !== roots.at(-1)?.key)) throw new Error('Original inspection root continuation is corrupt.');
	const rows: Array<PhotoLibraryOriginalInspectionPageV1['rows'][number]> = [];
	let previous = afterKey;
	for (const root of roots) {
		signal.throwIfAborted();
		if (root.catalogId !== catalogId || root.importId !== importId || (previous !== null && root.key <= previous)) throw new Error('Original inspection root scope or order is corrupt.');
		previous = root.key;
		const stored = await ports.catalog.loadPhoto(catalogId, root.photoId); signal.throwIfAborted();
		if (stored === null) {
			if (phase === 'committed') throw new Error('Committed original root has no published photo.');
			continue;
		}
		const photo = validateLightscaperDocumentV1(stored);
		if (photo.kind !== 'photo') throw new TypeError('Original inspection requires a published photo document.');
		const original = photo.original;
		if (photo.catalogId !== catalogId || photo.id !== root.photoId || original.retention !== 'managed'
			|| original.id !== root.sourceId || original.storageKey !== root.assetId
			|| original.contentSha256 !== root.sha256 || original.byteLength !== root.size) throw new Error('Published photo and original root binding conflict.');
		const binding = normalizeCatalogOriginalRepairBindingV1({ catalogId, importId, photoId: photo.id,
			sourceId: original.id, assetId: original.storageKey, sha256: original.contentSha256,
			size: original.byteLength, name: original.name, mimeType: original.mimeType });
		const inspection = normalizeOutcome(await ports.originalInspection.inspect(binding, signal));
		signal.throwIfAborted();
		rows.push(Object.freeze({ photoId: photo.id, revision: photo.revision, fileName: photo.metadata.fileName, binding, inspection }));
	}
	const current = await capture();
	if (current.root.revision !== snapshot.root.revision || current.importId !== snapshot.importId) throw new Error('Original inspection catalog revision or active intent changed during inspection.');
	const next = continuation !== null ? { phase, afterKey: continuation }
		: phase === 'committed' && snapshot.importId !== null ? { phase: 'provisional' as const, afterKey: null } : null;
	const output = Object.freeze({ schemaVersion: 1 as const, catalogId, catalogName: snapshot.root.name,
		revision: snapshot.root.revision, activeImportId: snapshot.importId, startupFailure, rows: Object.freeze(rows), scanned: roots.length,
		cursor: next === null ? null : JSON.stringify({ schemaVersion: 1, catalogId, revision: snapshot.root.revision, importId: snapshot.importId, ...next }) });
	if (new TextEncoder().encode(JSON.stringify(output)).byteLength > MAXIMUM_PAGE_BYTES) throw new RangeError('Original inspection scalar page exceeds2MiB.');
	if (output.cursor !== null && new TextEncoder().encode(output.cursor).byteLength > MAXIMUM_CURSOR_BYTES) throw new RangeError('Original inspection continuation exceeds2KiB.');
	return output;

	async function capture() {
		signal.throwIfAborted();
		const document = await ports.catalog.loadCatalog(catalogId); signal.throwIfAborted();
		if (document === null) throw new ReferenceError('Inspection catalog is missing.');
		const root = validateLightscaperDocumentV1(document);
		if (root.kind !== 'photo-catalog' || root.id !== catalogId) throw new RangeError('Inspection catalog identity disagrees with its key.');
		const value = await ports.journal.get(photoImportIntentKeyV1(catalogId)); signal.throwIfAborted();
		const importId = value === undefined ? null : normalizePhotoImportIntentV1(value, catalogId).importId;
		return { root, importId };
	}
}

export function photoOriginalInspectionFailureV1(error: unknown): Readonly<PhotoLibraryOriginalInspectionFailureV1> {
	let message: unknown;
	try {
		const descriptor = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'message') : undefined;
		message = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
	} catch { /* Rejected values cannot veto best-effort scalar failure retention. */ }
	if (message === undefined) { try { message = domMessage?.call(error); } catch { /* Non-native error. */ } }
	return Object.freeze({ message: typeof message === 'string' ? message.slice(0, 2048) : 'Original inspection failed.' });
}

function normalizeOutcome(value: unknown): PhotoLibraryOriginalBodyInspectionV1 {
	const input = record(value, 'original body inspection', ['status', 'reason', 'storage'], ['status']);
	const status = oneOf(field(input, 'status'), ['present', 'missing', 'corrupt', 'unsupported'] as const, 'original inspection status');
	if (status === 'present') { record(value, 'present original', ['status']); return Object.freeze({ status }); }
	if (status === 'unsupported') {
		record(value, 'unsupported original', ['status', 'storage']);
		const storage = field(input, 'storage');
		return Object.freeze({ status, storage: storage === null ? null : text(storage, 'unsupported storage layout', 256) });
	}
	record(value, 'original inspection', ['status', 'reason']);
	return status === 'missing'
		? Object.freeze({ status, reason: oneOf(field(input, 'reason'), ['media-row', 'directory', 'file', 'inline-blob', 'chunk'] as const, 'missing original reason') })
		: Object.freeze({ status, reason: oneOf(field(input, 'reason'), ['size', 'digest'] as const, 'corrupt original reason') });
}
