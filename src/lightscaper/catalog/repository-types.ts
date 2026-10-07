/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoColorLabelV1, PhotoFlagV1, PhotoOriginalV1 } from './types.ts';

export const PHOTO_CATALOG_DATABASE_VERSION = 1;
export const PHOTO_CATALOG_REPOSITORY_LIMITS = Object.freeze({
	pageSize: 64,
	maximumSummaryBytes: 4_096,
	maximumImportPhotos: 16,
	maximumImportBytes: 8_388_608,
	maximumMembershipWrites: 4_096,
});

export const PHOTO_CATALOG_STORES = Object.freeze([
	'catalogs', 'catalogStates', 'photos', 'summaries', 'memberships',
] as const);

export interface PhotoCatalogRepositoryOptionsV1 {
	readonly indexedDB: IDBFactory;
	readonly databaseName?: string;
	/** The shared media owner verifies digest, length and retained custody before publication. */
	readonly verifyOriginal: (original: PhotoOriginalV1, signal?: AbortSignal) => Promise<void>;
}

export interface PhotoSummaryV1 {
	readonly key: string;
	readonly catalogId: string;
	readonly photoId: string;
	readonly photoRevision: number;
	readonly fileName: string;
	readonly captureLocal: string | null;
	readonly rating: number;
	readonly flag: PhotoFlagV1;
	readonly colorLabel: PhotoColorLabelV1;
	readonly folderId: string | null;
	readonly activeVersionId: string;
	readonly originalSha256: string;
	readonly width: number;
	readonly height: number;
}

export type PhotoCatalogFilterV1 =
	| Readonly<{ kind: 'folder' | 'collection' | 'keyword'; id: string }>
	| Readonly<{ kind: 'rating'; value: number }>
	| Readonly<{ kind: 'flag'; value: PhotoFlagV1 }>
	| Readonly<{ kind: 'label'; value: PhotoColorLabelV1 }>;

export interface PhotoCatalogContinuationV1 {
	readonly catalogId: string;
	readonly indexRevision: number;
	readonly scope: string;
	readonly afterKey: string;
}

export interface PhotoSummaryPageV1 {
	readonly items: readonly PhotoSummaryV1[];
	readonly continuation: PhotoCatalogContinuationV1 | null;
}

export interface PhotoCatalogIndexStateV1 {
	readonly id: string;
	readonly schemaFamily: 'lightscaper';
	readonly schemaVersion: 1;
	readonly rootRevision: number;
	readonly indexRevision: number;
	readonly photoCount: number;
}

export interface PhotoMembershipV1 {
	readonly key: string;
	readonly scope: string;
	readonly photoKey: string;
}

export class PhotoCatalogRevisionConflictError extends Error {
	readonly code: 'CATALOG_REVISION_CONFLICT' | 'PHOTO_REVISION_CONFLICT';
	constructor(owner: 'catalog' | 'photo') {
		super(`The ${owner} revision changed; reload before publishing this edit.`);
		this.name = 'PhotoCatalogRevisionConflictError';
		this.code = owner === 'catalog' ? 'CATALOG_REVISION_CONFLICT' : 'PHOTO_REVISION_CONFLICT';
	}
}

export class PhotoCatalogClosedError extends Error {
	readonly code = 'CATALOG_CLOSED';
	constructor() { super('The photo catalog repository is closed.'); this.name = 'PhotoCatalogClosedError'; }
}
