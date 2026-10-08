/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryQueryStepV1 } from './photo-library-session-port-v1.ts';

/** Scalar presentation boundary; product admission owns full Query2 and cursor authority. */
export const PHOTO_LIBRARY_SAVED_COLLECTION_LIMITS_V1 = Object.freeze({ maximumQueryJsonBytes: 524_288,
	maximumCursorBytes: 4_096, maximumPageItems: 64, maximumPageBytes: 262_144, maximumCollections: 10_000 });

export interface PhotoLibrarySavedCollectionContextV1 {
	readonly catalogId: string;
	readonly catalogRevision: number;
	readonly indexRevision: number;
	readonly collectionStateRevision: number;
	readonly collectionCount: number;
}
export interface PhotoLibrarySavedCollectionSummaryV1 {
	readonly id: string;
	readonly revision: number;
	readonly name: string;
}
export interface PhotoLibrarySavedCollectionDefinitionV1 extends PhotoLibrarySavedCollectionSummaryV1 {
	/** One bounded, canonical full query including text, filter, sort and predicate. */
	readonly queryJson: string;
}
export interface PhotoLibrarySavedCollectionPageV1 {
	readonly items: readonly PhotoLibrarySavedCollectionSummaryV1[];
	/** Opaque navigation; never supplies write authority. */
	readonly cursor: string | null;
}
export interface PhotoLibrarySavedCollectionSnapshotV1 {
	readonly collectionId: string | null;
	readonly context: PhotoLibrarySavedCollectionContextV1;
	readonly definition: PhotoLibrarySavedCollectionDefinitionV1 | null;
}
export type PhotoLibrarySavedCollectionCommandV1 =
	| Readonly<{ type: 'create'; context: PhotoLibrarySavedCollectionContextV1; name: string; queryJson: string }>
	| Readonly<{ type: 'update'; context: PhotoLibrarySavedCollectionContextV1; collectionId: string;
		expectedDefinitionRevision: number; name: string; queryJson: string }>
	| Readonly<{ type: 'delete'; context: PhotoLibrarySavedCollectionContextV1; collectionId: string; expectedDefinitionRevision: number }>;
export interface PhotoLibrarySavedCollectionAcknowledgementV1 {
	readonly outcome: 'created' | 'updated' | 'deleted';
	readonly collectionId: string;
	readonly context: PhotoLibrarySavedCollectionContextV1;
	readonly summary: PhotoLibrarySavedCollectionSummaryV1 | null;
	readonly notices: readonly 'cleanup-failed'[];
}
export type PhotoLibrarySavedCollectionQueryModeV1 = 'ordinary' | 'collapsed';
export interface PhotoLibrarySavedCollectionQueryStepV1 extends PhotoLibraryQueryStepV1 {
	readonly collectionId: string;
	readonly collectionName: string;
	readonly mode: PhotoLibrarySavedCollectionQueryModeV1;
	readonly context: Omit<PhotoLibrarySavedCollectionContextV1, 'collectionCount'>;
	readonly definitionRevision: number;
	readonly definitionSha256: string;
	readonly querySha256: string;
	readonly stackStateRevision: number | null;
}
export interface PhotoLibrarySavedCollectionSignalOptionsV1 { readonly signal?: AbortSignal }
export interface PhotoLibrarySavedCollectionPortV1 {
	readPage(options?: Readonly<{ cursor?: string | null; signal?: AbortSignal }>): Promise<PhotoLibrarySavedCollectionPageV1>;
	readSnapshot(options: Readonly<{ collectionId: string | null; signal?: AbortSignal }>): Promise<PhotoLibrarySavedCollectionSnapshotV1>;
	apply(command: PhotoLibrarySavedCollectionCommandV1, options?: PhotoLibrarySavedCollectionSignalOptionsV1): Promise<PhotoLibrarySavedCollectionAcknowledgementV1>;
	readQueryStep(options: Readonly<{ collectionId: string; mode: PhotoLibrarySavedCollectionQueryModeV1;
		cursor?: string | null; signal?: AbortSignal }>): Promise<PhotoLibrarySavedCollectionQueryStepV1>;
}
