/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	closeSync,
	fsyncSync,
	lstatSync,
	openSync,
	renameSync,
	unlinkSync,
} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { setImmediate as waitForImmediate } from 'node:timers/promises';

import { throwIfAborted } from './project-library-abort.ts';
import {
	type DesktopLibraryLease,
	type DesktopProjectLibraryPaths,
	validateDesktopProjectLibraryPaths,
} from './project-library-contract.ts';
import { assertDesktopProjectLibraryDatabaseIdentity } from './project-library-database.ts';
import {
	advanceDesktopLibraryProjectFileReclamation,
	createDesktopLibraryProjectQuarantineFile,
	ensureDesktopLibraryProjectFileReclamationCycle,
	readDesktopLibraryProjectFileInventoryBatch,
	removeDesktopLibraryProjectFileInventoryRow,
	type DesktopLibraryProjectFileInventoryRow,
} from './project-library-file-inventory.ts';
import {
	sameLease,
	validateJournalRow,
	validateLeaseToken,
	validateMetadataIntegrity,
	validateMetadataRow,
	validatePersistedLease,
} from './project-library-persistence.ts';

const MAX_RECLAMATION_ENTRIES = 100_000;
const RECLAMATION_BATCH_SIZE = 64;

export type DesktopLibraryProjectReclamationCheckpoint = 'batch' | 'planned';

export interface DesktopLibraryProjectReclaimerOptions {
	readonly checkpoint?: (
		phase: DesktopLibraryProjectReclamationCheckpoint,
	) => void | Promise<void>;
	readonly maximumEntries?: number;
	readonly now?: () => number;
}

export interface DesktopLibraryProjectReclaimOptions {
	readonly lease: DesktopLibraryLease;
	readonly signal?: AbortSignal;
}

export interface DesktopLibraryProjectReclamationResult {
	readonly scannedEntries: number;
	readonly canonicalFiles: number;
	readonly complete: boolean;
	readonly protectedFiles: number;
	readonly reclaimedFiles: number;
}

/** Main-process startup maintenance. No path or lease value crosses IPC. */
export class DesktopLibraryProjectReclaimer {
	#checkpoint: (phase: DesktopLibraryProjectReclamationCheckpoint) => void | Promise<void>;
	#maximumEntries: number;
	#now: () => number;
	#paths: DesktopProjectLibraryPaths;

	constructor(paths: DesktopProjectLibraryPaths, options: DesktopLibraryProjectReclaimerOptions = {}) {
		this.#paths = validateDesktopProjectLibraryPaths(paths);
		this.#maximumEntries = maximumEntries(options.maximumEntries);
		this.#now = options.now ?? Date.now;
		this.#checkpoint = options.checkpoint ?? (() => {});
	}

