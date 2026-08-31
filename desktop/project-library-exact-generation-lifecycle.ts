/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';

import type {
	FramescaperDesktopProjectLibraryExactGenerationOwner,
	FramescaperDesktopProjectLibraryExactGenerationPaths,
} from './project-library-exact-generation-contract.ts';

export type FramescaperDesktopProjectLibraryPublicationCheckpoint =
	'prepared' | 'materialized' | 'committed' | 'complete';

export interface FramescaperDesktopProjectLibraryExactPublicationDeclaration {
	readonly publicationId: string;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly projectSha256: string;
	readonly documentFile: string;
	readonly expectedMetadataRevision: number;
}

export interface FramescaperDesktopProjectLibraryExactPublicationBody {
	readonly bodyFile: string;
	readonly kind: string;
	readonly storageKey: string;
}

export interface FramescaperDesktopProjectLibraryExactGenerationLifecycle {
	assertCanUse(): void;
	snapshot(): Readonly<Record<string, unknown>>;
	assertLeaseInTransaction(database: DatabaseSync): void;
	preparePublication(value: Readonly<FramescaperDesktopProjectLibraryExactPublicationDeclaration>): Promise<void>;
	preparePublicationBodies(
		publicationId: string,
		bodies: readonly Readonly<FramescaperDesktopProjectLibraryExactPublicationBody>[],
	): Promise<void>;
	publicationMaterialized(value: Readonly<FramescaperDesktopProjectLibraryExactPublicationDeclaration>): Promise<void>;
	assertCanCommit(
		database: DatabaseSync,
		value: Readonly<FramescaperDesktopProjectLibraryExactPublicationDeclaration>,
	): void;
	publicationCommitted(
		value: Readonly<FramescaperDesktopProjectLibraryExactPublicationDeclaration>,
		result: unknown,
	): Promise<void>;
	publicationComplete(value: Readonly<FramescaperDesktopProjectLibraryExactPublicationDeclaration>): Promise<void>;
	abortPublication(publicationId: string): Promise<void>;
	close(): Promise<void>;
}

export interface FramescaperDesktopProjectLibraryExactGenerationExtension {
	start(value: Readonly<{
		appDataPath: string;
		database: DatabaseSync;
		owner: Readonly<FramescaperDesktopProjectLibraryExactGenerationOwner>;
		paths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>;
	}>): Promise<FramescaperDesktopProjectLibraryExactGenerationLifecycle>;
}

export async function abortPublicationAfterFailure(
	lifecycle: FramescaperDesktopProjectLibraryExactGenerationLifecycle | null,
	publicationId: string,
	error: unknown,
	label: string,
): Promise<never> {
	try { await lifecycle?.abortPublication(publicationId); }
	catch (cleanupError) {
		throw publicationCleanupError(error, cleanupError, label);
	}
	throw error;
}

function publicationCleanupError(primary: unknown, cleanup: unknown, label: string): AggregateError {
	return new AggregateError(
		[primary, cleanup], `${label} publication cleanup failed`, { cause: primary },
	);
}
