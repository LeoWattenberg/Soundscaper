/* SPDX-License-Identifier: AGPL-3.0-only */

/** Scalar Library grouping port; it carries no photo documents or media bodies. */
export interface PhotoLibraryStackContextV1 {
	readonly schemaVersion: 1;
	readonly catalogId: string;
	readonly catalogRevision: number;
	readonly indexRevision: number;
	readonly stateRevision: number;
	readonly stackCount: number;
}
export interface PhotoLibraryStackV1 {
	readonly id: string;
	readonly revision: number;
	readonly photoIds: readonly string[];
	readonly coverPhotoId: string;
}
export interface PhotoLibraryStackSnapshotV1 {
	readonly context: Readonly<PhotoLibraryStackContextV1>;
	readonly stack: Readonly<PhotoLibraryStackV1> | null;
}
export interface PhotoLibraryStackMembershipsV1 {
	readonly context: Readonly<PhotoLibraryStackContextV1>;
	readonly memberships: readonly Readonly<{ photoId: string; stackId: string | null }>[];
}
export interface PhotoLibraryStackBindingV1 {
	readonly schemaVersion: 1;
	readonly catalogId: string;
	readonly catalogRevision: number;
	readonly indexRevision: number;
	readonly stateRevision: number;
	readonly stackId: string;
	readonly stackRevision: number;
}
export interface PhotoLibraryStackMembersV1 {
	readonly context: Readonly<PhotoLibraryStackContextV1>;
	readonly rows: readonly Readonly<{ photoId: string; fileName: string; photoRevision: number }>[];
}
export interface PhotoLibraryStackSummaryPageV1 {
	readonly context: Readonly<PhotoLibraryStackContextV1>;
	readonly rows: readonly Readonly<{ id: string; revision: number; photoCount: number; coverPhotoId: string }>[];
	readonly cursor: string | null;
}
interface PhotoLibraryStackCommandBaseV1 {
	readonly schemaVersion: 1;
	readonly catalogId: string;
	readonly expectedCatalogRevision: number;
	readonly expectedStateRevision: number;
}
export type PhotoLibraryStackCommandV1 =
	| Readonly<PhotoLibraryStackCommandBaseV1 & { type: 'create'; photoIds: readonly string[]; coverPhotoId: string }>
	| Readonly<PhotoLibraryStackCommandBaseV1 & { type: 'update'; id: string; expectedStackRevision: number; photoIds: readonly string[]; coverPhotoId: string }>
	| Readonly<PhotoLibraryStackCommandBaseV1 & { type: 'dissolve'; id: string; expectedStackRevision: number }>;
export interface PhotoLibraryStackAcknowledgementV1 {
	readonly schemaVersion: 1;
	readonly catalogId: string;
	readonly catalogRevision: number;
	readonly stateRevision: number;
	readonly action: 'created' | 'updated' | 'dissolved';
	readonly stack: Readonly<PhotoLibraryStackV1> | null;
	readonly notices: readonly 'cleanup-failed'[];
}
export interface PhotoLibraryStackOptionsV1 { readonly signal?: AbortSignal }
export interface PhotoLibraryStackPortV1 {
	readStackMemberships(photoIds: readonly string[], options?: PhotoLibraryStackOptionsV1): Promise<PhotoLibraryStackMembershipsV1>;
	readStackSnapshot(photoId: string, options?: PhotoLibraryStackOptionsV1): Promise<PhotoLibraryStackSnapshotV1>;
	readStackMembers(binding: PhotoLibraryStackBindingV1, photoIds: readonly string[], options?: PhotoLibraryStackOptionsV1): Promise<PhotoLibraryStackMembersV1>;
	readStackSummaryPage(options?: Readonly<{ cursor?: string | null; signal?: AbortSignal }>): Promise<PhotoLibraryStackSummaryPageV1>;
	applyStack(command: PhotoLibraryStackCommandV1, options?: PhotoLibraryStackOptionsV1): Promise<PhotoLibraryStackAcknowledgementV1>;
}
