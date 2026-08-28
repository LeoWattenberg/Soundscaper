/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import {
	type SoundscaperDesktopProjectLibraryHandshake,
	type SoundscaperDesktopProjectLibraryOwner,
	validateSoundscaperDesktopProjectLibraryOwner,
} from './soundscaper-project-library-contract.ts';
import {
	assertSoundscaperDesktopProjectLibraryDatabaseIdentity,
} from './soundscaper-project-library-database.ts';
import {
	createSoundscaperDesktopProjectLibraryHandshakeGate,
	type SoundscaperDesktopProjectLibraryHandshakeState,
} from './soundscaper-project-library-handshake-gate.ts';
import {
	encodeSoundscaperDesktopProjectLibraryMetadataRow as encodeMetadataRow,
	freezeSoundscaperDesktopProjectLibraryLease as freezeLease,
	sameSoundscaperDesktopProjectLibraryLease as sameLease,
	sameSoundscaperDesktopProjectLibraryMetadataSnapshot as sameMetadataSnapshot,
	type SoundscaperDesktopProjectLibraryJournalRow as JournalRow,
	type SoundscaperDesktopProjectLibraryLease,
	type SoundscaperDesktopProjectLibraryMetadataRow as MetadataRow,
	validateSoundscaperDesktopProjectLibraryJournalRow as validateJournalRow,
	validateSoundscaperDesktopProjectLibraryLeaseToken as validateLeaseToken,
	validateSoundscaperDesktopProjectLibraryMetadataIntegrity as validateMetadataIntegrity,
	validateSoundscaperDesktopProjectLibraryMetadataRow as validateMetadataRow,
	validateSoundscaperDesktopProjectLibraryOpaqueId as leaseId,
} from './soundscaper-project-library-persistence-codecs.ts';
import {
	type SoundscaperDesktopLibraryMetadata,
	validateSoundscaperDesktopLibraryMetadata,
} from './soundscaper-project-library-metadata.ts';

export type { SoundscaperDesktopProjectLibraryLease };

const CREATE_FIELDS = ['database', 'owner', 'checkpoint', 'now', 'randomId'] as const;
const ACQUIRE_FIELDS = ['ttlMs'] as const;
const RENEW_FIELDS = ['ttlMs'] as const;
const PUBLISH_FIELDS = ['expectedRevision', 'lease', 'metadata'] as const;
const RECOVER_FIELDS = ['lease'] as const;
const MINIMUM_LEASE_TTL_MS = 1_000;
const MAXIMUM_LEASE_TTL_MS = 5 * 60 * 1_000;
const MAXIMUM_RETAINED_JOURNALS = 32;

export type SoundscaperDesktopProjectLibraryCheckpoint =
	| 'prepared'
	| 'committed'
	| 'complete';

export interface SoundscaperDesktopProjectLibraryRecovery {
	readonly outcome: 'clean' | 'interrupted' | 'committed';
	readonly previousRevision: number | null;
	readonly publishedRevision: number | null;
}

interface CreateOptions {
	readonly database: DatabaseSync;
	readonly owner: SoundscaperDesktopProjectLibraryOwner;
	readonly checkpoint?: (phase: SoundscaperDesktopProjectLibraryCheckpoint) => void;
	readonly now?: () => number;
	readonly randomId?: () => string;
}

interface PersistedLeaseRow {
	readonly active: boolean;
	readonly lease: SoundscaperDesktopProjectLibraryLease | null;
}

/** Main-process baseline catalog. A baseline handshake must admit every operation. */
export class SoundscaperDesktopProjectLibraryCatalog {
	readonly owner: Readonly<SoundscaperDesktopProjectLibraryOwner>;
	#checkpoint: (phase: SoundscaperDesktopProjectLibraryCheckpoint) => void;
	#database: DatabaseSync;
	#gate = createSoundscaperDesktopProjectLibraryHandshakeGate();
	#metadataOperationActive = false;
	#now: () => number;
	#randomId: () => string;

