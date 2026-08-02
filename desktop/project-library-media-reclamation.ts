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
	type DesktopLibraryMedia,
	type DesktopLibraryMetadata,
	type DesktopProjectLibraryPaths,
	validateDesktopLibraryMetadata,
	validateDesktopProjectLibraryPaths,
} from './project-library-contract.ts';
import { assertDesktopProjectLibraryDatabaseIdentity } from './project-library-database.ts';
import {
	advanceDesktopLibraryManagedMediaReclamation,
	advanceDesktopLibraryManagedMediaStageReclamation,
	consumeDesktopLibraryManagedMediaRescanRequired,
	createDesktopLibraryManagedMediaQuarantineFile,
	ensureDesktopLibraryManagedMediaReclamationCycle,
	ensureDesktopLibraryManagedMediaStageReclamationCycle,
	hasDesktopLibraryManagedMediaStageInventoryRows,
	markDesktopLibraryManagedMediaRescanRequired,
	readDesktopLibraryManagedMediaInventoryBatch,
	readDesktopLibraryManagedMediaInventoryRow,
	readDesktopLibraryManagedMediaReclamationKind,
	readDesktopLibraryManagedMediaStageInventoryBatch,
	removeDesktopLibraryManagedMediaInventoryRow,
	removeDesktopLibraryManagedMediaStageInventoryRow,
	restartDesktopLibraryManagedMediaReclamationCycle,
	setDesktopLibraryManagedMediaReclamationKind,
	type DesktopLibraryManagedMediaInventoryRow,
	type DesktopLibraryManagedMediaStageInventoryRow,
	validateDesktopLibraryManagedMediaInventory,
} from './project-library-media-inventory.ts';
import { isDesktopLibraryManagedMediaBindingId } from './project-library-media-binding.ts';
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

export type DesktopLibraryManagedMediaReclamationCheckpoint = 'batch' | 'planned';

export interface DesktopLibraryManagedMediaCatalogPort {
	readMetadata(): DesktopLibraryMetadata | Promise<DesktopLibraryMetadata>;
	publishMetadata(
		metadata: DesktopLibraryMetadata,
		signal?: AbortSignal,
	): Promise<DesktopLibraryMetadata>;
}

export interface DesktopLibraryManagedMediaReclaimerOptions {
	readonly catalog: DesktopLibraryManagedMediaCatalogPort;
	readonly checkpoint?: (
		phase: DesktopLibraryManagedMediaReclamationCheckpoint,
	) => void | Promise<void>;
	readonly maximumEntries?: number;
	readonly now?: () => number;
}

export interface DesktopLibraryManagedMediaReclaimOptions {
	readonly lease: DesktopLibraryLease;
	readonly signal?: AbortSignal;
}

export interface DesktopLibraryManagedMediaReclamationResult {
	readonly scannedEntries: number;
	readonly catalogRowsRetired: number;
	readonly canonicalFiles: number;
	readonly complete: boolean;
	readonly liveStageFiles: number;
	readonly protectedFiles: number;
	readonly reclaimedFiles: number;
	readonly reclaimedStageFiles: number;
	readonly stageFiles: number;
}

interface ReclamationBatchResult extends Omit<DesktopLibraryManagedMediaReclamationResult, 'catalogRowsRetired'> {
	readonly mediaCycleRestarted: boolean;
}

