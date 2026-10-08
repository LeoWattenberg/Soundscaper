/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_LIBRARY_SAVED_COLLECTION_LIMITS_V1 as LIMITS, type PhotoLibrarySavedCollectionPageV1,
	type PhotoLibrarySavedCollectionSnapshotV1, type PhotoLibrarySavedCollectionQueryStepV1 } from '../../common/editor/photo-library-saved-collection-port-v1.ts';
import { normalizePhotoSmartCollectionV1, readPhotoSmartCollectionSummaryV1 } from '../catalog/photo-smart-collection-v1.ts';
import { photoSmartCollectionKeyV1 } from '../catalog/photo-smart-collection-record-v1.ts';
import { readPhotoSmartCollectionPageOptionsV1, type PhotoSmartCollectionPageOptionsV1,
	type PhotoSmartCollectionSignalOptionsV1 } from '../catalog/photo-smart-collection-repository-types-v1.ts';
import { readPhotoSavedQueryContinuationV1, type PhotoSavedQueryPageRequestV1 } from '../catalog/photo-smart-collection-query-types-v1.ts';
import { readPhotoSummary } from '../catalog/repository-records.ts';
import { assertPhotoStackQuerySignalV1, withPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { LIGHTSCAPER_CATALOG_LIMITS } from '../catalog/types.ts';
import { array, field, id, integer, name, record } from '../catalog/value-validation.ts';
import { admitPhotoLibrarySavedPageRequestV1, admitPhotoLibrarySavedSnapshotRequestV1, admitPhotoLibrarySavedQueryRequestV1,
	readPhotoLibrarySavedContextV1, savedLibraryRevisionV1, type AdmittedPhotoLibrarySavedPageRequestV1,
	type AdmittedPhotoLibrarySavedSnapshotRequestV1, type AdmittedPhotoLibrarySavedQueryRequestV1 } from './photo-library-saved-collection-admission-v1.ts';

export interface PhotoLibrarySavedReadRepositoryV1 {
	readSmartCollectionPage(catalogId: string, options: PhotoSmartCollectionPageOptionsV1): Promise<unknown>;
	readSmartCollectionSnapshotV1(catalogId: string, collectionId: string | null, options: PhotoSmartCollectionSignalOptionsV1): Promise<unknown>;
	readSmartCollectionQueryPageV1(catalogId: string, collectionId: string, options: PhotoSavedQueryPageRequestV1): Promise<unknown>;
	readSmartCollectionStackQueryPageV1(catalogId: string, collectionId: string, options: PhotoSavedQueryPageRequestV1): Promise<unknown>;
}

export async function readPhotoLibrarySavedPageV1(repository: Pick<PhotoLibrarySavedReadRepositoryV1, 'readSmartCollectionPage'>,
	catalogValue: string, request: AdmittedPhotoLibrarySavedPageRequestV1, privateSignal?: AbortSignal): Promise<PhotoLibrarySavedCollectionPageV1> {
	const catalogId = id(catalogValue, 'selected catalog ID'), admitted = admitPhotoLibrarySavedPageRequestV1(request);
	if (admitted.continuation !== null && admitted.continuation.catalogId !== catalogId) throw new TypeError('Saved page cursor belongs to another catalog.');
	return withReadSignal(admitted.signal, privateSignal, async signal => {
		const raw = record(await repository.readSmartCollectionPage(catalogId, { continuation: admitted.continuation, signal }),
			'saved summary page', ['items', 'continuation']);
		const summaries = array(field(raw, 'items'), 'saved page summaries', 0, LIMITS.maximumPageItems).map(readPhotoSmartCollectionSummaryV1);
		let after = admitted.continuation?.afterKey ?? '';
		for (const summary of summaries) {
			const key = photoSmartCollectionKeyV1(catalogId, summary.id);
			if (summary.catalogId !== catalogId || key <= after) throw new TypeError('Saved summaries belong to another catalog or are unordered.');
			after = key;
		}
		if (new TextEncoder().encode(JSON.stringify(summaries)).byteLength > LIMITS.maximumPageBytes) throw new RangeError('Saved summary page exceeds 256 KiB.');
		const continuation = readPhotoSmartCollectionPageOptionsV1({ continuation: field(raw, 'continuation') }, catalogId).continuation;
		const incoming = admitted.continuation;
		if (continuation !== null && (summaries.length === 0 || continuation.afterKey !== after || (incoming !== null
			&& (['catalogRevision', 'indexRevision', 'stateRevision'] as const).some(key => continuation[key] !== incoming[key])))) {
			throw new TypeError('Saved summary continuation disagrees with its page.');
		}
		return Object.freeze({ items: Object.freeze(summaries.map(summary => Object.freeze({ id: summary.id, revision: summary.revision, name: summary.name }))),
			cursor: continuation === null ? null : JSON.stringify(continuation) });
	});
}

export async function readPhotoLibrarySavedSnapshotV1(repository: Pick<PhotoLibrarySavedReadRepositoryV1, 'readSmartCollectionSnapshotV1'>,
	catalogValue: string, request: AdmittedPhotoLibrarySavedSnapshotRequestV1, privateSignal?: AbortSignal): Promise<PhotoLibrarySavedCollectionSnapshotV1> {
	const catalogId = id(catalogValue, 'selected catalog ID'), admitted = admitPhotoLibrarySavedSnapshotRequestV1(request);
	return withReadSignal(admitted.signal, privateSignal, async signal => {
		const raw = record(await repository.readSmartCollectionSnapshotV1(catalogId, admitted.collectionId, { signal }),
			'saved snapshot', ['schemaVersion', 'kind', 'selectedId', 'context', 'definition']);
		if (field(raw, 'schemaVersion') !== 1 || field(raw, 'kind') !== 'photo-smart-collection-snapshot'
			|| field(raw, 'selectedId') !== admitted.collectionId) throw new TypeError('Saved snapshot differs from its selection or profile.');
		const context = readPhotoLibrarySavedContextV1(field(raw, 'context'));
		if (context.catalogId !== catalogId) throw new TypeError('Saved snapshot belongs to another catalog.');
		const selected = field(raw, 'definition'); let definition: PhotoLibrarySavedCollectionSnapshotV1['definition'] = null;
		if (selected !== null) {
			const document = normalizePhotoSmartCollectionV1(selected);
			if (document.catalogId !== catalogId || document.id !== admitted.collectionId || context.collectionCount === 0) {
				throw new TypeError('Saved snapshot definition differs from its selection or count.');
			}
			const queryJson = JSON.stringify(document.query);
			if (new TextEncoder().encode(queryJson).byteLength > LIMITS.maximumQueryJsonBytes) throw new RangeError('Saved query JSON exceeds 512 KiB.');
			definition = Object.freeze({ id: document.id, revision: document.revision, name: document.name, queryJson });
		}
		return Object.freeze({ collectionId: admitted.collectionId, context, definition });
	});
}

/** Each call owns one native saved page; no extra snapshot invents a collection count. */
export async function readPhotoLibrarySavedQueryStepV1(repository: Pick<PhotoLibrarySavedReadRepositoryV1,
	'readSmartCollectionQueryPageV1' | 'readSmartCollectionStackQueryPageV1'>, catalogValue: string,
	request: AdmittedPhotoLibrarySavedQueryRequestV1, privateSignal?: AbortSignal): Promise<PhotoLibrarySavedCollectionQueryStepV1> {
	const catalogId = id(catalogValue, 'selected catalog ID'), admitted = admitPhotoLibrarySavedQueryRequestV1(request);
	if (admitted.continuation !== null && admitted.continuation.catalogId !== catalogId) throw new TypeError('Saved query cursor belongs to another catalog.');
	return withReadSignal(admitted.signal, privateSignal, async signal => {
		const method = admitted.mode === 'ordinary' ? repository.readSmartCollectionQueryPageV1 : repository.readSmartCollectionStackQueryPageV1;
		const raw = record(await method.call(repository, catalogId, admitted.collectionId, { continuation: admitted.continuation, signal }),
			'saved query page', ['schemaVersion', 'kind', 'mode', 'catalogId', 'catalogName', 'totalCount', 'catalogRevision', 'indexRevision',
				'collectionId', 'collectionName', 'definitionRevision', 'collectionStateRevision', 'definitionSha256', 'querySha256',
				'stackStateRevision', 'items', 'scanned', 'continuation']);
		if (field(raw, 'schemaVersion') !== 1 || field(raw, 'kind') !== 'saved-photo-query-page' || field(raw, 'mode') !== admitted.mode
			|| field(raw, 'catalogId') !== catalogId || field(raw, 'collectionId') !== admitted.collectionId) throw new TypeError('Saved query page has another profile or selection.');
		const context = Object.freeze({ catalogId, catalogRevision: savedLibraryRevisionV1(field(raw, 'catalogRevision')),
			indexRevision: savedLibraryRevisionV1(field(raw, 'indexRevision')), collectionStateRevision: savedLibraryRevisionV1(field(raw, 'collectionStateRevision')) });
		const identity = Object.freeze({ ...context, collectionId: admitted.collectionId, definitionRevision: savedLibraryRevisionV1(field(raw, 'definitionRevision')),
			definitionSha256: digest(field(raw, 'definitionSha256')), querySha256: digest(field(raw, 'querySha256')),
			stackStateRevision: field(raw, 'stackStateRevision') === null ? null : savedLibraryRevisionV1(field(raw, 'stackStateRevision')) });
		if (admitted.mode === 'ordinary' ? identity.stackStateRevision !== null : identity.stackStateRevision === null) throw new TypeError('Saved query grouping state differs from its mode.');
		if (admitted.continuation !== null) checkIdentity(admitted.continuation, identity);
		const totalCount = integer(field(raw, 'totalCount'), 0, LIGHTSCAPER_CATALOG_LIMITS.maximumPhotos, 'saved query photo count');
		const scanned = integer(field(raw, 'scanned'), 0, 64, 'saved query candidate count');
		const rows = array(field(raw, 'items'), 'saved query summaries', 0, 64).map(readPhotoSummary);
		if (rows.length > scanned || rows.length > totalCount || (admitted.mode === 'ordinary' && scanned > totalCount)
			|| rows.some(row => row.catalogId !== catalogId) || new Set(rows.map(row => row.photoId)).size !== rows.length) throw new TypeError('Saved query rows disagree with their candidate count or catalog.');
		const rawNext = field(raw, 'continuation'), next = rawNext === null ? null : readPhotoSavedQueryContinuationV1(rawNext, catalogId, admitted.collectionId, admitted.mode);
		if (next !== null) checkIdentity(next, identity);
		if (next !== null && admitted.continuation !== null && (next.sort.field !== admitted.continuation.sort.field
			|| next.sort.direction !== admitted.continuation.sort.direction)) throw new TypeError('Saved query continuation changed its sort.');
		return Object.freeze({ catalogName: name(field(raw, 'catalogName'), 'saved query catalog name'), totalCount, scanned,
			rows: Object.freeze(rows.map(row => Object.freeze({ id: row.photoId, fileName: row.fileName, width: row.width, height: row.height,
				rating: row.rating, flag: row.flag, colorLabel: row.colorLabel }))), cursor: next === null ? null : JSON.stringify(next),
			context, collectionId: admitted.collectionId, collectionName: name(field(raw, 'collectionName'), 'saved query collection name'),
			mode: admitted.mode, definitionRevision: identity.definitionRevision, definitionSha256: identity.definitionSha256,
			querySha256: identity.querySha256, stackStateRevision: identity.stackStateRevision });
	});
}
function withReadSignal<Result>(requested: AbortSignal | undefined, privateSignal: AbortSignal | undefined,
	run: (signal: AbortSignal | undefined) => Promise<Result>): Promise<Result> {
	if (requested !== undefined) assertPhotoStackQuerySignalV1(requested);
	if (privateSignal !== undefined) assertPhotoStackQuerySignalV1(privateSignal);
	return withPhotoStackQuerySignalV1(privateSignal ?? requested, async signal => {
		const result = await run(signal);
		if (requested !== undefined) assertPhotoStackQuerySignalV1(requested);
		return result;
	});
}
function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Saved query identity requires SHA-256.');
	return value;
}
function checkIdentity(value: Readonly<Record<string, unknown>> | object, expected: Readonly<Record<string, unknown>>): void {
	for (const key of Object.keys(expected)) if (Object.getOwnPropertyDescriptor(value, key)?.value !== expected[key]) {
		throw new TypeError('Saved query continuation disagrees with its atomic page identity.');
	}
}