	private constructor(options: CreateOptions) {
		this.#database = options.database;
		this.owner = validateSoundscaperDesktopProjectLibraryOwner(options.owner);
		this.#checkpoint = options.checkpoint ?? (() => {});
		this.#now = options.now ?? Date.now;
		this.#randomId = options.randomId ?? (() => randomBytes(24).toString('hex'));
	}

	static create(value: unknown): SoundscaperDesktopProjectLibraryCatalog {
		const record = snapshotOptions(value);
		if (!(record.database instanceof DatabaseSync)) {
			throw new TypeError('Soundscaper desktop baseline catalog requires a SQLite database');
		}
		for (const field of ['checkpoint', 'now', 'randomId'] as const) {
			if (record[field] !== undefined && typeof record[field] !== 'function') {
				throw new TypeError(`Soundscaper desktop baseline catalog ${field} must be a function`);
			}
		}
		const catalog = new SoundscaperDesktopProjectLibraryCatalog({
			database: record.database,
			owner: validateSoundscaperDesktopProjectLibraryOwner(record.owner),
			...(record.checkpoint ? { checkpoint: record.checkpoint as CreateOptions['checkpoint'] } : {}),
			...(record.now ? { now: record.now as CreateOptions['now'] } : {}),
			...(record.randomId ? { randomId: record.randomId as CreateOptions['randomId'] } : {}),
		});
		Object.freeze(catalog);
		return catalog;
	}

	get localHandshake(): Readonly<SoundscaperDesktopProjectLibraryHandshake> {
		return this.#gate.local;
	}

	handshakeState(): SoundscaperDesktopProjectLibraryHandshakeState {
		return this.#gate.state();
	}

	acceptHandshake(value: unknown): Readonly<SoundscaperDesktopProjectLibraryHandshake> {
		return this.#gate.accept(value);
	}

	readMetadata(): Readonly<SoundscaperDesktopLibraryMetadata> {
		this.#assertReady();
		return this.#validatedMetadataRow().metadata;
	}

