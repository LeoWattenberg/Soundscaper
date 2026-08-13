/* SPDX-License-Identifier: AGPL-3.0-only */

import { chmod, mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import {
	FramescaperDesktopProjectLibraryV10Catalog,
	type FramescaperDesktopProjectLibraryV10Lease,
} from './project-library-v10-catalog.ts';
import {
	createFramescaperDesktopProjectLibraryV10Paths,
	validateFramescaperDesktopProjectLibraryV10Handshake,
	validateFramescaperDesktopProjectLibraryV10Owner,
	type FramescaperDesktopProjectLibraryV10Handshake,
	type FramescaperDesktopProjectLibraryV10Owner,
	type FramescaperDesktopProjectLibraryV10Paths,
} from './project-library-v10-contract.ts';
import {
	initializeFramescaperDesktopProjectLibraryV10Database,
} from './project-library-v10-database.ts';
import {
	FramescaperDesktopProjectLibraryV10MainSessionService,
	type FramescaperDesktopProjectLibraryV10MainSession,
} from './project-library-v10-main-session.ts';
import {
	FramescaperDesktopProjectLibraryV10PublicationHost,
} from './project-library-v10-publication-host.ts';
import {
	FramescaperDesktopProjectLibraryV10TransferService,
} from './project-library-v10-transfer-service.ts';

const START_FIELDS = ['appDataPath', 'owner', 'handshake'] as const;
const LEASE_TTL_MS = 30_000;
const RENEW_INTERVAL_MS = 10_000;

export interface FramescaperDesktopProjectLibraryV10MainSnapshot {
	readonly closed: boolean;
	readonly fenced: boolean;
	readonly owner: Readonly<FramescaperDesktopProjectLibraryV10Owner>;
	readonly activeSessions: number;
	readonly activePublication: boolean;
}

interface StartOptions {
	readonly appDataPath: string;
	readonly owner: FramescaperDesktopProjectLibraryV10Owner;
	readonly handshake: FramescaperDesktopProjectLibraryV10Handshake;
}

/** Dormant product-owned V10 main composition. The maintained Electron main does not select it. */
export class FramescaperDesktopProjectLibraryV10Main {
	readonly localHandshake: Readonly<FramescaperDesktopProjectLibraryV10Handshake>;
	readonly #catalog: FramescaperDesktopProjectLibraryV10Catalog;
	readonly #database: DatabaseSync;
	readonly #host: FramescaperDesktopProjectLibraryV10PublicationHost;
	readonly #owner: Readonly<FramescaperDesktopProjectLibraryV10Owner>;
	readonly #paths: Readonly<FramescaperDesktopProjectLibraryV10Paths>;
	readonly #sessions: FramescaperDesktopProjectLibraryV10MainSessionService;
	#closePromise: Promise<void> | null = null;
	#closed = false;
	#fencePromise: Promise<void> | null = null;
	#fenced: unknown = null;
	#lease: FramescaperDesktopProjectLibraryV10Lease;
	#renewTimer: ReturnType<typeof setInterval> | null = null;

	private constructor(
		paths: Readonly<FramescaperDesktopProjectLibraryV10Paths>,
		database: DatabaseSync,
		catalog: FramescaperDesktopProjectLibraryV10Catalog,
		host: FramescaperDesktopProjectLibraryV10PublicationHost,
		lease: FramescaperDesktopProjectLibraryV10Lease,
		owner: Readonly<FramescaperDesktopProjectLibraryV10Owner>,
	) {
		this.#paths = paths;
		this.#database = database;
		this.#catalog = catalog;
		this.#host = host;
		this.#lease = lease;
		this.#owner = owner;
		const transfer = FramescaperDesktopProjectLibraryV10TransferService.create({ host });
		this.#sessions = new FramescaperDesktopProjectLibraryV10MainSessionService(host, lease, transfer);
		this.localHandshake = transfer.localHandshake;
		this.#renewTimer = setInterval(() => { this.#renewLease(); }, RENEW_INTERVAL_MS);
		this.#renewTimer.unref?.();
		Object.freeze(this);
	}

	static async start(value: unknown): Promise<FramescaperDesktopProjectLibraryV10Main> {
		const options = validateStartOptions(value);
		const paths = createFramescaperDesktopProjectLibraryV10Paths(options.appDataPath);
		await createPrivateLibrary(paths);
		const database = new DatabaseSync(paths.databasePath, {
			allowExtension: false,
			enableDoubleQuotedStringLiterals: false,
			enableForeignKeyConstraints: true,
			timeout: 50,
		});
		let catalog: FramescaperDesktopProjectLibraryV10Catalog | null = null;
		let lease: FramescaperDesktopProjectLibraryV10Lease | null = null;
		try {
			await chmod(paths.databasePath, 0o600);
			initializeFramescaperDesktopProjectLibraryV10Database(database);
			catalog = FramescaperDesktopProjectLibraryV10Catalog.create({
				database,
				owner: options.owner,
			});
			catalog.acceptHandshake(options.handshake);
			const host = FramescaperDesktopProjectLibraryV10PublicationHost.create({
				database,
				appDataPath: options.appDataPath,
			});
			host.acceptHandshake(options.handshake);
			lease = catalog.acquireLease({ ttlMs: LEASE_TTL_MS });
			await recoverPending(database, catalog, host, lease);
			return new FramescaperDesktopProjectLibraryV10Main(
				paths,
				database,
				catalog,
				host,
				lease,
				options.owner,
			);
		} catch (error) {
			if (catalog && lease) {
				try { catalog.releaseLease(lease); } catch { /* Startup error remains authoritative. */ }
			}
			database.close();
			throw error;
		}
	}

	snapshot(): Readonly<FramescaperDesktopProjectLibraryV10MainSnapshot> {
		return Object.freeze({
			closed: this.#closed,
			fenced: this.#fenced !== null,
			owner: this.#owner,
			activeSessions: this.#sessions.activeSessions,
			activePublication: this.#sessions.activePublication,
		});
	}

	openSession(value: unknown): FramescaperDesktopProjectLibraryV10MainSession {
		return this.#sessions.openSession(value);
	}

	close(): Promise<void> {
		if (this.#closePromise) return this.#closePromise;
		this.#closed = true;
		this.#closePromise = this.#close();
		return this.#closePromise;
	}

	async #close(): Promise<void> {
		const failures: unknown[] = [];
		try { await this.#sessions.close(); } catch (error) { failures.push(error); }
		if (this.#renewTimer) clearInterval(this.#renewTimer);
		this.#renewTimer = null;
		if (this.#fencePromise) await this.#fencePromise.catch((error: unknown) => failures.push(error));
		if (this.#fenced === null) {
			try {
				await recoverPending(this.#database, this.#catalog, this.#host, this.#lease);
			} catch (error) { failures.push(error); }
		}
		try {
			if (!this.#catalog.releaseLease(this.#lease) && this.#fenced === null) {
				this.#fenced = new Error('Framescaper V10 main lost its writer lease before shutdown');
			}
		} catch (error) { failures.push(error); }
		try { this.#database.close(); } catch (error) { failures.push(error); }
		throwFailures(failures);
	}

	#renewLease(): void {
		if (this.#closed || this.#fenced !== null) return;
		try {
			this.#lease = this.#catalog.renewLease(this.#lease, { ttlMs: LEASE_TTL_MS });
		} catch (error) {
			this.#fenced = error;
			this.#fencePromise = this.#sessions.fence(error);
		}
	}
}

async function recoverPending(
	database: DatabaseSync,
	catalog: FramescaperDesktopProjectLibraryV10Catalog,
	host: FramescaperDesktopProjectLibraryV10PublicationHost,
	lease: FramescaperDesktopProjectLibraryV10Lease,
): Promise<void> {
	const metadataPending = Boolean(database.prepare(`
		SELECT 1 AS pending FROM metadata_journal
		WHERE state IN ('prepared', 'committed') LIMIT 1
	`).get());
	const publicationPending = Boolean(database.prepare(`
		SELECT 1 AS pending FROM publication_journal
		WHERE state IN ('prepared', 'materialized', 'committed') LIMIT 1
	`).get());
	if (metadataPending && publicationPending) {
		throw new Error('Framescaper V10 database has conflicting metadata and body recovery journals');
	}
	if (publicationPending) await host.recover({ lease });
	if (metadataPending) catalog.recoverMetadata({ lease });
}

function validateStartOptions(value: unknown): Readonly<StartOptions> {
	const record = snapshotClosedRecord(value, START_FIELDS, 'Framescaper V10 main options');
	if (typeof record.appDataPath !== 'string') {
		throw new TypeError('Framescaper V10 main appDataPath must be a string');
	}
	return Object.freeze({
		appDataPath: record.appDataPath,
		owner: validateFramescaperDesktopProjectLibraryV10Owner(record.owner),
		handshake: validateFramescaperDesktopProjectLibraryV10Handshake(record.handshake),
	});
}

async function createPrivateLibrary(
	paths: Readonly<FramescaperDesktopProjectLibraryV10Paths>,
): Promise<void> {
	await mkdir(paths.projectsRoot, { recursive: true, mode: 0o700 });
	await mkdir(paths.managedMediaRoot, { recursive: true, mode: 0o700 });
	await Promise.all([
		chmod(paths.libraryRoot, 0o700),
		chmod(paths.projectsRoot, 0o700),
		chmod(paths.managedMediaRoot, 0o700),
	]);
}

function snapshotClosedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${name} has missing or unsupported fields`);
	const result = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property`);
		}
		result[field] = descriptor.value;
	}
	return result;
}

function throwFailures(failures: readonly unknown[]): void {
	if (failures.length === 0) return;
	if (failures.length === 1) throw failures[0];
	throw new AggregateError(failures, 'Framescaper V10 main shutdown failed');
}
