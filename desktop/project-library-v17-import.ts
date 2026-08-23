/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { constants, access, chmod, copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { FramescaperDesktopProjectLibraryExactGenerationPaths } from './project-library-exact-generation-contract.ts';
import { framescaperDesktopProjectLibraryExactGenerationMetadataRevision as metadataRevision } from './project-library-exact-generation-database.ts';
import {
	framescaperDesktopExactMediaPath,
	parseFramescaperDesktopExactBodies,
	type FramescaperDesktopExactBodyDescriptor,
} from './project-library-exact-generation-storage.ts';
import { createFramescaperDesktopProjectLibraryV12Paths } from './project-library-v12-contract.ts';
import { validateFramescaperDesktopCurrentProjectV20 } from './project-library-v12-current-project.ts';

interface SourceRow {
	readonly entry_id: string;
	readonly project_id: string;
	readonly title: string;
	readonly updated_at_ms: number;
	readonly project_revision: number;
	readonly document_file: string;
	readonly byte_length: number;
	readonly sha256: string;
	readonly bodies_json: string;
}

interface ImportManifest {
	readonly digest: string;
	readonly metadataRevision: number;
	readonly rows: readonly Readonly<SourceRow>[];
}

export async function importFramescaperDesktopProjectLibraryV12IntoV17(value: Readonly<{
	appDataPath: string;
	database: DatabaseSync;
	destinationPaths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>;
	assertLeaseInTransaction(database: DatabaseSync): void;
	checkpoint: ((completedProjects: number) => void) | null;
}>): Promise<void> {
	const sourcePaths = createFramescaperDesktopProjectLibraryV12Paths(value.appDataPath);
	let source: DatabaseSync | null = null;
	try {
		await access(sourcePaths.databasePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		completeAbsentImport(value.database, value.assertLeaseInTransaction);
		return;
	}
	try {
		source = new DatabaseSync(sourcePaths.databasePath, { readOnly: true, timeout: 50 });
		validateV12Identity(source);
		const manifest = sourceManifest(source);
		const progress = prepareProgress(value.database, manifest, value.assertLeaseInTransaction);
		for (let index = progress; index < manifest.rows.length; index += 1) {
			const row = manifest.rows[index]!;
			await copyRow(sourcePaths, value.destinationPaths, row);
			publishRow(value.database, row, index + 1, value.assertLeaseInTransaction);
			value.checkpoint?.(index + 1);
		}
		const finalManifest = sourceManifest(source);
		if (finalManifest.digest !== manifest.digest) {
			throw new Error('Framescaper V12 source catalog changed during copy-forward');
		}
		completeImport(value.database, manifest, value.assertLeaseInTransaction);
	} finally {
		source?.close();
	}
}

function validateV12Identity(database: DatabaseSync): void {
	const applicationId = Number(database.prepare('PRAGMA application_id').get()?.application_id);
	const userVersion = Number(database.prepare('PRAGMA user_version').get()?.user_version);
	const identity = database.prepare(`
		SELECT schema_version AS schemaVersion, project_schema_version AS projectSchemaVersion
		FROM library_identity WHERE singleton = 1
	`).get() as Record<string, unknown> | undefined;
	if (applicationId !== 0x46534350 || userVersion !== 14
		|| identity?.schemaVersion !== 12 || identity.projectSchemaVersion !== 20) {
		throw new Error('Framescaper V12 copy-forward source identity is unsupported');
	}
}

function sourceManifest(database: DatabaseSync): Readonly<ImportManifest> {
	const rows = database.prepare(`
		SELECT entry_id, project_id, title, updated_at_ms, project_revision,
			document_file, byte_length, sha256, bodies_json
		FROM projects ORDER BY project_id ASC
	`).all() as unknown as SourceRow[];
	const revision = metadataRevision(database);
	const canonical = JSON.stringify({ metadataRevision: revision, rows });
	return Object.freeze({
		digest: createHash('sha256').update(canonical).digest('hex'),
		metadataRevision: revision,
		rows: Object.freeze(rows.map((row) => Object.freeze({ ...row }))),
	});
}

function prepareProgress(
	database: DatabaseSync,
	manifest: Readonly<ImportManifest>,
	assertLease: (database: DatabaseSync) => void,
): number {
	database.exec('BEGIN IMMEDIATE');
	try {
		assertLease(database);
		const stored = database.prepare('SELECT * FROM v12_import WHERE singleton = 1').get() as
			Record<string, unknown> | undefined;
		if (!stored) {
			if (Number(database.prepare('SELECT COUNT(*) AS count FROM projects').get()?.count) !== 0) {
				throw new Error('Framescaper V17 import destination is not empty');
			}
			database.prepare(`
				INSERT INTO v12_import (
					singleton, state, source_catalog_sha256, source_metadata_revision,
					source_project_count, next_project_index, completed_at_ms
				) VALUES (1, 'pending', ?, ?, ?, 0, NULL)
			`).run(manifest.digest, manifest.metadataRevision, manifest.rows.length);
			database.exec('COMMIT');
			return 0;
		}
		if (stored.source_catalog_sha256 !== manifest.digest
			|| stored.source_metadata_revision !== manifest.metadataRevision
			|| stored.source_project_count !== manifest.rows.length) {
			throw new Error('Framescaper V12 copy-forward source changed after durable admission');
		}
		const next = nonNegative(stored.next_project_index, 'V12 import cursor');
		if (next > manifest.rows.length) throw new Error('Framescaper V17 import cursor is invalid');
		database.exec('COMMIT');
		return next;
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}

async function copyRow(
	sourcePaths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>,
	destinationPaths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>,
	row: Readonly<SourceRow>,
): Promise<void> {
	if (!Number.isSafeInteger(row.byte_length) || row.byte_length < 1 || !digest(row.sha256)) {
		throw new Error('Framescaper V12 project row has invalid file geometry');
	}
	if (!/^[a-f0-9]{48}$/u.test(row.entry_id)) {
		throw new Error('Framescaper V12 project row has an invalid entry identity');
	}
	const sourceDocument = containedPath(sourcePaths.projectsRoot, row.document_file, 'V12 document');
	const sourceBytes = await readVerifiedFile(sourceDocument, row.byte_length, row.sha256);
	const sourceText = decodeDocument(sourceBytes);
	const sourceProject = validateFramescaperDesktopCurrentProjectV20(JSON.parse(sourceText) as unknown);
	if (sourceProject.id !== row.project_id || sourceProject.title !== row.title
		|| sourceProject.revision !== row.project_revision
		|| Date.parse(String(sourceProject.updatedAt)) !== row.updated_at_ms) {
		throw new Error('Framescaper V12 project row disagrees with its exact document');
	}
	const destinationDocument = containedPath(destinationPaths.projectsRoot, row.document_file, 'V17 document');
	await copyExactFile(sourceDocument, destinationDocument, row.byte_length, row.sha256);
	const bodies = parseFramescaperDesktopExactBodies(row.bodies_json, 'Framescaper V12 import');
	for (const body of bodies) {
		await copyBody(sourcePaths, destinationPaths, body);
	}
}

async function copyBody(
	sourcePaths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>,
	destinationPaths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>,
	body: Readonly<FramescaperDesktopExactBodyDescriptor>,
): Promise<void> {
	await copyExactFile(
		framescaperDesktopExactMediaPath(sourcePaths, body),
		framescaperDesktopExactMediaPath(destinationPaths, body),
		body.byteLength,
		body.sha256,
	);
}

async function copyExactFile(source: string, destination: string, byteLength: number, sha256: string): Promise<void> {
	await verifyFile(source, byteLength, sha256);
	try {
		await verifyFile(destination, byteLength, sha256);
		return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
	await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
	const temporary = `${destination}.import-${randomBytes(8).toString('hex')}`;
	try {
		await copyFile(source, temporary, constants.COPYFILE_EXCL);
		await chmod(temporary, 0o600);
		await verifyFile(temporary, byteLength, sha256);
		await rename(temporary, destination);
	} finally {
		await rm(temporary, { force: true });
	}
}

async function verifyFile(path: string, byteLength: number, expectedSha256: string): Promise<void> {
	const before = await stat(path);
	if (!before.isFile() || before.size !== byteLength) throw new Error('Framescaper copy-forward file geometry changed');
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	if (hash.digest('hex') !== expectedSha256) throw new Error('Framescaper copy-forward file digest changed');
	const after = await stat(path);
	if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
		throw new Error('Framescaper copy-forward source changed during verification');
	}
}

async function readVerifiedFile(
	path: string,
	byteLength: number,
	expectedSha256: string,
): Promise<Uint8Array> {
	await verifyFile(path, byteLength, expectedSha256);
	const bytes = await readFile(path);
	if (bytes.byteLength !== byteLength
		|| createHash('sha256').update(bytes).digest('hex') !== expectedSha256) {
		throw new Error('Framescaper copy-forward source changed during document read');
	}
	return bytes;
}

function decodeDocument(bytes: Uint8Array): string {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (error) {
		throw new Error('Framescaper V12 project document is not valid UTF-8', { cause: error });
	}
}

function publishRow(
	database: DatabaseSync,
	row: Readonly<SourceRow>,
	nextIndex: number,
	assertLease: (database: DatabaseSync) => void,
): void {
	database.exec('BEGIN IMMEDIATE');
	try {
		assertLease(database);
		const existing = database.prepare('SELECT * FROM projects WHERE project_id = ?').get(row.project_id) as
			Record<string, unknown> | undefined;
		if (existing) {
			for (const field of Object.keys(row) as Array<keyof SourceRow>) {
				if (existing[field] !== row[field]) throw new Error('Framescaper V17 import row conflicts');
			}
		} else {
			database.prepare(`
				INSERT INTO projects (
					entry_id, project_id, title, updated_at_ms, project_revision,
					document_file, byte_length, sha256, bodies_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).run(
				row.entry_id, row.project_id, row.title, row.updated_at_ms, row.project_revision,
				row.document_file, row.byte_length, row.sha256, row.bodies_json,
			);
		}
		database.prepare(`
			UPDATE v12_import SET next_project_index = ?
			WHERE singleton = 1 AND state = 'pending' AND next_project_index <= ?
		`).run(nextIndex, nextIndex);
		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}

function completeImport(
	database: DatabaseSync,
	manifest: Readonly<ImportManifest>,
	assertLease: (database: DatabaseSync) => void,
): void {
	database.exec('BEGIN IMMEDIATE');
	try {
		assertLease(database);
		const progress = database.prepare('SELECT * FROM v12_import WHERE singleton = 1').get() as Record<string, unknown>;
		if (progress.next_project_index !== manifest.rows.length) throw new Error('Framescaper V17 import is incomplete');
		database.prepare('UPDATE library_identity SET metadata_revision = ? WHERE singleton = 1')
			.run(manifest.metadataRevision);
		database.prepare(`
			UPDATE v12_import SET state = 'complete', completed_at_ms = ? WHERE singleton = 1
		`).run(Date.now());
		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}

function completeAbsentImport(database: DatabaseSync, assertLease: (database: DatabaseSync) => void): void {
	database.exec('BEGIN IMMEDIATE');
	try {
		assertLease(database);
		const existing = database.prepare('SELECT state FROM v12_import WHERE singleton = 1').get() as
			Record<string, unknown> | undefined;
		if (existing?.state !== undefined && existing.state !== 'complete') {
			throw new Error('Framescaper V12 source is unavailable after durable import admission');
		}
		if (!existing) {
			if (Number(database.prepare('SELECT COUNT(*) AS count FROM projects').get()?.count) !== 0) {
				throw new Error('Framescaper V17 import destination is not empty');
			}
			database.prepare(`
				INSERT INTO v12_import (
					singleton, state, source_catalog_sha256, source_metadata_revision,
					source_project_count, next_project_index, completed_at_ms
				) VALUES (1, 'complete', ?, 0, 0, 0, ?)
			`).run('0'.repeat(64), Date.now());
		}
		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}

function containedPath(root: string, value: string, label: string): string {
	if (typeof value !== 'string' || !value || value.includes('\0')) throw new TypeError(`${label} path is invalid`);
	const result = resolve(root, value);
	const relation = relative(resolve(root), result);
	if (!relation || relation === '..' || relation.startsWith(`..${sep}`)) throw new TypeError(`${label} leaves its root`);
	return result;
}

function digest(value: unknown): value is string {
	return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function nonNegative(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError(`${label} is invalid`);
	return Number(value);
}