	acquireLease(options: { readonly ttlMs: number }): SoundscaperDesktopProjectLibraryLease {
		this.#assertReady();
		const record = snapshotClosedRecord(options, ACQUIRE_FIELDS, 'baseline lease acquisition');
		const ttlMs = leaseTtl(record.ttlMs);
		return this.#transaction(() => {
			const now = this.#timestamp();
			const current = this.#leaseRow();
			if (current.active && current.lease && current.lease.expiresAtMs > now) {
				throw new Error('Soundscaper desktop baseline writer lease is busy');
			}
			const previousFence = current.lease?.fencingToken ?? 0;
			const fencingToken = increment(previousFence, 'baseline lease fencing token');
			const lease = freezeLease({
				leaseId: this.#newId(),
				fencingToken,
				owner: this.owner,
				acquiredAtMs: now,
				expiresAtMs: checkedAdd(now, ttlMs, 'baseline lease expiry'),
				tookOverStaleLease: current.active,
			});
			const result = this.#database.prepare(`
				UPDATE library_lease SET active = 1, lease_id = ?, fencing_token = ?,
					owner_product = 'soundscaper', owner_process_id = ?, owner_instance_id = ?,
					acquired_at_ms = ?, expires_at_ms = ?, took_over = ?
				WHERE singleton = 1 AND active = ? AND fencing_token = ?
			`).run(
				lease.leaseId, lease.fencingToken, lease.owner.processId, lease.owner.instanceId,
				lease.acquiredAtMs, lease.expiresAtMs, lease.tookOverStaleLease ? 1 : 0,
				current.active ? 1 : 0, previousFence,
			);
			if (result.changes !== 1) throw new Error('Soundscaper desktop baseline lease acquisition lost its compare-and-swap');
			return lease;
		});
	}

	renewLease(
		lease: SoundscaperDesktopProjectLibraryLease,
		options: { readonly ttlMs: number },
	): SoundscaperDesktopProjectLibraryLease {
		this.#assertReady();
		const token = validateLeaseToken(lease);
		const record = snapshotClosedRecord(options, RENEW_FIELDS, 'baseline lease renewal');
		const ttlMs = leaseTtl(record.ttlMs);
		return this.#transaction(() => {
			const now = this.#timestamp();
			const current = this.#assertLeaseOwned(token, now);
			const expiresAtMs = checkedAdd(now, ttlMs, 'baseline lease expiry');
			const result = this.#database.prepare(`
				UPDATE library_lease SET expires_at_ms = ?
				WHERE singleton = 1 AND active = 1 AND lease_id = ? AND fencing_token = ?
			`).run(expiresAtMs, token.leaseId, token.fencingToken);
			if (result.changes !== 1) throw leaseLost();
			return freezeLease({ ...current, expiresAtMs });
		});
	}

	releaseLease(lease: SoundscaperDesktopProjectLibraryLease): boolean {
		this.#assertReady();
		const token = validateLeaseToken(lease);
		return this.#transaction(() => {
			const current = this.#leaseRow();
			if (!current.active || !current.lease || current.lease.expiresAtMs <= this.#timestamp()
				|| !sameLease(current.lease, token)) return false;
			const result = this.#database.prepare(`
				UPDATE library_lease SET active = 0
				WHERE singleton = 1 AND active = 1 AND lease_id = ? AND fencing_token = ?
			`).run(token.leaseId, token.fencingToken);
			return result.changes === 1;
		});
	}

	publishMetadata(options: {
		readonly expectedRevision: number;
		readonly lease: SoundscaperDesktopProjectLibraryLease;
		readonly metadata: SoundscaperDesktopLibraryMetadata;
	}): Readonly<SoundscaperDesktopLibraryMetadata> {
		this.#assertReady();
		const record = snapshotClosedRecord(options, PUBLISH_FIELDS, 'baseline metadata publication');
		const expectedRevision = nonNegativeInteger(record.expectedRevision, 'expected metadata revision');
		const lease = validateLeaseToken(record.lease as SoundscaperDesktopProjectLibraryLease);
		const metadata = validateSoundscaperDesktopLibraryMetadata(record.metadata);
		const next = encodeMetadataRow(metadata, this.#timestamp());
		if (next.revision !== increment(expectedRevision, 'baseline metadata revision')) {
			throw new RangeError('Soundscaper desktop baseline metadata revision must advance by exactly one');
		}
		return this.#exclusiveMetadataOperation(() => {
			const transactionId = this.#newId();
			this.#transaction(() => this.#preparePublication(transactionId, lease, expectedRevision, next));
			this.#checkpoint('prepared');
			this.#transaction(() => this.#commitPublication(transactionId, lease));
			this.#checkpoint('committed');
			this.#transaction(() => this.#settlePublication(transactionId, lease));
			this.#checkpoint('complete');
			return metadata;
		});
	}

	recoverMetadata(options: {
		readonly lease: SoundscaperDesktopProjectLibraryLease;
	}): Readonly<SoundscaperDesktopProjectLibraryRecovery> {
		this.#assertReady();
		const record = snapshotClosedRecord(options, RECOVER_FIELDS, 'baseline metadata recovery');
		const lease = validateLeaseToken(record.lease as SoundscaperDesktopProjectLibraryLease);
		return this.#exclusiveMetadataOperation(() => this.#transaction(() => {
			this.#assertLeaseOwned(lease);
			const pending = this.#database.prepare(`
				SELECT * FROM metadata_journal WHERE state IN ('prepared', 'committed')
				ORDER BY created_at_ms, transaction_id LIMIT 2
			`).all();
			if (pending.length > 1) throw new Error('Soundscaper desktop baseline catalog has conflicting recovery journals');
			if (pending.length === 0) return freezeRecovery({
				outcome: 'clean', previousRevision: null, publishedRevision: null,
			});
			const journalRow = pending[0];
			if (!journalRow) throw new Error('Soundscaper desktop baseline recovery journal is missing');
			const journal = validateJournalRow(journalRow);
			const current = this.#validatedMetadataRow().row;
			if (sameMetadataSnapshot(current, journal.next)) {
				this.#completeRecoveryJournal(journal.transactionId, 'complete');
				this.#assertLeaseOwned(lease);
				return freezeRecovery({
					outcome: 'committed',
					previousRevision: journal.previous.revision,
					publishedRevision: journal.next.revision,
				});
			}
			if (sameMetadataSnapshot(current, journal.previous)) {
				this.#completeRecoveryJournal(journal.transactionId, 'recovered');
				this.#assertLeaseOwned(lease);
				return freezeRecovery({
					outcome: 'interrupted',
					previousRevision: journal.previous.revision,
					publishedRevision: null,
				});
			}
			throw new Error('Soundscaper desktop baseline metadata changed outside its recovery journal');
		}));
	}

	#preparePublication(
		transactionId: string,
		lease: SoundscaperDesktopProjectLibraryLease,
		expectedRevision: number,
		next: MetadataRow,
	): void {
		this.#assertLeaseOwned(lease);
		if (this.#database.prepare(`
			SELECT 1 AS pending FROM metadata_journal
			WHERE state IN ('prepared', 'committed') LIMIT 1
		`).get()) throw new Error('Soundscaper desktop baseline metadata recovery is required before publishing');
		if (this.#database.prepare(`
			SELECT 1 AS pending FROM publication_journal
			WHERE state IN ('prepared', 'materialized', 'committed') LIMIT 1
		`).get()) throw new Error('Soundscaper desktop baseline body publication recovery is required before publishing');
		const previous = this.#validatedMetadataRow().row;
		if (previous.revision !== expectedRevision) {
			throw new Error('Soundscaper desktop baseline metadata failed its expected revision compare-and-swap');
		}
		this.#database.prepare(`
			INSERT INTO metadata_journal (
				transaction_id, state, previous_revision, previous_json, previous_digest,
				next_revision, next_json, next_digest, lease_id, fencing_token, created_at_ms
			) VALUES (?, 'prepared', ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			transactionId, previous.revision, previous.json, previous.digest,
			next.revision, next.json, next.digest, lease.leaseId, lease.fencingToken, this.#timestamp(),
		);
		this.#assertLeaseOwned(lease);
	}

