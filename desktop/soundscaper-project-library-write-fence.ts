/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';

import {
	assertDesktopExpectedProjectDocument,
	DesktopProjectWriteFenceConflict,
	type DesktopProjectWriteFences,
} from './project-library-write-fence.ts';
import {
	SoundscaperDesktopProjectLibraryPublicationRefusal,
	soundscaperDesktopProjectLibraryPublicationRefusalCode,
} from './soundscaper-project-library-publication-contract.ts';
import { readSoundscaperDesktopProjectLibraryMetadataSnapshot } from
	'./soundscaper-project-library-publication-persistence.ts';

/** Called inside the same SQLite transaction that makes the revision current. */
export function assertSoundscaperDesktopFencedPublication(
	database: DatabaseSync,
	fences: DesktopProjectWriteFences,
	projectId: string,
	token: string,
	expectedDocument: unknown,
	expectedRevision: number,
): void {
	try {
		fences.assertCurrent(projectId, token);
		const row = database.prepare(`
			SELECT document_json FROM project_revisions
			WHERE project_id = ? AND project_revision = ?
		`).get(projectId, expectedRevision) as { document_json?: unknown } | undefined;
		if (typeof row?.document_json !== 'string') throw new DesktopProjectWriteFenceConflict();
		assertDesktopExpectedProjectDocument(expectedDocument, row.document_json);
	} catch (error) {
		if (!(error instanceof DesktopProjectWriteFenceConflict)) throw error;
		throw new SoundscaperDesktopProjectLibraryPublicationRefusal(
			'write-fence', 'Soundscaper desktop fenced publication lost its expected document or writer',
		);
	}
}

export function assertSoundscaperDesktopPublicationPreflight(
	database: DatabaseSync, projectId: string, projectRevision: number,
): void {
	if (database.prepare(`
		SELECT 1 AS pending FROM publication_journal
		WHERE state IN ('prepared', 'materialized', 'committed') LIMIT 1
	`).get()) throw new Error('Soundscaper desktop baseline publication recovery is required');
	if (database.prepare(`
		SELECT 1 AS pending FROM metadata_journal
		WHERE state IN ('prepared', 'committed') LIMIT 1
	`).get()) throw new Error('Soundscaper desktop baseline metadata recovery is required before body publication');
	if (database.prepare(`
		SELECT 1 AS occupied FROM project_revisions
		WHERE project_id = ? AND project_revision = ?
	`).get(projectId, projectRevision)) {
		throw new Error('Soundscaper desktop baseline next project revision is occupied');
	}
}

/** Synchronous read-only CAS for an idempotent save, linearized in main. */
export function matchesSoundscaperDesktopFencedCurrent(
	database: DatabaseSync, fences: DesktopProjectWriteFences,
	projectId: string, token: string, expectedDocument: unknown,
): boolean {
	const current = readSoundscaperDesktopProjectLibraryMetadataSnapshot(database)
		.metadata.projects.find((project) => project.projectId === projectId);
	if (!current) return false;
	try {
		assertSoundscaperDesktopFencedPublication(
			database, fences, projectId, token, expectedDocument, current.projectRevision,
		);
		return true;
	} catch (error) {
		if (soundscaperDesktopProjectLibraryPublicationRefusalCode(error) === 'write-fence') return false;
		throw error;
	}
}