	async reclaim(options: DesktopLibraryProjectReclaimOptions): Promise<DesktopLibraryProjectReclamationResult> {
		const lease = validateLeaseToken(options.lease);
		throwIfAborted(options.signal);
		const database = openMaintenanceDatabase(this.#paths.databasePath);
		try {
			withImmediateTransaction(database, () => {
				assertLeaseOwned(database, lease, this.#now);
				protectedProjectFiles(database);
				assertRealDirectory(this.#paths.projectsRoot, 'Desktop project reclamation root');
				ensureDesktopLibraryProjectFileReclamationCycle(database);
			});
			await this.#checkpoint('planned');
			throwIfAborted(options.signal);
			let scannedEntries = 0;
			let canonicalFiles = 0;
			let protectedFiles = 0;
			let reclaimedFiles = 0;
			let complete = false;
			while (scannedEntries < this.#maximumEntries && !complete) {
				throwIfAborted(options.signal);
				const capacity = Math.min(RECLAMATION_BATCH_SIZE, this.#maximumEntries - scannedEntries);
				const result = withImmediateTransaction(database, () => this.#reclaimInventoryBatch(
					database,
					lease,
					capacity,
					options.signal,
				));
				scannedEntries += result.scannedEntries;
				canonicalFiles += result.canonicalFiles;
				protectedFiles += result.protectedFiles;
				reclaimedFiles += result.reclaimedFiles;
				complete = result.complete;
				if (result.scannedEntries > 0) await this.#yieldAfterBatch(options.signal);
			}
			return Object.freeze({
				scannedEntries,
				canonicalFiles,
				complete,
				protectedFiles,
				reclaimedFiles,
			});
		} finally {
			database.close();
		}
	}

	#reclaimInventoryBatch(
		database: DatabaseSync,
		lease: DesktopLibraryLease,
		maximum: number,
		signal?: AbortSignal,
	): Readonly<{
		canonicalFiles: number;
		complete: boolean;
		protectedFiles: number;
		reclaimedFiles: number;
		scannedEntries: number;
	}> {
		assertLeaseOwned(database, lease, this.#now);
		const protectedFiles = protectedProjectFiles(database);
		assertRealDirectory(this.#paths.projectsRoot, 'Desktop project reclamation root');
		const batch = readDesktopLibraryProjectFileInventoryBatch(database, maximum);
		const affectedDirectories = new Set<string>();
		const completedRows: number[] = [];
		let protectedCount = 0;
		let reclaimedCount = 0;
		for (const candidate of batch.rows) {
			throwIfAborted(signal);
			const paths = inventoryPaths(this.#paths.projectsRoot, candidate);
			const protectedFile = protectedFiles.has(candidate.portableKey);
			if (protectedFile) protectedCount += 1;
			const directoryKind = directDirectoryKind(paths.directory);
			if (directoryKind === 'missing') {
				if (!protectedFile) completedRows.push(candidate.id);
				continue;
			}
			if (directoryKind !== 'directory') continue;
			const canonicalKind = fileKind(paths.canonicalPath);
			const quarantineKind = fileKind(paths.quarantinePath);
			if (canonicalKind === 'other' || quarantineKind === 'other') continue;
			if (protectedFile) {
				if (canonicalKind === 'regular'
					&& quarantineKind === 'regular'
					&& removeRegularFile(paths.quarantinePath)) {
					reclaimedCount += 1;
					affectedDirectories.add(paths.directory);
				}
				continue;
			}
			if (quarantineKind === 'regular' && removeRegularFile(paths.quarantinePath)) {
				reclaimedCount += 1;
				affectedDirectories.add(paths.directory);
			}
			if (canonicalKind === 'regular') {
				renameSync(paths.canonicalPath, paths.quarantinePath);
				affectedDirectories.add(paths.directory);
				if (removeRegularFile(paths.quarantinePath)) reclaimedCount += 1;
			}
			if (fileKind(paths.canonicalPath) === 'missing'
				&& fileKind(paths.quarantinePath) === 'missing') {
				completedRows.push(candidate.id);
			}
		}
		for (const directory of affectedDirectories) syncDirectory(directory);
		assertLeaseOwned(database, lease, this.#now);
		for (const id of completedRows) removeDesktopLibraryProjectFileInventoryRow(database, id);
		const lastId = batch.rows.at(-1)?.id ?? 0;
		advanceDesktopLibraryProjectFileReclamation(database, lastId, batch.complete);
		return Object.freeze({
			canonicalFiles: batch.rows.length,
			complete: batch.complete,
			protectedFiles: protectedCount,
			reclaimedFiles: reclaimedCount,
			scannedEntries: batch.rows.length,
		});
	}

	async #yieldAfterBatch(signal?: AbortSignal): Promise<void> {
		await this.#checkpoint('batch');
		await waitForImmediate(undefined, { signal });
		throwIfAborted(signal);
	}
}

function inventoryPaths(
	projectsRoot: string,
	row: DesktopLibraryProjectFileInventoryRow,
): Readonly<{ canonicalPath: string; directory: string; quarantinePath: string }> {
	const canonicalPath = join(projectsRoot, ...row.metadataFile.split('/'));
	const quarantineFile = createDesktopLibraryProjectQuarantineFile(row.metadataFile);
	return Object.freeze({
		canonicalPath,
		directory: dirname(canonicalPath),
		quarantinePath: join(projectsRoot, ...quarantineFile.split('/')),
	});
}

function protectedProjectFiles(database: DatabaseSync): ReadonlySet<string> {
	const currentRaw = database.prepare(`
		SELECT revision, json, digest, published_at_ms AS publishedAtMs
		FROM library_metadata WHERE singleton = 1
	`).get();
	if (!currentRaw) throw new Error('Desktop library metadata row is missing');
	const current = validateMetadataIntegrity(
		validateMetadataRow(currentRaw, 'persisted metadata'),
		'Desktop library metadata',
	);
	const references = new Set(current.projects.map(({ metadataFile }) => portablePathKey(metadataFile)));
	const pending = database.prepare(`
		SELECT * FROM metadata_journal
		WHERE state IN ('prepared', 'committed')
		ORDER BY created_at_ms, transaction_id
	`).all();
	if (pending.length > 1) throw new Error('Desktop project library has conflicting recovery journals');
	for (const raw of pending) {
		const journal = validateJournalRow(raw);
		for (const row of [journal.previous, journal.next]) {
			const metadata = validateMetadataIntegrity(row, 'recoverable desktop library metadata');
			for (const { metadataFile } of metadata.projects) references.add(portablePathKey(metadataFile));
		}
	}
	return references;
}

function assertLeaseOwned(database: DatabaseSync, token: DesktopLibraryLease, now: () => number): void {
	const raw = database.prepare(`
		SELECT active, lease_id AS leaseId, fencing_token AS fencingToken,
			owner_product AS ownerProduct, owner_process_id AS ownerProcessId,
			owner_instance_id AS ownerInstanceId, acquired_at_ms AS acquiredAtMs,
			expires_at_ms AS expiresAtMs, took_over AS tookOver
		FROM library_lease WHERE singleton = 1
	`).get();
	if (!raw) throw new Error('Desktop project library lease row is missing');
	if (raw.active !== 0 && raw.active !== 1) throw new TypeError('Persisted desktop library lease state is invalid');
	const fencingToken = nonNegativeInteger(raw.fencingToken, 'persisted lease fencing token');
	if (raw.active !== 1 || fencingToken === 0) throw leaseLost();
	const current = validatePersistedLease(raw, fencingToken);
	if (!sameLease(current, token) || current.expiresAtMs <= timestamp(now())) throw leaseLost();
}

function openMaintenanceDatabase(path: string): DatabaseSync {
	const database = new DatabaseSync(path, {
		allowExtension: false,
		enableDoubleQuotedStringLiterals: false,
		enableForeignKeyConstraints: true,
		timeout: 50,
	});
	try {
		database.exec('PRAGMA trusted_schema = OFF;');
		assertDesktopProjectLibraryDatabaseIdentity(database);
		return database;
	} catch (error) {
		database.close();
		throw error;
	}
}

function withImmediateTransaction<Result>(database: DatabaseSync, operation: () => Result): Result {
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

function portablePathKey(value: string): string {
	return value.toLowerCase();
}

function fileKind(path: string): 'missing' | 'other' | 'regular' {
	const metadata = lstatSync(path, { throwIfNoEntry: false });
	if (!metadata) return 'missing';
	return metadata.isFile() ? 'regular' : 'other';
}

function isRealDirectory(path: string): boolean {
	return lstatSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}

function directDirectoryKind(path: string): 'directory' | 'missing' | 'other' {
	const metadata = lstatSync(path, { throwIfNoEntry: false });
	if (!metadata) return 'missing';
	return metadata.isDirectory() ? 'directory' : 'other';
}

function assertRealDirectory(path: string, label: string): void {
	if (!isRealDirectory(path)) {
		throw new TypeError(`${label} is not a direct filesystem directory`);
	}
}

function removeRegularFile(path: string): boolean {
	if (lstatSync(path, { throwIfNoEntry: false })?.isFile() !== true) return false;
	unlinkSync(path);
	return true;
}

function syncDirectory(directory: string): void {
	if (process.platform === 'win32') return;
	const descriptor = openSync(directory, 'r');
	try {
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
}

function maximumEntries(value: number | undefined): number {
	const maximum = value ?? MAX_RECLAMATION_ENTRIES;
	if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_RECLAMATION_ENTRIES) {
		throw new RangeError('Desktop project reclamation entry limit is invalid');
	}
	return maximum;
}

function timestamp(value: unknown): number {
	return nonNegativeInteger(value, 'desktop project reclamation clock');
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${label} must be a non-negative safe integer`);
	}
	return value;
}

function leaseLost(): Error {
	return new Error('Desktop library lease holder no longer owns the lease');
}
