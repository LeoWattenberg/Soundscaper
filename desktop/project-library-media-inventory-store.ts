/* SPDX-License-Identifier: AGPL-3.0-only */

import { DatabaseSync } from 'node:sqlite';

import type {
	DesktopLibraryLease,
	DesktopProjectLibraryPaths,
} from './project-library-contract.ts';
import { validateDesktopProjectLibraryPaths } from './project-library-contract.ts';
import { assertDesktopProjectLibraryDatabaseIdentity } from './project-library-database.ts';
import {
	discardDesktopLibraryManagedMediaStageFile,
	materializeDesktopLibraryManagedMediaStageFile,
	reserveDesktopLibraryManagedMediaFile,
	validateDesktopLibraryManagedMediaInventory,
	type DesktopLibraryManagedMediaReservationOptions,
	type DesktopLibraryManagedMediaStageDiscardOptions,
	type DesktopLibraryManagedMediaStageOperationOptions,
	type DesktopLibraryManagedMediaInventoryRow,
} from './project-library-media-inventory.ts';
import {
	sameLease,
	validateLeaseToken,
	validatePersistedLease,
} from './project-library-persistence.ts';

export interface DesktopLibraryManagedMediaInventoryStoreOptions {
	readonly now?: () => number;
}

type Reservation = Omit<DesktopLibraryManagedMediaReservationOptions, 'registeredAtMs'>;

/** Main-process inventory connection. No database, path, or lease detail crosses IPC. */
export class DesktopLibraryManagedMediaInventoryStore {
	readonly #database: DatabaseSync;
	readonly #managedMediaRoot: string;
	readonly #now: () => number;
	#closed = false;

	constructor(
		pathsValue: DesktopProjectLibraryPaths,
		options: DesktopLibraryManagedMediaInventoryStoreOptions = {},
	) {
		const paths = validateDesktopProjectLibraryPaths(pathsValue);
		this.#managedMediaRoot = paths.managedMediaRoot;
		this.#now = options.now ?? Date.now;
		this.#database = new DatabaseSync(paths.databasePath, {
			allowExtension: false,
			enableDoubleQuotedStringLiterals: false,
			enableForeignKeyConstraints: true,
			timeout: 50,
		});
		try {
			this.#database.exec('PRAGMA trusted_schema = OFF;');
			assertDesktopProjectLibraryDatabaseIdentity(this.#database);
			validateDesktopLibraryManagedMediaInventory(this.#database);
		} catch (error) {
			this.#database.close();
			throw error;
		}
	}

	reserve(options: Reservation): DesktopLibraryManagedMediaInventoryRow {
		this.#assertOpen();
		const lease = validateLeaseToken(options.lease);
		return this.#transaction(() => {
			this.#assertLeaseOwned(lease);
			const row = reserveDesktopLibraryManagedMediaFile(this.#database, {
				...options,
				lease,
				registeredAtMs: this.#timestamp(),
			});
			this.#assertLeaseOwned(lease);
			return row;
		});
	}

	materialize(options: DesktopLibraryManagedMediaStageOperationOptions): void {
		this.#assertOpen();
		const lease = validateLeaseToken(options.lease);
		this.#transaction(() => {
			this.#assertLeaseOwned(lease);
			materializeDesktopLibraryManagedMediaStageFile(
				this.#database,
				this.#managedMediaRoot,
				{ ...options, lease },
			);
			this.#assertLeaseOwned(lease);
		});
	}

	discard(options: DesktopLibraryManagedMediaStageDiscardOptions): boolean {
		this.#assertOpen();
		const lease = validateLeaseToken(options.lease);
		return this.#transaction(() => {
			if (!this.#ownsLease(lease)) return false;
			const discarded = discardDesktopLibraryManagedMediaStageFile(
				this.#database,
				this.#managedMediaRoot,
				{ ...options, lease },
			);
			this.#assertLeaseOwned(lease);
			return discarded;
		});
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#database.close();
	}

	#assertLeaseOwned(token: DesktopLibraryLease): void {
		if (!this.#ownsLease(token)) {
			throw new Error('Desktop library lease holder no longer owns the lease');
		}
	}

	#ownsLease(token: DesktopLibraryLease): boolean {
		const raw = this.#database.prepare(`
			SELECT active, lease_id AS leaseId, fencing_token AS fencingToken,
				owner_product AS ownerProduct, owner_process_id AS ownerProcessId,
				owner_instance_id AS ownerInstanceId, acquired_at_ms AS acquiredAtMs,
				expires_at_ms AS expiresAtMs, took_over AS tookOver
			FROM library_lease WHERE singleton = 1
		`).get();
		if (!raw) throw new Error('Desktop project library lease row is missing');
		if (raw.active !== 0 && raw.active !== 1) {
			throw new TypeError('Persisted desktop library lease state is invalid');
		}
		const fencingToken = nonNegativeInteger(raw.fencingToken, 'persisted lease fencing token');
		if (raw.active !== 1 || fencingToken === 0) return false;
		const current = validatePersistedLease(raw, fencingToken);
		return sameLease(current, token) && current.expiresAtMs > this.#timestamp();
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

	#timestamp(): number {
		return nonNegativeInteger(this.#now(), 'desktop managed-media inventory clock');
	}

	#assertOpen(): void {
		if (this.#closed) throw new Error('Desktop library managed-media inventory store is closed');
	}
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${label} must be a non-negative safe integer`);
	}
	return value;
}
