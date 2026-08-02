/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import { abortableDelay, throwIfAborted } from './project-library-abort.ts';
import {
	type DesktopLibraryAcquireLeaseOptions,
	type DesktopLibraryCheckpoint,
	type DesktopLibraryDiscardProjectStageFileOptions,
	DesktopLibraryLeaseBusyError,
	type DesktopLibraryMaterializeProjectFileOptions,
	type DesktopLibraryOpenOptions,
	type DesktopLibraryPublishMetadataOptions,
	type DesktopLibraryRecoverMetadataOptions,
	type DesktopLibraryRecoveryResult,
	type DesktopLibraryReserveProjectFileOptions,
	freezeDesktopLibraryRecovery,
} from './project-library-api.ts';
import {
	emptyDesktopLibraryMetadata,
	type DesktopLibraryLease,
	type DesktopLibraryMedia,
	type DesktopLibraryMetadata,
	type DesktopLibraryOwner,
	type DesktopProjectLibraryPaths,
	validateDesktopLibraryMetadata,
	validateDesktopLibraryOwner,
	validateDesktopProjectLibraryPaths,
} from './project-library-contract.ts';
import { initializeDesktopProjectLibraryDatabase } from './project-library-database.ts';
import {
	assertDesktopLibraryProjectFilesMaterialized,
	reserveDesktopLibraryProjectFile,
	validateDesktopLibraryProjectFileInventory,
} from './project-library-file-inventory.ts';
import {
	assertDesktopLibraryManagedMediaMaterialized,
	markDesktopLibraryManagedMediaPublished,
	validateDesktopLibraryManagedMediaInventory,
} from './project-library-media-inventory.ts';
import { isDesktopLibraryManagedMediaBindingId } from './project-library-media-binding.ts';
import {
	encodeMetadataRow,
	freezeLease,
	JOURNAL_ID_PATTERN,
	type JournalRow,
	LEASE_ID_PATTERN,
	type MetadataRow,
	sameLease,
	sameMetadataRow,
	validateJournalRow,
	validateLeaseToken,
	validateMetadataIntegrity,
	validateMetadataRow,
	validatePersistedLease,
} from './project-library-persistence.ts';
import {
	discardDesktopLibraryProjectStageFile,
	materializeDesktopLibraryProjectStageFile,
	registerDesktopLibraryProjectStageFile,
	validateDesktopLibraryProjectStageInventory,
} from './project-library-stage-inventory.ts';

const MIN_LEASE_TTL_MS = 1_000;
const MAX_LEASE_TTL_MS = 5 * 60 * 1_000;
const MAX_LEASE_WAIT_MS = 60_000;
const MAX_RETAINED_JOURNALS = 32;
const MAX_STORED_JOURNALS = MAX_RETAINED_JOURNALS + 1;

/** Main-process-only service. Do not expose this instance or its paths over IPC. */
export class SharedDesktopProjectLibrary {
	readonly paths: DesktopProjectLibraryPaths;
	#checkpoint: (phase: DesktopLibraryCheckpoint) => void | Promise<void>;
	#closed = false;
	#database: DatabaseSync;
	#metadataOperationActive = false;
	#now: () => number;
	#randomId: () => string;

	private constructor(paths: DesktopProjectLibraryPaths, database: DatabaseSync, options: DesktopLibraryOpenOptions) {
		this.paths = paths;
		this.#database = database;
		this.#now = options.now ?? Date.now;
		this.#randomId = options.randomId ?? (() => randomBytes(24).toString('hex'));
		this.#checkpoint = options.checkpoint ?? (() => {});
	}