/** Startup-only main-process maintenance. Invoke after metadata-journal recovery and before host exposure. */
export class DesktopLibraryManagedMediaReclaimer {
	readonly #catalog: DesktopLibraryManagedMediaCatalogPort;
	readonly #checkpoint: (
		phase: DesktopLibraryManagedMediaReclamationCheckpoint,
	) => void | Promise<void>;
	readonly #maximumEntries: number;
	readonly #now: () => number;
	readonly #paths: DesktopProjectLibraryPaths;

	constructor(paths: DesktopProjectLibraryPaths, options: DesktopLibraryManagedMediaReclaimerOptions) {
		this.#paths = validateDesktopProjectLibraryPaths(paths);
		this.#maximumEntries = maximumEntries(options.maximumEntries);
		this.#now = options.now ?? Date.now;
		this.#checkpoint = options.checkpoint ?? (() => {});
		if (!options.catalog || typeof options.catalog.readMetadata !== 'function'
			|| typeof options.catalog.publishMetadata !== 'function') {
			throw new TypeError('Desktop library managed-media reclaimer requires a catalog port');
		}
		this.#catalog = options.catalog;
	}

	async reclaim(
		options: DesktopLibraryManagedMediaReclaimOptions,
	): Promise<DesktopLibraryManagedMediaReclamationResult> {
		const lease = validateLeaseToken(options.lease);
		throwIfAborted(options.signal);
		const database = openMaintenanceDatabase(this.#paths.databasePath);
		try {
			withImmediateTransaction(database, () => {
				assertLeaseOwned(database, lease, this.#now);
				assertNoPendingMetadataJournal(database);
				assertRealDirectory(this.#paths.managedMediaRoot, 'Desktop managed-media reclamation root');
				validateDesktopLibraryManagedMediaInventory(database);
				ensureDesktopLibraryManagedMediaReclamationCycle(database);
				ensureDesktopLibraryManagedMediaStageReclamationCycle(database);
			});
			await this.#checkpoint('planned');
			const catalogRowsRetired = await this.#retireStaleCatalogRows(database, lease, options.signal);
			return await this.#reclaimInventory(database, lease, catalogRowsRetired, options.signal);
		} finally {
			database.close();
		}
	}

	async #retireStaleCatalogRows(
		database: DatabaseSync,
		lease: DesktopLibraryLease,
		signal?: AbortSignal,
	): Promise<number> {
		throwIfAborted(signal);
		const current = validateDesktopLibraryMetadata(await this.#catalog.readMetadata());
		const currentProjectTuples = projectTuples(current);
		const nextMedia = withImmediateTransaction(database, () => {
			assertLeaseOwned(database, lease, this.#now);
			if (!sameMetadata(current, persistedMetadata(database))) {
				throw new Error('Desktop library managed-media catalog port is not at the persisted revision');
			}
			return current.media.filter((descriptor) => {
				if (!isDesktopLibraryManagedMediaBindingId(descriptor.id)) return true;
				const tracked = readDesktopLibraryManagedMediaInventoryRow(database, descriptor.id);
				if (!tracked) return true;
				if (!sameDescriptor(tracked, descriptor)) throw descriptorConflict();
				return currentProjectTuples.has(projectTuple(
					tracked.projectId,
					tracked.projectRevision,
					tracked.projectSha256,
				));
			});
		});
		const retired = current.media.length - nextMedia.length;
		if (retired === 0) return 0;
		const candidate = validateDesktopLibraryMetadata({
			...current,
			revision: current.revision + 1,
			media: nextMedia,
		});
		throwIfAborted(signal);
		const published = validateDesktopLibraryMetadata(
			await this.#catalog.publishMetadata(candidate, signal),
		);
		if (!sameMetadata(published, candidate)) {
			throw new Error('Desktop library managed-media catalog retirement did not publish its exact candidate');
		}
		withImmediateTransaction(database, () => {
			assertLeaseOwned(database, lease, this.#now);
			assertNoPendingMetadataJournal(database);
			if (!sameMetadata(persistedMetadata(database), candidate)) {
				throw new Error('Desktop library managed-media catalog retirement did not settle its metadata journal');
			}
			restartDesktopLibraryManagedMediaReclamationCycle(database);
		});
		return retired;
	}

	async #reclaimInventory(
		database: DatabaseSync,
		lease: DesktopLibraryLease,
		catalogRowsRetired: number,
		signal?: AbortSignal,
	): Promise<DesktopLibraryManagedMediaReclamationResult> {
		let scannedEntries = 0;
		let canonicalFiles = 0;
		let protectedFiles = 0;
		let reclaimedFiles = 0;
		let stageFiles = 0;
		let liveStageFiles = 0;
		let reclaimedStageFiles = 0;
		let mediaComplete = false;
		let stageComplete = false;
		withImmediateTransaction(database, () => {
			assertLeaseOwned(database, lease, this.#now);
			for (const descriptor of protectedManagedMedia(database).values()) {
				if (!isDesktopLibraryManagedMediaBindingId(descriptor.id)) continue;
				const tracked = readDesktopLibraryManagedMediaInventoryRow(database, descriptor.id);
				if (!tracked || (tracked.state !== 'materialized' && tracked.state !== 'published')) {
					throw new Error('Desktop library managed-media catalog requires materialized inventory');
				}
				if (!sameDescriptor(tracked, descriptor)) throw descriptorConflict();
			}
		});
		while (scannedEntries < this.#maximumEntries && (!mediaComplete || !stageComplete)) {
			throwIfAborted(signal);
			const capacity = Math.min(RECLAMATION_BATCH_SIZE, this.#maximumEntries - scannedEntries);
			let kind: 'media' | 'stage' = stageComplete ? 'media' : mediaComplete ? 'stage' : 'stage';
			const scheduled = !stageComplete && !mediaComplete;
			const result = withImmediateTransaction(database, () => {
				if (scheduled) kind = readDesktopLibraryManagedMediaReclamationKind(database);
				return kind === 'stage'
					? this.#reclaimStageBatch(database, lease, capacity, signal)
					: this.#reclaimMediaBatch(database, lease, capacity, signal);
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
				if (result.mediaCycleRestarted) mediaComplete = false;
			} else mediaComplete = result.complete;
			if (result.scannedEntries > 0) await this.#yieldAfterBatch(signal);
		}
		return Object.freeze({
			scannedEntries, catalogRowsRetired, canonicalFiles,
			complete: mediaComplete && stageComplete,
			liveStageFiles, protectedFiles, reclaimedFiles, reclaimedStageFiles, stageFiles,
		});
	}

	#reclaimStageBatch(
		database: DatabaseSync,
		lease: DesktopLibraryLease,
		maximum: number,
		signal?: AbortSignal,
	): ReclamationBatchResult {
		assertLeaseOwned(database, lease, this.#now);
		assertRealDirectory(this.#paths.managedMediaRoot, 'Desktop managed-media stage reclamation root');
		const batch = readDesktopLibraryManagedMediaStageInventoryBatch(database, maximum);
		const affectedDirectories = new Set<string>();
		const completedRows: number[] = [];
		let liveStageFiles = 0;
		let reclaimedStageFiles = 0;
		for (const candidate of batch.rows) {
			throwIfAborted(signal);
			if (belongsToLease(candidate, lease)) {
				liveStageFiles += 1;
				continue;
			}
			const path = inventoryPath(this.#paths.managedMediaRoot, candidate.stageFile);
			const directoryKind = directParentDirectoryKind(this.#paths.managedMediaRoot, candidate.stageFile);
			if (directoryKind === 'other') continue;
			const kind = directoryKind === 'missing' ? 'missing' : fileKind(path);
			if (kind === 'other') continue;
			if (kind === 'regular' && removeRegularFile(path)) {
				reclaimedStageFiles += 1;
				affectedDirectories.add(dirname(path));
			}
			completedRows.push(candidate.id);
		}
		for (const directory of affectedDirectories) syncDirectory(directory);
		assertLeaseOwned(database, lease, this.#now);
		for (const id of completedRows) removeDesktopLibraryManagedMediaStageInventoryRow(database, id);
		const lastId = batch.rows.at(-1)?.id ?? 0;
		advanceDesktopLibraryManagedMediaStageReclamation(database, lastId, batch.complete);
		if (completedRows.length > 0) markDesktopLibraryManagedMediaRescanRequired(database);
		const mediaCycleRestarted = batch.complete
			&& consumeDesktopLibraryManagedMediaRescanRequired(database);
		if (mediaCycleRestarted) restartDesktopLibraryManagedMediaReclamationCycle(database);
		setDesktopLibraryManagedMediaReclamationKind(database, 'media');
		return emptyBatchResult({
			complete: batch.complete,
			liveStageFiles,
			reclaimedStageFiles,
			reclaimedFiles: 0,
			scannedEntries: batch.rows.length,
			stageFiles: batch.rows.length,
			mediaCycleRestarted,
		});
	}

	#reclaimMediaBatch(
		database: DatabaseSync,
		lease: DesktopLibraryLease,
		maximum: number,
		signal?: AbortSignal,
	): ReclamationBatchResult {
		assertLeaseOwned(database, lease, this.#now);
		assertRealDirectory(this.#paths.managedMediaRoot, 'Desktop managed-media reclamation root');
		const protectedMedia = protectedManagedMedia(database);
		const batch = readDesktopLibraryManagedMediaInventoryBatch(database, maximum);
		const affectedDirectories = new Set<string>();
		const completedRows: number[] = [];
		let protectedFiles = 0;
		let reclaimedFiles = 0;
		for (const candidate of batch.rows) {
			throwIfAborted(signal);
			const protectedDescriptor = protectedMedia.get(candidate.bindingId);
			if (protectedDescriptor && !sameDescriptor(candidate, protectedDescriptor)) throw descriptorConflict();
			const protectedFile = protectedDescriptor !== undefined;
			if (protectedFile) protectedFiles += 1;
			if (belongsToLease(candidate, lease)
				|| hasDesktopLibraryManagedMediaStageInventoryRows(database, candidate.inventoryId)) continue;
			const directoryKind = directParentDirectoryKind(
				this.#paths.managedMediaRoot,
				candidate.relativeFile,
			);
			if (directoryKind === 'other') continue;
			const canonicalPath = inventoryPath(this.#paths.managedMediaRoot, candidate.relativeFile);
			const quarantinePath = inventoryPath(
				this.#paths.managedMediaRoot,
				createDesktopLibraryManagedMediaQuarantineFile(candidate.relativeFile),
			);
			const canonicalKind = directoryKind === 'missing' ? 'missing' : fileKind(canonicalPath);
			const quarantineKind = directoryKind === 'missing' ? 'missing' : fileKind(quarantinePath);
			if (canonicalKind === 'other' || quarantineKind === 'other') continue;
			if (protectedFile) {
				if (canonicalKind === 'regular' && quarantineKind === 'regular'
					&& removeRegularFile(quarantinePath)) {
					reclaimedFiles += 1;
					affectedDirectories.add(dirname(quarantinePath));
				}
				continue;
			}
			if (quarantineKind === 'regular' && removeRegularFile(quarantinePath)) {
				reclaimedFiles += 1;
				affectedDirectories.add(dirname(quarantinePath));
			}
			if (canonicalKind === 'regular') {
				renameSync(canonicalPath, quarantinePath);
				affectedDirectories.add(dirname(canonicalPath));
				if (removeRegularFile(quarantinePath)) reclaimedFiles += 1;
			}
			if (fileKind(canonicalPath) === 'missing' && fileKind(quarantinePath) === 'missing') {
				completedRows.push(candidate.inventoryId);
			}
		}
		for (const directory of affectedDirectories) syncDirectory(directory);
		assertLeaseOwned(database, lease, this.#now);
		for (const id of completedRows) removeDesktopLibraryManagedMediaInventoryRow(database, id);
		const lastId = batch.rows.at(-1)?.inventoryId ?? 0;
		advanceDesktopLibraryManagedMediaReclamation(database, lastId, batch.complete);
		setDesktopLibraryManagedMediaReclamationKind(database, 'stage');
		return emptyBatchResult({
			canonicalFiles: batch.rows.length,
			complete: batch.complete,
			protectedFiles,
			reclaimedFiles,
			scannedEntries: batch.rows.length,
			mediaCycleRestarted: false,
		});
	}

	async #yieldAfterBatch(signal?: AbortSignal): Promise<void> {
		await this.#checkpoint('batch');
		await waitForImmediate(undefined, { signal });
		throwIfAborted(signal);
	}
}

function emptyBatchResult(
	values: Partial<ReclamationBatchResult> & Pick<ReclamationBatchResult, 'complete' | 'mediaCycleRestarted'>,
): ReclamationBatchResult {
	return Object.freeze({
		canonicalFiles: 0, liveStageFiles: 0, protectedFiles: 0,
		reclaimedFiles: 0, reclaimedStageFiles: 0, scannedEntries: 0, stageFiles: 0,
		...values,
	});
}

function protectedManagedMedia(database: DatabaseSync): ReadonlyMap<string, DesktopLibraryMedia> {
	const snapshots = [persistedMetadata(database)];
	const pending = database.prepare(`
		SELECT * FROM metadata_journal WHERE state IN ('prepared', 'committed')
		ORDER BY created_at_ms, transaction_id
	`).all();
	if (pending.length > 1) throw new Error('Desktop project library has conflicting recovery journals');
	for (const raw of pending) {
		const journal = validateJournalRow(raw);
		for (const row of [journal.previous, journal.next]) {
			snapshots.push(validateMetadataIntegrity(row, 'recoverable desktop library metadata'));
		}
	}
	const protectedMedia = new Map<string, DesktopLibraryMedia>();
	for (const snapshot of snapshots) {
		for (const descriptor of snapshot.media) {
			const prior = protectedMedia.get(descriptor.id);
			if (prior && !sameDescriptor(prior, descriptor)) throw descriptorConflict();
			protectedMedia.set(descriptor.id, descriptor);
		}
	}
	return protectedMedia;
}

function persistedMetadata(database: DatabaseSync): DesktopLibraryMetadata {
	const raw = database.prepare(`
		SELECT revision, json, digest, published_at_ms AS publishedAtMs
		FROM library_metadata WHERE singleton = 1
	`).get();
	if (!raw) throw new Error('Desktop library metadata row is missing');
	return validateMetadataIntegrity(
		validateMetadataRow(raw, 'persisted metadata'),
		'Desktop library metadata',
	);
}

function assertNoPendingMetadataJournal(database: DatabaseSync): void {
	if (database.prepare(`
		SELECT 1 AS pending FROM metadata_journal
		WHERE state IN ('prepared', 'committed') LIMIT 1
	`).get()) {
		throw new Error('Desktop managed-media reclamation requires completed metadata-journal recovery');
	}
}

function projectTuples(metadata: DesktopLibraryMetadata): ReadonlySet<string> {
	return new Set(metadata.projects.map((project) => projectTuple(
		project.projectId,
		project.projectRevision,
		project.sha256,
	)));
}

function projectTuple(
	projectId: string,
	projectRevision: number,
	projectSha256: string,
): string {
	return JSON.stringify([projectId, projectRevision, projectSha256]);
}

function sameDescriptor(
	left: DesktopLibraryMedia | DesktopLibraryManagedMediaInventoryRow,
	right: DesktopLibraryMedia | DesktopLibraryManagedMediaInventoryRow,
): boolean {
	const leftId = 'bindingId' in left ? left.bindingId : left.id;
	const rightId = 'bindingId' in right ? right.bindingId : right.id;
	return leftId === rightId && left.relativeFile === right.relativeFile
		&& left.byteLength === right.byteLength && left.sha256 === right.sha256;
}

function sameMetadata(left: DesktopLibraryMetadata, right: DesktopLibraryMetadata): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function belongsToLease(
	row: DesktopLibraryManagedMediaInventoryRow | DesktopLibraryManagedMediaStageInventoryRow,
	lease: DesktopLibraryLease,
): boolean {
	return row.leaseId === lease.leaseId && row.fencingToken === lease.fencingToken;
}

function inventoryPath(root: string, relativeFile: string): string {
	return join(root, ...relativeFile.split('/'));
}

function directParentDirectoryKind(root: string, relativeFile: string): 'directory' | 'missing' | 'other' {
	if (!isRealDirectory(root)) return 'other';
	let current = root;
	for (const segment of relativeFile.split('/').slice(0, -1)) {
		current = join(current, segment);
		const metadata = lstatSync(current, { throwIfNoEntry: false });
		if (!metadata) return 'missing';
		if (!metadata.isDirectory()) return 'other';
	}
	return 'directory';
}

function fileKind(path: string): 'missing' | 'other' | 'regular' {
	const metadata = lstatSync(path, { throwIfNoEntry: false });
	if (!metadata) return 'missing';
	return metadata.isFile() ? 'regular' : 'other';
}

function isRealDirectory(path: string): boolean {
	return lstatSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}

function assertRealDirectory(path: string, label: string): void {
	if (!isRealDirectory(path)) throw new TypeError(`${label} is not a direct filesystem directory`);
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

function maximumEntries(value: number | undefined): number {
	const maximum = value ?? MAX_RECLAMATION_ENTRIES;
	if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_RECLAMATION_ENTRIES) {
		throw new RangeError('Desktop managed-media reclamation entry limit is invalid');
	}
	return maximum;
}

function timestamp(value: unknown): number {
	return nonNegativeInteger(value, 'desktop managed-media reclamation clock');
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${label} must be a non-negative safe integer`);
	}
	return value;
}

function descriptorConflict(): Error {
	return new Error('Desktop library managed-media catalog descriptor conflicts with its inventory row');
}

function leaseLost(): Error {
	return new Error('Desktop library lease holder no longer owns the lease');
}
