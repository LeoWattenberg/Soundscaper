/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, unlink } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import type {
	SoundscaperDesktopProjectLibraryPaths,
} from './soundscaper-project-library-contract.ts';
import {
	assertSoundscaperDesktopProjectLibraryDatabaseIdentity,
} from './soundscaper-project-library-database.ts';
import {
	parseSoundscaperDesktopLibraryMetadataJson,
	validateSoundscaperDesktopLibraryMetadata,
	type SoundscaperDesktopLibraryMedia,
	type SoundscaperDesktopLibraryMetadata,
} from './soundscaper-project-library-metadata.ts';
import {
	validateSoundscaperDesktopProjectLibraryTransferBody,
} from './soundscaper-project-library-transfer-contract.ts';

export interface SoundscaperDesktopProjectLibraryReclamationResult {
	readonly projectFiles: number;
	readonly mediaFiles: number;
}

interface ReclamationRow {
	readonly relativeFile: string;
	readonly role: 'project' | 'media';
}

/** Select the media owned by current project revisions, excluding a project being replaced. */
export function selectSoundscaperDesktopProjectLibraryCurrentMedia(
	database: DatabaseSync,
	metadataValue: unknown,
	excludedProjectId?: string,
): readonly Readonly<SoundscaperDesktopLibraryMedia>[] {
	assertSoundscaperDesktopProjectLibraryDatabaseIdentity(database);
	const metadata = validateSoundscaperDesktopLibraryMetadata(metadataValue);
	const bodyIds = new Set<string>();
	for (const project of metadata.projects) {
		if (project.projectId === excludedProjectId) continue;
		if (!database.prepare(`
			SELECT 1 AS present FROM project_revisions
			WHERE project_id = ? AND project_revision = ?
		`).get(project.projectId, project.projectRevision)) {
			throw new Error('Soundscaper desktop baseline current project revision is absent during retention planning');
		}
		const rows = database.prepare(`
			SELECT body_id AS bodyId FROM project_revision_bodies
			WHERE project_id = ? AND project_revision = ? ORDER BY ordinal
		`).all(project.projectId, project.projectRevision) as { bodyId: unknown }[];
		for (const { bodyId } of rows) {
			if (typeof bodyId !== 'string') {
				throw new TypeError('Soundscaper desktop baseline retained body identity is invalid');
			}
			bodyIds.add(bodyId);
		}
	}
	const selected = metadata.media.filter(({ id }) => bodyIds.has(id));
	if (selected.length !== bodyIds.size) {
		throw new Error('Soundscaper desktop baseline current body is absent from metadata retention inventory');
	}
	return Object.freeze(selected);
}

/** Reclaim storage outside current metadata and every retained recovery/audit journal. */
export async function reclaimSoundscaperDesktopProjectLibraryStorage(
	database: DatabaseSync,
	paths: Readonly<SoundscaperDesktopProjectLibraryPaths>,
): Promise<Readonly<SoundscaperDesktopProjectLibraryReclamationResult>> {
	assertSoundscaperDesktopProjectLibraryDatabaseIdentity(database);
	const roots = retainedRoots(database);
	const queued = transaction(database, () => queueUnreferenced(database, roots));
	const removed: ReclamationRow[] = [];
	for (const row of queued) {
		try {
			await unlinkReclamationFile(paths, row);
			removed.push(row);
		} catch (error) {
			if (errorCode(error) === 'ENOENT') removed.push(row);
		}
	}
	if (removed.length > 0) {
		transaction(database, () => {
			const statement = database.prepare(
				'DELETE FROM storage_reclamation WHERE relative_file = ? AND role = ?',
			);
			for (const row of removed) statement.run(row.relativeFile, row.role);
		});
	}
	return Object.freeze({
		projectFiles: removed.filter(({ role }) => role === 'project').length,
		mediaFiles: removed.filter(({ role }) => role === 'media').length,
	});
}

async function unlinkReclamationFile(
	paths: Readonly<SoundscaperDesktopProjectLibraryPaths>,
	row: ReclamationRow,
): Promise<void> {
	const path = reclamationPath(paths, row);
	const root = resolve(paths.libraryRoot);
	const parts = relative(root, path).split(sep);
	let parent = root;
	const rootEntry = await lstat(parent);
	if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
		throw new TypeError('Soundscaper desktop baseline reclamation root is not a real directory');
	}
	for (const part of parts.slice(0, -1)) {
		parent = resolve(parent, part);
		const entry = await lstat(parent);
		if (!entry.isDirectory() || entry.isSymbolicLink()) {
			throw new TypeError('Soundscaper desktop baseline reclamation scope contains a non-directory');
		}
	}
	const entry = await lstat(path);
	if (!entry.isFile() || entry.isSymbolicLink()) {
		throw new TypeError('Soundscaper desktop baseline reclamation target is not a regular file');
	}
	await unlink(path);
}

