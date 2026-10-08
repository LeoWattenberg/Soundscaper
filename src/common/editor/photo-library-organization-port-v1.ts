/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDefinitionKindV1, PhotoLibraryDefinitionRowV1, PhotoLibraryRowV1 } from './photo-library-session-port-v1.ts';

/** Scalar organization boundary; authored smart predicates cross as bounded JSON. */
export type PhotoLibraryCollectionDefinitionV1 =
	| Readonly<{ id: string; name: string; kind: 'manual' }>
	| Readonly<{ id: string; name: string; kind: 'smart'; queryJson: string }>;

export type PhotoLibraryDefinitionCommandV1 =
	| Readonly<{ type: 'create-node'; nodeKind: 'folder' | 'keyword'; id: string; name: string; parentId: string | null }>
	| Readonly<{ type: 'rename-node'; nodeKind: 'folder' | 'keyword'; id: string; name: string }>
	| Readonly<{ type: 'reparent-node'; nodeKind: 'folder' | 'keyword'; id: string; parentId: string | null }>
	| Readonly<{ type: 'delete-empty-node'; nodeKind: 'folder' | 'keyword'; id: string }>
	| Readonly<{ type: 'create-collection' | 'update-collection'; collection: PhotoLibraryCollectionDefinitionV1 }>;

export interface PhotoLibraryDefinitionReadRequestV1 {
	readonly kind: PhotoLibraryDefinitionKindV1;
	readonly id: string;
	readonly signal?: AbortSignal;
}

export interface PhotoLibraryDefinitionSnapshotV1 {
	readonly rootRevision: number;
	readonly row: PhotoLibraryDefinitionRowV1;
	readonly queryJson: string | null;
}

export interface PhotoLibraryDefinitionAcknowledgementV1 {
	readonly rootRevision: number;
	readonly row: PhotoLibraryDefinitionRowV1 | null;
}

export interface PhotoLibraryMembershipSnapshotV1 {
	readonly photoId: string;
	readonly revision: number;
	readonly folderId: string | null;
	readonly keywordIds: readonly string[];
	readonly collectionIds: readonly string[];
}

export type PhotoLibraryMembershipPatchV1 = Readonly<Partial<Pick<PhotoLibraryMembershipSnapshotV1, 'folderId' | 'keywordIds' | 'collectionIds'>>>;

export interface PhotoLibraryMembershipAcknowledgementV1 {
	readonly snapshot: PhotoLibraryMembershipSnapshotV1;
	readonly row: PhotoLibraryRowV1;
}

export interface PhotoLibraryOrganizationPortV1 {
	readDefinition(request: PhotoLibraryDefinitionReadRequestV1): Promise<PhotoLibraryDefinitionSnapshotV1>;
	applyDefinition(expectedRootRevision: number, command: PhotoLibraryDefinitionCommandV1,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDefinitionAcknowledgementV1>;
	readMemberships(photoId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryMembershipSnapshotV1>;
	applyMemberships(photoId: string, expectedRevision: number, changes: PhotoLibraryMembershipPatchV1,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryMembershipAcknowledgementV1>;
}