	static async open(paths: DesktopProjectLibraryPaths, options: DesktopLibraryOpenOptions = {}): Promise<SharedDesktopProjectLibrary> {
		const scopedPaths = validateDesktopProjectLibraryPaths(paths);
		await mkdir(scopedPaths.projectsRoot, { recursive: true, mode: 0o700 });
		await mkdir(scopedPaths.managedMediaRoot, { recursive: true, mode: 0o700 });
		await Promise.all([
			chmod(scopedPaths.libraryRoot, 0o700),
			chmod(scopedPaths.projectsRoot, 0o700),
			chmod(scopedPaths.managedMediaRoot, 0o700),
		]);
		const database = new DatabaseSync(scopedPaths.databasePath, {
			allowExtension: false,
			enableDoubleQuotedStringLiterals: false,
			enableForeignKeyConstraints: true,
			timeout: 50,
		});
		try {
			await chmod(scopedPaths.databasePath, 0o600);
			const library = new SharedDesktopProjectLibrary(scopedPaths, database, options);
			library.#initializeDatabase();
			return library;
		} catch (error) {
			database.close();
			throw error;
		}
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#database.close();
	}

	readMetadata(): DesktopLibraryMetadata {
		this.#assertOpen();
		return this.#validatedMetadataRow().metadata;
	}

	currentLease(): DesktopLibraryLease | null {
		this.#assertOpen();
		const row = this.#leaseRow();
		return row && row.active && row.lease.expiresAtMs > this.#timestamp() ? row.lease : null;
	}

	assertLease(lease: DesktopLibraryLease): DesktopLibraryLease {
		this.#assertOpen();
		const token = validateLeaseToken(lease);
		return this.#transaction(() => this.#assertLeaseOwned(token));
	}