function retainedRoots(database: DatabaseSync): Readonly<{
	revisions: ReadonlySet<string>;
	bodies: ReadonlySet<string>;
}> {
	const metadata = retainedMetadata(database);
	const revisions = new Set<string>();
	const bodies = new Set<string>();
	for (const snapshot of metadata) {
		for (const project of snapshot.projects) {
			revisions.add(revisionKey(project.projectId, project.projectRevision));
		}
		for (const media of snapshot.media) bodies.add(media.id);
	}
	const retainedPublications = database.prepare(`
		SELECT project_id AS projectId, project_revision AS projectRevision, bodies_json AS bodiesJson
		FROM publication_journal WHERE state = 'complete'
	`).all() as { projectId: unknown; projectRevision: unknown; bodiesJson: unknown }[];
	for (const publication of retainedPublications) {
		if (typeof publication.projectId !== 'string' || typeof publication.projectRevision !== 'number') {
			throw new TypeError('Soundscaper desktop baseline retained publication identity is invalid');
		}
		revisions.add(revisionKey(publication.projectId, publication.projectRevision));
		for (const bodyId of retainedPublicationBodyIds(publication.bodiesJson)) bodies.add(bodyId);
	}
	const ownership = database.prepare(`
		SELECT project_id AS projectId, project_revision AS projectRevision, body_id AS bodyId
		FROM project_revision_bodies
	`).all() as { projectId: unknown; projectRevision: unknown; bodyId: unknown }[];
	for (const row of ownership) {
		if (typeof row.projectId === 'string' && typeof row.projectRevision === 'number'
			&& typeof row.bodyId === 'string'
			&& revisions.has(revisionKey(row.projectId, row.projectRevision))) bodies.add(row.bodyId);
	}
	return Object.freeze({ revisions, bodies });
}

function retainedMetadata(database: DatabaseSync): readonly Readonly<SoundscaperDesktopLibraryMetadata>[] {
	const rows = database.prepare(`
		SELECT json, digest FROM library_metadata
		UNION ALL SELECT previous_json, previous_digest FROM metadata_journal
			WHERE state IN ('prepared', 'committed')
		UNION ALL SELECT next_json, next_digest FROM metadata_journal
			WHERE state IN ('prepared', 'committed')
		UNION ALL SELECT previous_metadata_json, previous_metadata_digest FROM publication_journal
			WHERE state IN ('prepared', 'materialized', 'committed')
		UNION ALL SELECT next_metadata_json, next_metadata_digest FROM publication_journal
			WHERE state IN ('prepared', 'materialized', 'committed')
	`).all() as { json: unknown; digest: unknown }[];
	return rows.map((row) => {
		if (typeof row.json !== 'string' || typeof row.digest !== 'string'
			|| createHash('sha256').update(row.json, 'utf8').digest('hex') !== row.digest) {
			throw new Error('Soundscaper desktop baseline retained metadata journal integrity is invalid');
		}
		return parseSoundscaperDesktopLibraryMetadataJson(row.json);
	});
}

function retainedPublicationBodyIds(value: unknown): readonly string[] {
	if (typeof value !== 'string') {
		throw new TypeError('Soundscaper desktop baseline retained publication body inventory is invalid');
	}
	let parsed: unknown;
	try { parsed = JSON.parse(value) as unknown; }
	catch (error) {
		throw new TypeError('Soundscaper desktop baseline retained publication body inventory is invalid', { cause: error });
	}
	if (!Array.isArray(parsed) || parsed.length > 4_094) {
		throw new TypeError('Soundscaper desktop baseline retained publication body inventory is invalid');
	}
	return parsed.map((candidate) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError('Soundscaper desktop baseline retained publication body is invalid');
		}
		const record = candidate as Record<string, unknown>;
		const descriptor = validateSoundscaperDesktopProjectLibraryTransferBody(record.descriptor);
		if (record.bodyId !== descriptor.bindingId) {
			throw new Error('Soundscaper desktop baseline retained publication body identity changed');
		}
		return descriptor.bindingId;
	});
}

