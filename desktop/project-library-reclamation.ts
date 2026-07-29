/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import {
	closeSync,
	fsyncSync,
	lstatSync,
	openSync,
	renameSync,
	unlinkSync,
} from 'node:fs';
import { opendir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { basename, join } from 'node:path';
import { setImmediate as waitForImmediate } from 'node:timers/promises';

import { throwIfAborted } from './project-library-abort.ts';
import {
	createDesktopLibraryProjectMetadataFile,
	type DesktopLibraryLease,
	type DesktopProjectLibraryPaths,
	validateDesktopProjectLibraryPaths,
} from './project-library-contract.ts';
import {
	sameLease,
	validateJournalRow,
	validateLeaseToken,
	validateMetadataIntegrity,
	validateMetadataRow,
	validatePersistedLease,
} from './project-library-persistence.ts';

const APPLICATION_ID = 0x53434150;
const DATABASE_SCHEMA_VERSION = 1;
const MAX_RECLAMATION_ENTRIES = 100_000;
const RECLAMATION_BATCH_SIZE = 64;
const QUARANTINE_ID = /^[a-f0-9]{32}$/u;
const QUARANTINE_FILE = /^\.[a-f0-9]{32}\.orphan$/u;
const CANONICAL_FILE = /^(0|[1-9][0-9]*)-([a-f0-9]{64})\.json$/u;

export type DesktopLibraryProjectReclamationCheckpoint = 'batch' | 'planned';

export interface DesktopLibraryProjectReclaimerOptions {
	readonly checkpoint?: (
		phase: DesktopLibraryProjectReclamationCheckpoint,
	) => void | Promise<void>;
	readonly maximumEntries?: number;
	readonly now?: () => number;
	readonly randomId?: () => string;
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

interface ProjectFileCandidate {
	readonly directory: string;
	readonly path: string;
	readonly relativePath: string;
}

interface ReclamationPlan {
	readonly scannedEntries: number;
	readonly canonicalFiles: readonly ProjectFileCandidate[];
	readonly complete: boolean;
	readonly quarantineFiles: readonly ProjectFileCandidate[];
}

/** Main-process startup maintenance. No path or lease value crosses IPC. */
export class DesktopLibraryProjectReclaimer {
	#checkpoint: (phase: DesktopLibraryProjectReclamationCheckpoint) => void | Promise<void>;
	#maximumEntries: number;
	#now: () => number;
	#paths: DesktopProjectLibraryPaths;
	#randomId: () => string;

	constructor(paths: DesktopProjectLibraryPaths, options: DesktopLibraryProjectReclaimerOptions = {}) {
		this.#paths = validateDesktopProjectLibraryPaths(paths);
		this.#maximumEntries = maximumEntries(options.maximumEntries);
		this.#now = options.now ?? Date.now;
		this.#randomId = options.randomId ?? (() => randomBytes(16).toString('hex'));
		this.#checkpoint = options.checkpoint ?? (() => {});
	}

	async reclaim(options: DesktopLibraryProjectReclaimOptions): Promise<DesktopLibraryProjectReclamationResult> {
		const lease = validateLeaseToken(options.lease);
		throwIfAborted(options.signal);
		const database = openMaintenanceDatabase(this.#paths.databasePath);
		try {
			withImmediateTransaction(database, () => { assertLeaseOwned(database, lease, this.#now); });
			const plan = await discoverProjectFiles(this.#paths, this.#maximumEntries, options.signal);
			await this.#checkpoint('planned');
			throwIfAborted(options.signal);
			withImmediateTransaction(database, () => {
				assertLeaseOwned(database, lease, this.#now);
				protectedProjectFiles(database);
			});
			let protectedFiles = 0;
			let reclaimedFiles = 0;
			for (const batch of batches(plan.canonicalFiles, RECLAMATION_BATCH_SIZE)) {
				throwIfAborted(options.signal);
				const result = withImmediateTransaction(database, () => this.#reclaimCanonicalBatch(
					database,
					lease,
					batch,
					options.signal,
				));
				protectedFiles += result.protectedFiles;
				reclaimedFiles += result.reclaimedFiles;
				await this.#yieldAfterBatch(options.signal);
			}
			for (const batch of batches(plan.quarantineFiles, RECLAMATION_BATCH_SIZE)) {
				throwIfAborted(options.signal);
				reclaimedFiles += withImmediateTransaction(database, () => this.#removeQuarantineBatch(
					database,
					lease,
					batch,
					options.signal,
				));
				await this.#yieldAfterBatch(options.signal);
			}
			return Object.freeze({
				scannedEntries: plan.scannedEntries,
				canonicalFiles: plan.canonicalFiles.length,
				complete: plan.complete,
				protectedFiles,
				reclaimedFiles,
			});
		} finally {
			database.close();
		}
	}

	#reclaimCanonicalBatch(
		database: DatabaseSync,
		lease: DesktopLibraryLease,
		candidates: readonly ProjectFileCandidate[],
		signal?: AbortSignal,
	): Readonly<{ protectedFiles: number; reclaimedFiles: number }> {
		assertLeaseOwned(database, lease, this.#now);
		const protectedFiles = protectedProjectFiles(database);
		assertRealDirectory(this.#paths.projectsRoot, 'Desktop project reclamation root');
		const affectedDirectories = new Set<string>();
		let protectedCount = 0;
		let reclaimedCount = 0;
		for (const candidate of candidates) {
			throwIfAborted(signal);
			if (protectedFiles.has(portablePathKey(candidate.relativePath))) {
				protectedCount += 1;
				continue;
			}
			if (!isRegularFile(candidate.directory, candidate.path)) continue;
			const quarantinePath = this.#availableQuarantinePath(candidate.directory);
			renameSync(candidate.path, quarantinePath);
			affectedDirectories.add(candidate.directory);
			if (removeRegularFile(quarantinePath)) reclaimedCount += 1;
		}
		for (const directory of affectedDirectories) syncDirectory(directory);
		assertLeaseOwned(database, lease, this.#now);
		return Object.freeze({ protectedFiles: protectedCount, reclaimedFiles: reclaimedCount });
	}

	#removeQuarantineBatch(
		database: DatabaseSync,
		lease: DesktopLibraryLease,
		candidates: readonly ProjectFileCandidate[],
		signal?: AbortSignal,
	): number {
		assertLeaseOwned(database, lease, this.#now);
		protectedProjectFiles(database);
		assertRealDirectory(this.#paths.projectsRoot, 'Desktop project reclamation root');
		const affectedDirectories = new Set<string>();
		let reclaimedFiles = 0;
		for (const candidate of candidates) {
			throwIfAborted(signal);
			if (!isRegularFile(candidate.directory, candidate.path)) continue;
			if (removeRegularFile(candidate.path)) {
				reclaimedFiles += 1;
				affectedDirectories.add(candidate.directory);
			}
		}
		for (const directory of affectedDirectories) syncDirectory(directory);
		assertLeaseOwned(database, lease, this.#now);
		return reclaimedFiles;
	}

	#availableQuarantinePath(directory: string): string {
		for (let attempt = 0; attempt < 8; attempt += 1) {
			const id = this.#randomId();
			if (!QUARANTINE_ID.test(id)) {
				throw new TypeError('Desktop project reclamation id generator returned an invalid value');
			}
			const path = join(directory, `.${id}.orphan`);
			if (lstatSync(path, { throwIfNoEntry: false }) === undefined) return path;
		}
		throw new Error('Desktop project reclamation could not reserve a quarantine path');
	}

	async #yieldAfterBatch(signal?: AbortSignal): Promise<void> {
		await this.#checkpoint('batch');
		await waitForImmediate(undefined, { signal });
		throwIfAborted(signal);
	}
}

async function discoverProjectFiles(
	paths: DesktopProjectLibraryPaths,
	maximum: number,
	signal?: AbortSignal,
): Promise<ReclamationPlan> {
	const canonicalFiles: ProjectFileCandidate[] = [];
	const quarantineFiles: ProjectFileCandidate[] = [];
	let scannedEntries = 0;
	let complete = true;
	assertRealDirectory(paths.projectsRoot, 'Desktop project reclamation root');
	const root = await opendir(paths.projectsRoot);
	rootEntries: for await (const entry of root) {
		throwIfAborted(signal);
		if (scannedEntries >= maximum) {
			complete = false;
			break;
		}
		scannedEntries += 1;
		if (!entry.isDirectory() || !isProjectEntryId(entry.name)) continue;
		const directory = join(paths.projectsRoot, entry.name);
		const scope = await opendir(directory);
		for await (const child of scope) {
			throwIfAborted(signal);
			if (scannedEntries >= maximum) {
				complete = false;
				break rootEntries;
			}
			scannedEntries += 1;
			if (!child.isFile()) continue;
			const path = join(directory, child.name);
			if (QUARANTINE_FILE.test(child.name)) {
				quarantineFiles.push({ directory, path, relativePath: `${entry.name}/${child.name}` });
				continue;
			}
			const relativePath = canonicalRelativePath(entry.name, child.name);
			if (relativePath) canonicalFiles.push({ directory, path, relativePath });
		}
	}
	return Object.freeze({
		scannedEntries,
		canonicalFiles: Object.freeze(canonicalFiles),
		complete,
		quarantineFiles: Object.freeze(quarantineFiles),
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
		if (pragmaNumber(database, 'application_id') !== APPLICATION_ID
			|| pragmaNumber(database, 'user_version') !== DATABASE_SCHEMA_VERSION) {
			throw new Error('Desktop project reclamation database identity is invalid');
		}
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

function canonicalRelativePath(entryId: string, fileName: string): string | null {
	const match = CANONICAL_FILE.exec(fileName);
	if (!match) return null;
	const revision = Number(match[1]);
	if (!Number.isSafeInteger(revision)) return null;
	try {
		const relativePath = createDesktopLibraryProjectMetadataFile(entryId, revision, match[2]);
		return basename(relativePath) === fileName ? relativePath : null;
	} catch {
		return null;
	}
}

function isProjectEntryId(value: string): boolean {
	try {
		return createDesktopLibraryProjectMetadataFile(value, 0, '0'.repeat(64)).startsWith(`${value}/`);
	} catch {
		return false;
	}
}

function portablePathKey(value: string): string {
	return value.toLowerCase();
}

function isRegularFile(directory: string, path: string): boolean {
	const directoryMetadata = lstatSync(directory, { throwIfNoEntry: false });
	if (!directoryMetadata?.isDirectory()) return false;
	return lstatSync(path, { throwIfNoEntry: false })?.isFile() === true;
}

function assertRealDirectory(path: string, label: string): void {
	if (lstatSync(path, { throwIfNoEntry: false })?.isDirectory() !== true) {
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

function batches<Value>(values: readonly Value[], size: number): readonly (readonly Value[])[] {
	const result: Value[][] = [];
	for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
	return result;
}

function maximumEntries(value: number | undefined): number {
	const maximum = value ?? MAX_RECLAMATION_ENTRIES;
	if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_RECLAMATION_ENTRIES) {
		throw new RangeError('Desktop project reclamation entry limit is invalid');
	}
	return maximum;
}

function pragmaNumber(database: DatabaseSync, name: 'application_id' | 'user_version'): number {
	const row = database.prepare(`PRAGMA ${name}`).get();
	if (!row || !(name in row)) throw new Error(`Desktop project reclamation PRAGMA ${name} is missing`);
	return nonNegativeInteger(row[name], `PRAGMA ${name}`);
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
