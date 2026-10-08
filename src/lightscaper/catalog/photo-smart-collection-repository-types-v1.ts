/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoSmartCollectionV1, type PhotoSmartCollectionV1, type PhotoSmartCollectionSummaryV1 } from './photo-smart-collection-v1.ts';
import { photoSmartCollectionKeyV1 } from './photo-smart-collection-record-v1.ts';
import { assertPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { array, field, id, integer, record } from './value-validation.ts';
import type { PhotoSmartCollectionsStateV1 } from './photo-smart-collection-state-v1.ts';
import type { PhotoSmartCollectionStorageContextV1 } from './photo-smart-collection-storage-v1.ts';

export const PHOTO_SMART_COLLECTION_REPOSITORY_LIMITS_V1 = Object.freeze({ maximumPageItems: 64, maximumPageBytes: 262_144 });
const admittedDefinitions = new WeakSet<object>();
export interface PhotoSmartCollectionWriteOptionsV1 {
	readonly expectedCatalogRevision: number;
	readonly expectedIndexRevision: number;
	readonly expectedStateRevision: number;
	readonly signal?: AbortSignal;
}
export interface PhotoSmartCollectionSignalOptionsV1 { readonly signal?: AbortSignal }
export interface PhotoSmartCollectionContinuationV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-smart-collection-page';
	readonly scope: 'smart-collections';
	readonly catalogId: string;
	readonly catalogRevision: number;
	readonly indexRevision: number;
	readonly stateRevision: number;
	readonly afterKey: string;
}
export interface PhotoSmartCollectionPageOptionsV1 extends PhotoSmartCollectionSignalOptionsV1 { readonly continuation?: unknown }
export interface AdmittedPhotoSmartCollectionPageOptionsV1 extends PhotoSmartCollectionSignalOptionsV1 { readonly continuation: PhotoSmartCollectionContinuationV1 | null }
export interface PhotoSmartCollectionPageV1 {
	readonly items: readonly PhotoSmartCollectionSummaryV1[];
	readonly continuation: PhotoSmartCollectionContinuationV1 | null;
}
export interface PhotoSmartCollectionWriteReceiptV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-smart-collection-write';
	readonly catalogId: string;
	readonly catalogRevision: number;
	readonly indexRevision: number;
	readonly state: Readonly<PhotoSmartCollectionsStateV1>;
	readonly definition: Readonly<PhotoSmartCollectionV1> | null;
}
export class PhotoSmartCollectionRevisionConflictError extends Error {
	constructor() { super('Saved collection revision or catalog context has changed.'); this.name = 'PhotoSmartCollectionRevisionConflictError'; }
}
export function admitPhotoSmartCollectionSaveV1(value: unknown, expectedRevision: unknown): Readonly<PhotoSmartCollectionV1> {
	const definition = value !== null && typeof value === 'object' && admittedDefinitions.has(value)
		? value as Readonly<PhotoSmartCollectionV1> : normalizePhotoSmartCollectionV1(value);
	const expected = expectedRevision === null ? 0 : smartCollectionRevisionV1(expectedRevision);
	if (definition.revision !== expected) throw new RangeError('Saved collection candidate revision disagrees with its expected revision.');
	admittedDefinitions.add(definition);
	return definition;
}
export function readPhotoSmartCollectionWriteOptionsV1(value: unknown): Readonly<PhotoSmartCollectionWriteOptionsV1> {
	const input = record(value, 'saved collection write options', ['expectedCatalogRevision', 'expectedIndexRevision', 'expectedStateRevision', 'signal'],
		['expectedCatalogRevision', 'expectedIndexRevision', 'expectedStateRevision']);
	return Object.freeze({ expectedCatalogRevision: smartCollectionRevisionV1(field(input, 'expectedCatalogRevision')),
		expectedIndexRevision: smartCollectionRevisionV1(field(input, 'expectedIndexRevision')),
		expectedStateRevision: smartCollectionRevisionV1(field(input, 'expectedStateRevision')), ...readSignal(input) });
}
export function readPhotoSmartCollectionSignalOptionsV1(value: unknown = {}): PhotoSmartCollectionSignalOptionsV1 {
	return Object.freeze(readSignal(record(value, 'saved collection read options', ['signal'], [])));
}
export function readPhotoSmartCollectionPageOptionsV1(value: unknown, catalogId: string): AdmittedPhotoSmartCollectionPageOptionsV1 {
	const catalog = id(catalogId, 'saved collection catalog ID');
	const input = record(value, 'saved collection page options', ['continuation', 'signal'], []);
	const next = Object.hasOwn(input, 'continuation') ? field(input, 'continuation') : null;
	return Object.freeze({ continuation: next === null ? null : readContinuation(next, catalog), ...readSignal(input) });
}
export function assertPhotoSmartCollectionContextV1(context: PhotoSmartCollectionStorageContextV1,
	options: PhotoSmartCollectionWriteOptionsV1 | PhotoSmartCollectionContinuationV1): void {
	const catalog = 'expectedCatalogRevision' in options ? options.expectedCatalogRevision : options.catalogRevision;
	const index = 'expectedIndexRevision' in options ? options.expectedIndexRevision : options.indexRevision;
	const state = 'expectedStateRevision' in options ? options.expectedStateRevision : options.stateRevision;
	if (context.root.revision !== catalog || context.index.indexRevision !== index || context.state.revision !== state) {
		throw new PhotoSmartCollectionRevisionConflictError();
	}
}
export function smartCollectionRevisionV1(value: unknown): number {
	return integer(value, 0, Number.MAX_SAFE_INTEGER, 'saved collection expected revision');
}
export function readPhotoSmartCollectionScopedKeyV1(value: unknown, catalogId: string): string {
	if (typeof value !== 'string' || value.length > 263) throw new TypeError('Saved collection key must be a bounded JSON tuple.');
	const parts = array(JSON.parse(value) as unknown, 'saved collection key', 2, 2);
	if (parts[0] !== catalogId || value !== photoSmartCollectionKeyV1(catalogId, id(parts[1], 'saved collection ID'))) {
		throw new TypeError('Saved collection key belongs to another catalog or is not canonical.');
	}
	return value;
}
function readContinuation(value: unknown, catalogId: string): PhotoSmartCollectionContinuationV1 {
	const input = record(value, 'saved collection continuation', ['schemaVersion', 'kind', 'scope', 'catalogId', 'catalogRevision', 'indexRevision', 'stateRevision', 'afterKey']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported or future saved collection continuation version.');
	if (field(input, 'kind') !== 'photo-smart-collection-page' || field(input, 'scope') !== 'smart-collections'
		|| field(input, 'catalogId') !== catalogId) throw new TypeError('Saved collection continuation belongs to another catalog or scope.');
	return Object.freeze({ schemaVersion: 1, kind: 'photo-smart-collection-page', scope: 'smart-collections', catalogId,
		catalogRevision: smartCollectionRevisionV1(field(input, 'catalogRevision')), indexRevision: smartCollectionRevisionV1(field(input, 'indexRevision')),
		stateRevision: smartCollectionRevisionV1(field(input, 'stateRevision')), afterKey: readPhotoSmartCollectionScopedKeyV1(field(input, 'afterKey'), catalogId) });
}
function readSignal(input: Readonly<Record<string, unknown>>): PhotoSmartCollectionSignalOptionsV1 {
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal === undefined) return {};
	assertPhotoStackQuerySignalV1(signal); return { signal };
}