	reserveProjectFile(options: DesktopLibraryReserveProjectFileOptions): void {
		this.#assertOpen();
		const lease = validateLeaseToken(options.lease);
		this.#transaction(() => {
			this.#assertLeaseOwned(lease);
			reserveDesktopLibraryProjectFile(this.#database, {
				lease,
				metadataFile: options.metadataFile,
				registeredAtMs: this.#timestamp(),
			});
			if (options.stageFile !== undefined) registerDesktopLibraryProjectStageFile(this.#database, {
				lease, metadataFile: options.metadataFile, stageFile: options.stageFile,
				registeredAtMs: this.#timestamp(),
			});
			this.#assertLeaseOwned(lease);
		});
	}

	materializeProjectFile(options: DesktopLibraryMaterializeProjectFileOptions): void {
		this.#assertOpen();
		const lease = validateLeaseToken(options.lease);
		this.#transaction(() => {
			this.#assertLeaseOwned(lease);
			materializeDesktopLibraryProjectStageFile(this.#database, this.paths, { ...options, lease });
			this.#assertLeaseOwned(lease);
		});
	}

	discardProjectStageFile(options: DesktopLibraryDiscardProjectStageFileOptions): boolean {
		this.#assertOpen();
		const lease = validateLeaseToken(options.lease);
		return this.#transaction(() => {
			const row = this.#leaseRow();
			if (!row?.active || !sameLease(row.lease, lease) || row.lease.expiresAtMs <= this.#timestamp()) return false;
			const discarded = discardDesktopLibraryProjectStageFile(this.#database, this.paths, { ...options, lease });
			this.#assertLeaseOwned(lease);
			return discarded;
		});
	}

	async acquireLease(options: DesktopLibraryAcquireLeaseOptions): Promise<DesktopLibraryLease> {
		this.#assertOpen();
		const owner = validateDesktopLibraryOwner(options.owner);
		const ttlMs = leaseTtl(options.ttlMs);
		const waitMs = boundedInteger(options.waitMs ?? 0, 0, MAX_LEASE_WAIT_MS, 'lease wait');
		const pollIntervalMs = boundedInteger(options.pollIntervalMs ?? 50, 10, 1_000, 'lease poll interval');
		let waitedMs = 0;
		while (true) {
			throwIfAborted(options.signal);
			const result = this.#transaction(() => this.#tryAcquireLease(owner, ttlMs));
			if ('lease' in result) return result.lease;
			if (waitedMs >= waitMs) throw new DesktopLibraryLeaseBusyError(result.holder);
			const delayMs = Math.min(pollIntervalMs, waitMs - waitedMs);
			await abortableDelay(delayMs, options.signal);
			waitedMs += delayMs;
		}
	}

	async renewLease(lease: DesktopLibraryLease, ttlMs: number, signal?: AbortSignal): Promise<DesktopLibraryLease> {
		this.#assertOpen();
		const token = validateLeaseToken(lease);
		const duration = leaseTtl(ttlMs);
		throwIfAborted(signal);
		return this.#transaction(() => {
			const current = this.#assertLeaseOwned(token);
			const expiresAtMs = checkedTimestamp(this.#timestamp() + duration, 'lease expiry');
			this.#database.prepare(`
				UPDATE library_lease SET expires_at_ms = ? WHERE singleton = 1
			`).run(expiresAtMs);
			return freezeLease({ ...current, expiresAtMs });
		});
	}

	async releaseLease(lease: DesktopLibraryLease): Promise<boolean> {
		this.#assertOpen();
		const token = validateLeaseToken(lease);
		return this.#transaction(() => {
			const row = this.#leaseRow();
			if (!row?.active || !sameLease(row.lease, token)) return false;
			this.#database.prepare('UPDATE library_lease SET active = 0 WHERE singleton = 1').run();
			return true;
		});
	}

	async publishMetadata(options: DesktopLibraryPublishMetadataOptions): Promise<DesktopLibraryMetadata> {
		return this.#exclusiveMetadataOperation(async () => {
			this.#assertOpen();
			const lease = validateLeaseToken(options.lease);
			const metadata = validateDesktopLibraryMetadata(options.metadata);
			throwIfAborted(options.signal);
			const transactionId = this.#newId(JOURNAL_ID_PATTERN, 'journal transaction id');
			const next = encodeMetadataRow(metadata, this.#timestamp());
			this.#transaction(() => this.#preparePublication(
				transactionId,
				lease,
				next,
				metadata.projects.map(({ metadataFile }) => metadataFile),
				metadata.media,
			));
			await this.#checkpoint('prepared');
			throwIfAborted(options.signal);
			this.#transaction(() => this.#commitPublication(transactionId, lease));
			await this.#checkpoint('committed');
			throwIfAborted(options.signal);
			this.#transaction(() => {
				this.#database.prepare(`
					UPDATE metadata_journal SET state = 'complete', completed_at_ms = ?
					WHERE transaction_id = ? AND state = 'committed'
				`).run(this.#timestamp(), transactionId);
				this.#pruneJournals();
			});
			return metadata;
		});
	}

	async recoverMetadata(options: DesktopLibraryRecoverMetadataOptions): Promise<DesktopLibraryRecoveryResult> {
		return this.#exclusiveMetadataOperation(async () => {
			this.#assertOpen();
			const lease = validateLeaseToken(options.lease);
			throwIfAborted(options.signal);
			return this.#transaction(() => this.#recoverMetadata(lease));
		});
	}

	#initializeDatabase(): void {
		const empty = encodeMetadataRow(emptyDesktopLibraryMetadata(), this.#timestamp());
		initializeDesktopProjectLibraryDatabase(this.#database, empty);
		const journalCount = numericField(
			this.#database.prepare('SELECT COUNT(*) AS journal_count FROM metadata_journal').get(),
			'journal_count',
		);
		if (journalCount > MAX_STORED_JOURNALS) throw new Error('Desktop project library has too many recovery journals');
		const journals = this.#database.prepare('SELECT * FROM metadata_journal ORDER BY created_at_ms, transaction_id').all()
			.map((row) => validateJournalRow(row));
		const pendingJournals = journals.filter(({ state }) => state === 'prepared' || state === 'committed');
		if (pendingJournals.length > 1) throw new Error('Desktop project library has conflicting recovery journals');
		const settledMetadata = pendingJournals.length === 0 ? this.#validatedMetadataRow().metadata : null;
		this.#leaseRow();
		validateDesktopLibraryProjectFileInventory(this.#database);
		validateDesktopLibraryProjectStageInventory(this.#database);
		validateDesktopLibraryManagedMediaInventory(this.#database);
		for (const descriptor of settledMetadata?.media ?? []) {
			if (isDesktopLibraryManagedMediaBindingId(descriptor.id)) {
				assertDesktopLibraryManagedMediaMaterialized(this.#database, descriptor);
			}
		}
	}

	#tryAcquireLease(owner: DesktopLibraryOwner, ttlMs: number): { lease: DesktopLibraryLease } | { holder: DesktopLibraryLease } {
		const now = this.#timestamp();
		const row = this.#leaseRow();
		if (row?.active && row.lease.expiresAtMs > now) return { holder: row.lease };
		const lease = freezeLease({
			leaseId: this.#newId(LEASE_ID_PATTERN, 'lease id'),
			fencingToken: (row?.lease.fencingToken ?? 0) + 1,
			owner,
			acquiredAtMs: now,
			expiresAtMs: checkedTimestamp(now + ttlMs, 'lease expiry'),
			tookOverStaleLease: row?.active === true,
		});
		this.#database.prepare(`
			UPDATE library_lease SET
				active = 1,
				lease_id = ?,
				fencing_token = ?,
				owner_product = ?,
				owner_process_id = ?,
				owner_instance_id = ?,
				acquired_at_ms = ?,
				expires_at_ms = ?,
				took_over = ?
			WHERE singleton = 1
		`).run(
			lease.leaseId,
			lease.fencingToken,
			lease.owner.product,
			lease.owner.processId,
			lease.owner.instanceId,
			lease.acquiredAtMs,
			lease.expiresAtMs,
			lease.tookOverStaleLease ? 1 : 0,
		);
		return { lease };
	}

	#preparePublication(
		transactionId: string,
		lease: DesktopLibraryLease,
		next: MetadataRow,
		projectFiles: readonly string[],
		media: readonly DesktopLibraryMedia[],
	): void {
		this.#assertLeaseOwned(lease);
		const pending = this.#database.prepare(`
			SELECT transaction_id FROM metadata_journal
			WHERE state IN ('prepared', 'committed') LIMIT 1
		`).get();
		if (pending) throw new Error('Desktop library metadata recovery is required before publishing');
		const previous = this.#validatedMetadataRow().row;
		if (next.revision !== previous.revision + 1) {
			throw new RangeError('Desktop library metadata revision must advance by exactly one');
		}
		assertDesktopLibraryProjectFilesMaterialized(this.#database, projectFiles);
		for (const descriptor of media) {
			if (isDesktopLibraryManagedMediaBindingId(descriptor.id)) {
				assertDesktopLibraryManagedMediaMaterialized(this.#database, descriptor);
			}
		}
		this.#database.prepare(`
			INSERT INTO metadata_journal (
				transaction_id, state,
				previous_revision, previous_json, previous_digest, previous_published_at_ms,
				next_revision, next_json, next_digest, published_at_ms,
				lease_id, fencing_token, created_at_ms
			) VALUES (?, 'prepared', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			transactionId,
			previous.revision,
			previous.json,
			previous.digest,
			previous.publishedAtMs,
			next.revision,
			next.json,
			next.digest,
			next.publishedAtMs,
			lease.leaseId,
			lease.fencingToken,
			this.#timestamp(),
		);
	}

	#commitPublication(transactionId: string, lease: DesktopLibraryLease): void {
		this.#assertLeaseOwned(lease);
		const journal = this.#journalById(transactionId);
		if (!journal || journal.state !== 'prepared') throw new Error('Desktop library publication journal is not prepared');
		const current = this.#validatedMetadataRow().row;
		if (!sameMetadataRow(current, journal.previous)) {
			throw new Error('Desktop library metadata changed after journal preparation');
		}
		this.#replaceMetadata(journal.next);
		const nextMetadata = validateMetadataIntegrity(journal.next, 'Desktop library publication metadata');
		for (const descriptor of nextMetadata.media) {
			if (isDesktopLibraryManagedMediaBindingId(descriptor.id)) {
				markDesktopLibraryManagedMediaPublished(this.#database, { lease, descriptor });
			}
		}
		const result = this.#database.prepare(`
			UPDATE metadata_journal SET state = 'committed'
			WHERE transaction_id = ? AND state = 'prepared'
		`).run(transactionId);
		if (result.changes !== 1) throw new Error('Desktop library publication journal could not commit');
	}

	#recoverMetadata(lease: DesktopLibraryLease): DesktopLibraryRecoveryResult {
		this.#assertLeaseOwned(lease);
		const raw = this.#database.prepare(`
			SELECT * FROM metadata_journal
			WHERE state IN ('prepared', 'committed')
			ORDER BY created_at_ms, transaction_id LIMIT 1
		`).get();
		if (!raw) return freezeDesktopLibraryRecovery({
			outcome: 'clean',
			previousRevision: null,
			publishedRevision: null,
			restoredPrevious: false,
		});
		const journal = validateJournalRow(raw);
		const current = this.#recoverableMetadataRow();
		if (current && sameMetadataRow(current, journal.next)) {
			this.#completeRecoveryJournal(journal.transactionId, 'complete');
			return freezeDesktopLibraryRecovery({
				outcome: 'committed',
				previousRevision: journal.previous.revision,
				publishedRevision: journal.next.revision,
				restoredPrevious: false,
			});
		}
		const restoredPrevious = !current || !sameMetadataRow(current, journal.previous);
		if (restoredPrevious) this.#replaceMetadata(journal.previous);
		this.#completeRecoveryJournal(journal.transactionId, 'recovered');
		return freezeDesktopLibraryRecovery({
			outcome: 'interrupted',
			previousRevision: journal.previous.revision,
			publishedRevision: null,
			restoredPrevious,
		});
	}

	#completeRecoveryJournal(transactionId: string, state: 'complete' | 'recovered'): void {
		this.#database.prepare(`
			UPDATE metadata_journal SET state = ?, completed_at_ms = ?
			WHERE transaction_id = ? AND state IN ('prepared', 'committed')
		`).run(state, this.#timestamp(), transactionId);
		this.#pruneJournals();
	}

	#pruneJournals(): void {
		this.#database.prepare(`
			DELETE FROM metadata_journal WHERE transaction_id IN (
				SELECT transaction_id FROM metadata_journal
				WHERE state IN ('complete', 'recovered')
				ORDER BY completed_at_ms DESC, transaction_id DESC
				LIMIT -1 OFFSET ?
			)
		`).run(MAX_RETAINED_JOURNALS);
	}

	#journalById(transactionId: string): JournalRow | null {
		const row = this.#database.prepare('SELECT * FROM metadata_journal WHERE transaction_id = ?').get(transactionId);
		return row ? validateJournalRow(row) : null;
	}

	#validatedMetadataRow(): { metadata: DesktopLibraryMetadata; row: MetadataRow } {
		const row = this.#rawMetadataRow();
		if (!row) throw new Error('Desktop library metadata row is missing');
		const metadata = validateMetadataIntegrity(row, 'Desktop library metadata');
		return { metadata, row };
	}

	#rawMetadataRow(): MetadataRow | null {
		const row = this.#database.prepare(`
			SELECT revision, json, digest, published_at_ms AS publishedAtMs
			FROM library_metadata WHERE singleton = 1
		`).get();
		return row ? validateMetadataRow(row, 'persisted metadata') : null;
	}

	#recoverableMetadataRow(): MetadataRow | null {
		try {
			return this.#rawMetadataRow();
		} catch (error) {
			if (error instanceof TypeError || error instanceof RangeError) return null;
			throw error;
		}
	}

	#replaceMetadata(row: MetadataRow): void {
		validateMetadataRow(row, 'replacement metadata');
		validateMetadataIntegrity(row, 'Replacement desktop library metadata');
		this.#database.prepare(`
			INSERT INTO library_metadata (singleton, revision, json, digest, published_at_ms)
			VALUES (1, ?, ?, ?, ?)
			ON CONFLICT(singleton) DO UPDATE SET
				revision = excluded.revision,
				json = excluded.json,
				digest = excluded.digest,
				published_at_ms = excluded.published_at_ms
		`).run(row.revision, row.json, row.digest, row.publishedAtMs);
	}

	#leaseRow(): { active: boolean; lease: DesktopLibraryLease } | null {
		const row = this.#database.prepare(`
			SELECT active, lease_id AS leaseId, fencing_token AS fencingToken,
				owner_product AS ownerProduct, owner_process_id AS ownerProcessId,
				owner_instance_id AS ownerInstanceId, acquired_at_ms AS acquiredAtMs,
				expires_at_ms AS expiresAtMs, took_over AS tookOver
			FROM library_lease WHERE singleton = 1
		`).get();
		if (!row) return null;
		const active = booleanInteger(row.active, 'persisted lease active');
		const fencingToken = nonNegativeInteger(row.fencingToken, 'persisted lease fencing token');
		if (!active) {
			if (fencingToken === 0) {
				if (row.leaseId !== null
					|| row.ownerProduct !== null
					|| row.ownerProcessId !== null
					|| row.ownerInstanceId !== null
					|| row.acquiredAtMs !== null
					|| row.expiresAtMs !== null
					|| row.tookOver !== 0) {
					throw new TypeError('Initial desktop library lease row is invalid');
				}
				return null;
			}
			return {
				active,
				lease: validatePersistedLease(row, fencingToken),
			};
		}
		return { active, lease: validatePersistedLease(row, fencingToken) };
	}

	#assertLeaseOwned(token: DesktopLibraryLease): DesktopLibraryLease {
		const row = this.#leaseRow();
		if (!row?.active || !sameLease(row.lease, token) || row.lease.expiresAtMs <= this.#timestamp()) {
			throw new Error('Desktop library lease holder no longer owns the lease');
		}
		return row.lease;
	}

	#transaction<Result>(operation: () => Result): Result {
		this.#database.exec('BEGIN IMMEDIATE');
		try {
			const result = operation();
			this.#database.exec('COMMIT');
			return result;
		} catch (error) {
			if (this.#database.isTransaction) this.#database.exec('ROLLBACK');
			throw error;
		}
	}

	async #exclusiveMetadataOperation<Result>(operation: () => Promise<Result>): Promise<Result> {
		if (this.#metadataOperationActive) throw new Error('A desktop library metadata operation is already active');
		this.#metadataOperationActive = true;
		try {
			return await operation();
		} finally {
			this.#metadataOperationActive = false;
		}
	}

	#newId(pattern: RegExp, label: string): string {
		const value = this.#randomId();
		if (!pattern.test(value)) throw new TypeError(`Desktop library ${label} generator returned an invalid value`);
		return value;
	}

	#timestamp(): number {
		return checkedTimestamp(this.#now(), 'desktop library clock');
	}

	#assertOpen(): void {
		if (this.#closed) throw new Error('Desktop project library is closed');
	}
}

function leaseTtl(value: unknown): number {
	return boundedInteger(value, MIN_LEASE_TTL_MS, MAX_LEASE_TTL_MS, 'lease TTL');
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`Desktop library ${label} must be between ${minimum} and ${maximum}`);
	}
	return value;
}

function checkedTimestamp(value: unknown, label: string): number {
	return boundedInteger(value, 0, Number.MAX_SAFE_INTEGER, label);
}

function nonNegativeInteger(value: unknown, label: string): number {
	return boundedInteger(value, 0, Number.MAX_SAFE_INTEGER, label);
}

function booleanInteger(value: unknown, label: string): boolean {
	if (value !== 0 && value !== 1) throw new TypeError(`${label} must be zero or one`);
	return value === 1;
}

function numericField(row: Record<string, unknown> | undefined, key: string): number {
	if (!row || !(key in row)) throw new Error(`Desktop library PRAGMA ${key} did not return a value`);
	return nonNegativeInteger(row[key], `PRAGMA ${key}`);
}