	#commitPublication(transactionId: string, lease: SoundscaperDesktopProjectLibraryLease): void {
		this.#assertLeaseOwned(lease);
		const journal = this.#journalById(transactionId);
		if (!journal || journal.state !== 'prepared'
			|| journal.leaseId !== lease.leaseId || journal.fencingToken !== lease.fencingToken) {
			throw new Error('Soundscaper desktop baseline publication journal is not owned and prepared');
		}
		const current = this.#validatedMetadataRow().row;
		if (!sameMetadataSnapshot(current, journal.previous)) {
			throw new Error('Soundscaper desktop baseline metadata changed after journal preparation');
		}
		const metadataUpdate = this.#database.prepare(`
			UPDATE library_metadata SET revision = ?, json = ?, digest = ?, published_at_ms = ?
			WHERE singleton = 1 AND revision = ? AND json = ? AND digest = ?
		`).run(
			journal.next.revision, journal.next.json, journal.next.digest, this.#timestamp(),
			journal.previous.revision, journal.previous.json, journal.previous.digest,
		);
		if (metadataUpdate.changes !== 1) {
			throw new Error('Soundscaper desktop baseline metadata lost its compare-and-swap');
		}
		const journalUpdate = this.#database.prepare(`
			UPDATE metadata_journal SET state = 'committed'
			WHERE transaction_id = ? AND state = 'prepared' AND lease_id = ? AND fencing_token = ?
		`).run(transactionId, lease.leaseId, lease.fencingToken);
		if (journalUpdate.changes !== 1) {
			throw new Error('Soundscaper desktop baseline publication journal could not commit');
		}
		this.#assertLeaseOwned(lease);
	}

	#settlePublication(transactionId: string, lease: SoundscaperDesktopProjectLibraryLease): void {
		this.#assertLeaseOwned(lease);
		const result = this.#database.prepare(`
			UPDATE metadata_journal SET state = 'complete', completed_at_ms = ?
			WHERE transaction_id = ? AND state = 'committed' AND lease_id = ? AND fencing_token = ?
		`).run(this.#timestamp(), transactionId, lease.leaseId, lease.fencingToken);
		if (result.changes !== 1) throw new Error('Soundscaper desktop baseline publication journal could not complete');
		this.#pruneJournals();
		this.#assertLeaseOwned(lease);
	}

	#completeRecoveryJournal(transactionId: string, state: 'complete' | 'recovered'): void {
		const result = this.#database.prepare(`
			UPDATE metadata_journal SET state = ?, completed_at_ms = ?
			WHERE transaction_id = ? AND state IN ('prepared', 'committed')
		`).run(state, this.#timestamp(), transactionId);
		if (result.changes !== 1) throw new Error('Soundscaper desktop baseline recovery journal could not settle');
		this.#pruneJournals();
	}

	#pruneJournals(): void {
		this.#database.prepare(`
			DELETE FROM metadata_journal WHERE transaction_id IN (
				SELECT transaction_id FROM metadata_journal
				WHERE state IN ('complete', 'recovered')
				ORDER BY completed_at_ms DESC, transaction_id DESC LIMIT -1 OFFSET ?
			)
		`).run(MAXIMUM_RETAINED_JOURNALS);
	}

	#journalById(transactionId: string): JournalRow | null {
		const row = this.#database.prepare(
			'SELECT * FROM metadata_journal WHERE transaction_id = ?',
		).get(transactionId);
		return row ? validateJournalRow(row) : null;
	}

	#validatedMetadataRow(): {
		readonly metadata: Readonly<SoundscaperDesktopLibraryMetadata>;
		readonly row: MetadataRow;
	} {
		const raw = this.#database.prepare(`
			SELECT revision, json, digest, published_at_ms AS publishedAtMs
			FROM library_metadata WHERE singleton = 1
		`).get();
		if (!raw) throw new Error('Soundscaper desktop baseline metadata row is missing');
		const row = validateMetadataRow(raw, 'persisted baseline metadata');
		const metadata = validateMetadataIntegrity(row, 'Soundscaper desktop baseline metadata');
		return { metadata, row };
	}

	#leaseRow(): PersistedLeaseRow {
		const raw = this.#database.prepare(`
			SELECT active, lease_id AS leaseId, fencing_token AS fencingToken,
				owner_product AS ownerProduct, owner_process_id AS ownerProcessId,
				owner_instance_id AS ownerInstanceId, acquired_at_ms AS acquiredAtMs,
				expires_at_ms AS expiresAtMs, took_over AS tookOver
			FROM library_lease WHERE singleton = 1
		`).get();
		if (!raw) throw new Error('Soundscaper desktop baseline lease row is missing');
		const active = booleanInteger(raw.active, 'persisted baseline lease active');
		const fencingToken = nonNegativeInteger(raw.fencingToken, 'persisted baseline fencing token');
		if (fencingToken === 0) {
			if (active || raw.leaseId !== null || raw.ownerProduct !== null
				|| raw.ownerProcessId !== null || raw.ownerInstanceId !== null
				|| raw.acquiredAtMs !== null || raw.expiresAtMs !== null || raw.tookOver !== 0) {
				throw new TypeError('Initial Soundscaper desktop baseline lease row is invalid');
			}
			return Object.freeze({ active: false, lease: null });
		}
		const lease = freezeLease({
			leaseId: leaseId(raw.leaseId, 'persisted baseline lease id'),
			fencingToken,
			owner: validateSoundscaperDesktopProjectLibraryOwner({
				product: raw.ownerProduct,
				processId: raw.ownerProcessId,
				instanceId: raw.ownerInstanceId,
			}),
			acquiredAtMs: nonNegativeInteger(raw.acquiredAtMs, 'persisted baseline lease acquisition'),
			expiresAtMs: nonNegativeInteger(raw.expiresAtMs, 'persisted baseline lease expiry'),
			tookOverStaleLease: booleanInteger(raw.tookOver, 'persisted baseline lease takeover'),
		});
		if (lease.expiresAtMs <= lease.acquiredAtMs) {
			throw new TypeError('Persisted Soundscaper desktop baseline lease expiry is invalid');
		}
		return Object.freeze({ active, lease });
	}

	#assertLeaseOwned(
		token: SoundscaperDesktopProjectLibraryLease,
		now = this.#timestamp(),
	): SoundscaperDesktopProjectLibraryLease {
		const current = this.#leaseRow();
		if (!current.active || !current.lease || current.lease.expiresAtMs <= now
			|| !sameLease(current.lease, token)) throw leaseLost();
		return current.lease;
	}

	#transaction<Result>(operation: () => Result): Result {
		this.#database.exec('BEGIN IMMEDIATE');
		try {
			assertSoundscaperDesktopProjectLibraryDatabaseIdentity(this.#database);
			const result = operation();
			this.#database.exec('COMMIT');
			return result;
		} catch (error) {
			if (this.#database.isTransaction) this.#database.exec('ROLLBACK');
			throw error;
		}
	}

	#exclusiveMetadataOperation<Result>(operation: () => Result): Result {
		if (this.#metadataOperationActive) {
			throw new Error('A Soundscaper desktop baseline metadata operation is already active');
		}
		this.#metadataOperationActive = true;
		try {
			return operation();
		} finally {
			this.#metadataOperationActive = false;
		}
	}

	#newId(): string {
		const value = this.#randomId();
		return leaseId(value, 'baseline lease or journal id');
	}

	#timestamp(): number {
		return nonNegativeInteger(this.#now(), 'Soundscaper desktop baseline clock');
	}

	#assertReady(): void {
		this.#gate.assertOperational();
		assertSoundscaperDesktopProjectLibraryDatabaseIdentity(this.#database);
	}
}

function snapshotOptions(value: unknown): Record<typeof CREATE_FIELDS[number], unknown> {
	const record = snapshotRecord(value, CREATE_FIELDS, 'Soundscaper desktop baseline catalog options');
	if (record.database === undefined || record.owner === undefined) {
		throw new TypeError('Soundscaper desktop baseline catalog options are incomplete');
	}
	return record;
}

function snapshotClosedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Readonly<Record<Field, unknown>> {
	const record = snapshotRecord(value, fields, name);
	if (fields.some((field) => record[field] === undefined)) {
		throw new TypeError(`${name} has missing fields`);
	}
	return record;
}

function snapshotRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${name} has unsupported fields`);
	}
	const result = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor) {
			result[field] = undefined;
			continue;
		}
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property`);
		}
		result[field] = descriptor.value;
	}
	return result;
}

function freezeRecovery(
	value: SoundscaperDesktopProjectLibraryRecovery,
): Readonly<SoundscaperDesktopProjectLibraryRecovery> {
	return Object.freeze({ ...value });
}

function leaseTtl(value: unknown): number {
	return boundedInteger(value, MINIMUM_LEASE_TTL_MS, MAXIMUM_LEASE_TTL_MS,
		'Soundscaper desktop baseline lease TTL');
}

function increment(value: number, label: string): number {
	if (value === Number.MAX_SAFE_INTEGER) throw new RangeError(`${label} cannot advance`);
	return value + 1;
}

function checkedAdd(left: number, right: number, label: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${label} exceeds the safe range`);
	return result;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`${label} must be between ${minimum.toLocaleString('en-US')} and ${maximum.toLocaleString('en-US')}`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	return boundedInteger(value, 0, Number.MAX_SAFE_INTEGER, label);
}

function booleanInteger(value: unknown, label: string): boolean {
	if (value !== 0 && value !== 1) throw new TypeError(`${label} must be zero or one`);
	return value === 1;
}

function leaseLost(): Error {
	return new Error('Soundscaper desktop baseline lease holder no longer owns the lease');
}
