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
	restartDesktopLibraryProjectFileReclamationCycle,
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
import {
	advanceDesktopLibraryProjectStageReclamation,
	consumeDesktopLibraryProjectRescanRequired,
	ensureDesktopLibraryProjectStageReclamationCycle,
	hasDesktopLibraryProjectStageInventoryRows,
	markDesktopLibraryProjectRescanRequired,
	readDesktopLibraryProjectReclamationKind,
	readDesktopLibraryProjectStageInventoryBatch,
	removeDesktopLibraryProjectStageInventoryRow,
	setDesktopLibraryProjectReclamationKind,
	type DesktopLibraryProjectStageInventoryRow,
} from './project-library-stage-inventory.ts';

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
	readonly liveStageFiles: number;
	readonly protectedFiles: number;
	readonly reclaimedFiles: number;
	readonly reclaimedStageFiles: number;
	readonly stageFiles: number;
}

interface ReclamationBatchResult extends DesktopLibraryProjectReclamationResult {
	readonly projectCycleRestarted: boolean;
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
				ensureDesktopLibraryProjectStageReclamationCycle(database);
			});
			await this.#checkpoint('planned');
			throwIfAborted(options.signal);
			let scannedEntries = 0;
			let canonicalFiles = 0;
			let protectedFiles = 0;
			let reclaimedFiles = 0;
			let stageFiles = 0;
			let liveStageFiles = 0;
			let reclaimedStageFiles = 0;
			let projectComplete = false;
			let stageComplete = false;
			while (scannedEntries < this.#maximumEntries && (!projectComplete || !stageComplete)) {
				throwIfAborted(options.signal);
				const capacity = Math.min(RECLAMATION_BATCH_SIZE, this.#maximumEntries - scannedEntries);
				let kind: 'project' | 'stage' = stageComplete
					? 'project'
					: projectComplete
						? 'stage'
						: 'stage';
				const scheduled = !stageComplete && !projectComplete;
				const result = withImmediateTransaction(database, () => {
					if (scheduled) kind = readDesktopLibraryProjectReclamationKind(database);
					return kind === 'stage'
						? this.#reclaimStageBatch(database, lease, capacity, options.signal)
						: this.#reclaimProjectBatch(database, lease, capacity, options.signal);
				});
				scannedEntries += result.scannedEntries;
				canonicalFiles += result.canonicalFiles;
				protectedFiles += result.protectedFiles;
				reclaimedFiles += result.reclaimedFiles;
				stageFiles += result.stageFiles;
				liveStageFiles += result.liveStageFiles;
				reclaimedStageFiles += result.reclaimedStageFiles;
				if (kind === 'stage') {
					stageComplete = result.complete;
					if (result.projectCycleRestarted) projectComplete = false;
				} else projectComplete = result.complete;
				if (result.scannedEntries > 0) await this.#yieldAfterBatch(options.signal);
			}
			const complete = projectComplete && stageComplete;
			return Object.freeze({
				scannedEntries,
				canonicalFiles,
				complete,
				liveStageFiles,
				protectedFiles,
				reclaimedFiles,
				reclaimedStageFiles,
				stageFiles,
			});
		} finally {
			database.close();
		}
	}

	#reclaimProjectBatch(
		database: DatabaseSync,
		lease: DesktopLibraryLease,
		maximum: number,
		signal?: AbortSignal,
	): ReclamationBatchResult {
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
			const currentReservation = candidate.leaseId === lease.leaseId
				&& candidate.fencingToken === lease.fencingToken;
			if (protectedFile) protectedCount += 1;
			if (currentReservation
				|| hasDesktopLibraryProjectStageInventoryRows(database, candidate.metadataFile)) continue;
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
		setDesktopLibraryProjectReclamationKind(database, 'stage');
		return Object.freeze({
			canonicalFiles: batch.rows.length,
			complete: batch.complete,
			liveStageFiles: 0,
			protectedFiles: protectedCount,
			reclaimedFiles: reclaimedCount,
			reclaimedStageFiles: 0,
			scannedEntries: batch.rows.length,
			stageFiles: 0,
			projectCycleRestarted: false,
		});
	}

	#reclaimStageBatch(
		database: DatabaseSync,
		lease: DesktopLibraryLease,
		maximum: number,
		signal?: AbortSignal,
	): ReclamationBatchResult {
		assertLeaseOwned(database, lease, this.#now);
		assertRealDirectory(this.#paths.projectsRoot, 'Desktop project stage reclamation root');
		const batch = readDesktopLibraryProjectStageInventoryBatch(database, maximum);
		const affectedDirectories = new Set<string>();
		const completedRows: number[] = [];
		let liveStageFiles = 0;
		let reclaimedStageFiles = 0;
		for (const candidate of batch.rows) {
			throwIfAborted(signal);
			const path = stageInventoryPath(this.#paths.projectsRoot, candidate);
			const live = candidate.leaseId === lease.leaseId
				&& candidate.fencingToken === lease.fencingToken;
			if (live) {
				liveStageFiles += 1;
				continue;
			}
			const directoryKind = directDirectoryKind(dirname(path));
			if (directoryKind === 'missing') {
				completedRows.push(candidate.id);
				continue;
			}
			if (directoryKind !== 'directory') continue;
			const kind = fileKind(path);
			if (kind === 'other') continue;
			if (kind === 'regular' && removeRegularFile(path)) {
				reclaimedStageFiles += 1;
				affectedDirectories.add(dirname(path));
			}
			completedRows.push(candidate.id);
		}
		for (const directory of affectedDirectories) syncDirectory(directory);
		assertLeaseOwned(database, lease, this.#now);
		for (const id of completedRows) removeDesktopLibraryProjectStageInventoryRow(database, id);
		const lastId = batch.rows.at(-1)?.id ?? 0;
		advanceDesktopLibraryProjectStageReclamation(database, lastId, batch.complete);
		if (completedRows.length > 0) markDesktopLibraryProjectRescanRequired(database);
		const projectCycleRestarted = batch.complete
			&& consumeDesktopLibraryProjectRescanRequired(database);
		if (projectCycleRestarted) restartDesktopLibraryProjectFileReclamationCycle(database);
		setDesktopLibraryProjectReclamationKind(database, 'project');
		return Object.freeze({
			canonicalFiles: 0,
			complete: batch.complete,
			liveStageFiles,
			protectedFiles: 0,
			reclaimedFiles: reclaimedStageFiles,
			reclaimedStageFiles,
			scannedEntries: batch.rows.length,
			stageFiles: batch.rows.length,
			projectCycleRestarted,
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

function stageInventoryPath(projectsRoot: string, row: DesktopLibraryProjectStageInventoryRow): string {
	return join(projectsRoot, ...row.stageFile.split('/'));
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