function queueUnreferenced(
	database: DatabaseSync,
	roots: Readonly<{ revisions: ReadonlySet<string>; bodies: ReadonlySet<string> }>,
): readonly ReclamationRow[] {
	const queue = database.prepare(`
		INSERT OR IGNORE INTO storage_reclamation
		(relative_file, role, created_at_ms) VALUES (?, ?, ?)
	`);
	const revisions = database.prepare(`
		SELECT project_id AS projectId, project_revision AS projectRevision,
			relative_file AS relativeFile, published_at_ms AS publishedAtMs
		FROM project_revisions
	`).all() as {
		projectId: string; projectRevision: number; relativeFile: string; publishedAtMs: number;
	}[];
	for (const row of revisions) {
		if (roots.revisions.has(revisionKey(row.projectId, row.projectRevision))) continue;
		database.prepare(`
			DELETE FROM project_revision_bodies WHERE project_id = ? AND project_revision = ?
		`).run(row.projectId, row.projectRevision);
		database.prepare(`
			DELETE FROM project_revisions WHERE project_id = ? AND project_revision = ?
		`).run(row.projectId, row.projectRevision);
		queue.run(`projects/${row.relativeFile}`, 'project', row.publishedAtMs);
	}
	const bodies = database.prepare(`
		SELECT body_id AS bodyId, relative_file AS relativeFile, published_at_ms AS publishedAtMs
		FROM managed_bodies
	`).all() as { bodyId: string; relativeFile: string; publishedAtMs: number }[];
	for (const row of bodies) {
		if (roots.bodies.has(row.bodyId) || database.prepare(`
			SELECT 1 AS owned FROM project_revision_bodies WHERE body_id = ? LIMIT 1
		`).get(row.bodyId)) continue;
		database.prepare('DELETE FROM managed_bodies WHERE body_id = ?').run(row.bodyId);
		queue.run(`media/${row.relativeFile}`, 'media', row.publishedAtMs);
	}
	discardReintroducedPaths(database);
	const queued = database.prepare(`
		SELECT relative_file AS relativeFile, role FROM storage_reclamation ORDER BY relative_file
	`).all() as { relativeFile: unknown; role: unknown }[];
	return Object.freeze(queued.map((row) => {
		if (typeof row.relativeFile !== 'string' || (row.role !== 'project' && row.role !== 'media')) {
			throw new TypeError('Soundscaper desktop baseline reclamation journal row is invalid');
		}
		return Object.freeze({ relativeFile: row.relativeFile, role: row.role });
	}));
}

function discardReintroducedPaths(database: DatabaseSync): void {
	database.exec(`
		DELETE FROM storage_reclamation
		WHERE (role = 'project' AND substr(relative_file, 1, 9) = 'projects/' AND EXISTS (
			SELECT 1 FROM project_revisions
			WHERE relative_file = substr(storage_reclamation.relative_file, 10)
		)) OR (role = 'media' AND substr(relative_file, 1, 6) = 'media/' AND EXISTS (
			SELECT 1 FROM managed_bodies
			WHERE relative_file = substr(storage_reclamation.relative_file, 7)
		))
	`);
}

function reclamationPath(
	paths: Readonly<SoundscaperDesktopProjectLibraryPaths>,
	row: ReclamationRow,
): string {
	const prefix = row.role === 'project' ? 'projects/' : 'media/';
	if (!row.relativeFile.startsWith(prefix)) {
		throw new Error('Soundscaper desktop baseline reclamation role and path disagree');
	}
	const root = resolve(paths.libraryRoot);
	const candidate = resolve(root, ...row.relativeFile.split('/'));
	const child = relative(root, candidate);
	if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
		throw new Error('Soundscaper desktop baseline reclamation path leaves its library root');
	}
	return candidate;
}

function revisionKey(projectId: string, revision: number): string {
	return `${projectId}\0${String(revision)}`;
}

function transaction<Result>(database: DatabaseSync, operation: () => Result): Result {
	if (database.isTransaction) throw new Error('Soundscaper desktop baseline reclamation cannot nest a transaction');
	database.exec('BEGIN IMMEDIATE');
	try {
		const result = operation();
		database.exec('COMMIT');
		return result;
	} catch (error) {
		if (database.isTransaction) database.exec('ROLLBACK');
		throw error;
	}
}

function errorCode(error: unknown): string | null {
	return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
		? error.code
		: null;
}
