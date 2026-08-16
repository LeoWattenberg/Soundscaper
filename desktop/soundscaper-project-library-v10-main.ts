/* SPDX-License-Identifier: AGPL-3.0-only */

import { chmod, mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import {
	SoundscaperDesktopProjectLibraryV10Catalog,
	type SoundscaperDesktopProjectLibraryV10Lease,
	type SoundscaperDesktopProjectLibraryV10Recovery,
} from './soundscaper-project-library-v10-catalog.ts';
import {
	createSoundscaperDesktopProjectLibraryV10Paths,
	validateSoundscaperDesktopProjectLibraryV10Handshake,
	validateSoundscaperDesktopProjectLibraryV10Owner,
	type SoundscaperDesktopProjectLibraryV10Handshake,
	type SoundscaperDesktopProjectLibraryV10Owner,
	type SoundscaperDesktopProjectLibraryV10Paths,
} from './soundscaper-project-library-v10-contract.ts';
import {
	initializeSoundscaperDesktopProjectLibraryV10Database,
} from './soundscaper-project-library-v10-database.ts';
import {
	SoundscaperDesktopProjectLibraryV10MainSessionService,
	type SoundscaperDesktopProjectLibraryV10MainSession,
} from './soundscaper-project-library-v10-main-session.ts';
import {
	SoundscaperDesktopProjectLibraryV10LifecycleHost,
} from './soundscaper-project-library-v10-lifecycle-host.ts';
import {
	SoundscaperDesktopProjectLibraryV10PublicationHost,
} from './soundscaper-project-library-v10-publication-host.ts';
import {
	type SoundscaperDesktopProjectLibraryV10PublicationCheckpoint,
} from './soundscaper-project-library-v10-publication-contract.ts';
import {
	SoundscaperDesktopProjectLibraryV10TransferService,
} from './soundscaper-project-library-v10-transfer-service.ts';
import { acquireProjectLibraryV10LeaseWithWait } from './project-library-v10-lease-wait.ts';

const START_FIELDS = ['appDataPath', 'owner', 'handshake', 'qualification'] as const;
const QUALIFICATION_FIELDS = ['leaseTtlMs', 'renewIntervalMs', 'checkpoint'] as const;
const LEASE_TTL_MS = 30_000;
const RENEW_INTERVAL_MS = 10_000;

export interface SoundscaperDesktopProjectLibraryV10MainWriter {
	readonly fencingToken: number;
	readonly tookOverStaleLease: boolean;
	readonly recovery: Readonly<SoundscaperDesktopProjectLibraryV10Recovery>;
}

export interface SoundscaperDesktopProjectLibraryV10MainSnapshot {
	readonly closed: boolean;
	readonly fenced: boolean;
	readonly owner: Readonly<SoundscaperDesktopProjectLibraryV10Owner>;
	readonly activeSessions: number;
	readonly activePublication: boolean;
	readonly writer: Readonly<SoundscaperDesktopProjectLibraryV10MainWriter>;
}

/**
 * Lease timings and journal checkpoints the packaged lease matrix needs to
 * observe concurrency within a bounded run. Both timings are lower-only, so a
 * qualification run can only tighten the fence it is measuring, never relax it,
 * and production passes null.
 */
export interface SoundscaperDesktopProjectLibraryV10Qualification {
	readonly leaseTtlMs: number;
	readonly renewIntervalMs: number;
	readonly checkpoint: ((phase: SoundscaperDesktopProjectLibraryV10PublicationCheckpoint) => void) | null;
}

interface StartOptions {
	readonly appDataPath: string;
	readonly owner: SoundscaperDesktopProjectLibraryV10Owner;
	readonly handshake: SoundscaperDesktopProjectLibraryV10Handshake;
	readonly qualification: Readonly<SoundscaperDesktopProjectLibraryV10Qualification> | null;
}

/** Product-owned V10 main composition selected only by the packaged Soundscaper profile. */
export class SoundscaperDesktopProjectLibraryV10Main {
	readonly localHandshake: Readonly<SoundscaperDesktopProjectLibraryV10Handshake>;
	readonly #catalog: SoundscaperDesktopProjectLibraryV10Catalog;
	readonly #database: DatabaseSync;
	readonly #host: SoundscaperDesktopProjectLibraryV10PublicationHost;
	readonly #lifecycle: SoundscaperDesktopProjectLibraryV10LifecycleHost;
	readonly #owner: Readonly<SoundscaperDesktopProjectLibraryV10Owner>;
	readonly #paths: Readonly<SoundscaperDesktopProjectLibraryV10Paths>;
	readonly #sessions: SoundscaperDesktopProjectLibraryV10MainSessionService;
	#closePromise: Promise<void> | null = null;
	#closed = false;
	#fencePromise: Promise<void> | null = null;
	#fenced: unknown = null;
	#lease: SoundscaperDesktopProjectLibraryV10Lease;
	#renewTimer: ReturnType<typeof setInterval> | null = null;
	readonly #writer: Readonly<SoundscaperDesktopProjectLibraryV10MainWriter>;
	readonly #leaseTtlMs: number;

	private constructor(
		paths: Readonly<SoundscaperDesktopProjectLibraryV10Paths>,
		database: DatabaseSync,
		catalog: SoundscaperDesktopProjectLibraryV10Catalog,
		host: SoundscaperDesktopProjectLibraryV10PublicationHost,
		lifecycle: SoundscaperDesktopProjectLibraryV10LifecycleHost,
		lease: SoundscaperDesktopProjectLibraryV10Lease,
		owner: Readonly<SoundscaperDesktopProjectLibraryV10Owner>,
		writer: Readonly<SoundscaperDesktopProjectLibraryV10MainWriter>,
		renewIntervalMs: number,
		leaseTtlMs: number,
	) {
		this.#writer = writer;
		this.#leaseTtlMs = leaseTtlMs;
		this.#paths = paths;
		this.#database = database;
		this.#catalog = catalog;
		this.#host = host;
		this.#lifecycle = lifecycle;
		this.#lease = lease;
		this.#owner = owner;
		const transfer = SoundscaperDesktopProjectLibraryV10TransferService.create({ host });
		this.#sessions = new SoundscaperDesktopProjectLibraryV10MainSessionService(
			host,
			lifecycle,
			lease,
			transfer,
		);
		this.localHandshake = transfer.localHandshake;
		this.#renewTimer = setInterval(() => { this.#renewLease(); }, renewIntervalMs);
		this.#renewTimer.unref?.();
		Object.freeze(this);
	}

	static async start(value: unknown): Promise<SoundscaperDesktopProjectLibraryV10Main> {
		const options = validateStartOptions(value);
		const paths = createSoundscaperDesktopProjectLibraryV10Paths(options.appDataPath);
		await createPrivateLibrary(paths);
		const database = new DatabaseSync(paths.databasePath, {
			allowExtension: false,
			enableDoubleQuotedStringLiterals: false,
			enableForeignKeyConstraints: true,
			timeout: 50,
		});
		let catalog: SoundscaperDesktopProjectLibraryV10Catalog | null = null;
		let lease: SoundscaperDesktopProjectLibraryV10Lease | null = null;
		try {
			await chmod(paths.databasePath, 0o600);
			initializeSoundscaperDesktopProjectLibraryV10Database(database);
			const leaseTtlMs = options.qualification?.leaseTtlMs ?? LEASE_TTL_MS;
			catalog = SoundscaperDesktopProjectLibraryV10Catalog.create({
				database,
				owner: options.owner,
				...(options.qualification?.checkpoint ? { checkpoint: options.qualification.checkpoint } : {}),
			});
			catalog.acceptHandshake(options.handshake);
			const host = SoundscaperDesktopProjectLibraryV10PublicationHost.create({
				database,
				appDataPath: options.appDataPath,
				...(options.qualification?.checkpoint ? { checkpoint: options.qualification.checkpoint } : {}),
			});
			host.acceptHandshake(options.handshake);
			// A crashed owner leaves its lease unexpired, so wait it out rather than
			// failing startup before any window exists.
			const readyCatalog = catalog;
			let tookOverStaleLease = false;
			lease = await acquireProjectLibraryV10LeaseWithWait(
				() => readyCatalog.acquireLease({ ttlMs: leaseTtlMs }),
				{
					waitMs: leaseTtlMs + 1_000,
					onWait: () => { tookOverStaleLease = true; },
				},
			);
			const recovery = await recoverPending(database, catalog, host, lease);
			const lifecycle = SoundscaperDesktopProjectLibraryV10LifecycleHost.create({
				catalog,
				host,
				lease,
			});
			return new SoundscaperDesktopProjectLibraryV10Main(
				paths,
				database,
				catalog,
				host,
				lifecycle,
				lease,
				options.owner,
				Object.freeze({ fencingToken: lease.fencingToken, tookOverStaleLease, recovery }),
				options.qualification?.renewIntervalMs ?? RENEW_INTERVAL_MS,
				leaseTtlMs,
			);
		} catch (error) {
			if (catalog && lease) {
				try { catalog.releaseLease(lease); } catch { /* Startup error remains authoritative. */ }
			}
			database.close();
			throw error;
		}
	}

	snapshot(): Readonly<SoundscaperDesktopProjectLibraryV10MainSnapshot> {
		return Object.freeze({
			closed: this.#closed,
			fenced: this.#fenced !== null,
			owner: this.#owner,
			activeSessions: this.#sessions.activeSessions,
			activePublication: this.#sessions.activePublication,
			writer: this.#writer,
		});
	}

	openSession(value: unknown): SoundscaperDesktopProjectLibraryV10MainSession {
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
				this.#fenced = new Error('Soundscaper V10 main lost its writer lease before shutdown');
			}
		} catch (error) { failures.push(error); }
		try { this.#database.close(); } catch (error) { failures.push(error); }
		throwFailures(failures);
	}

	#renewLease(): void {
		if (this.#closed || this.#fenced !== null) return;
		try {
			this.#lease = this.#catalog.renewLease(this.#lease, { ttlMs: this.#leaseTtlMs });
			this.#lifecycle.updateLease(this.#lease);
			this.#sessions.updateLease(this.#lease);
		} catch (error) {
			this.#fenced = error;
			this.#fencePromise = this.#sessions.fence(error);
		}
	}
}

async function recoverPending(
	database: DatabaseSync,
	catalog: SoundscaperDesktopProjectLibraryV10Catalog,
	host: SoundscaperDesktopProjectLibraryV10PublicationHost,
	lease: SoundscaperDesktopProjectLibraryV10Lease,
): Promise<Readonly<SoundscaperDesktopProjectLibraryV10Recovery>> {
	const metadataPending = Boolean(database.prepare(`
		SELECT 1 AS pending FROM metadata_journal
		WHERE state IN ('prepared', 'committed') LIMIT 1
	`).get());
	const publicationPending = Boolean(database.prepare(`
		SELECT 1 AS pending FROM publication_journal
		WHERE state IN ('prepared', 'materialized', 'committed') LIMIT 1
	`).get());
	if (metadataPending && publicationPending) {
		throw new Error('Soundscaper V10 database has conflicting metadata and body recovery journals');
	}
	if (publicationPending) await host.recover({ lease });
	if (metadataPending) return catalog.recoverMetadata({ lease });
	return Object.freeze({ outcome: 'clean' as const, previousRevision: null, publishedRevision: null });
}

function validateStartOptions(value: unknown): Readonly<StartOptions> {
	const record = snapshotClosedRecord(value, START_FIELDS, 'Soundscaper V10 main options');
	if (typeof record.appDataPath !== 'string') {
		throw new TypeError('Soundscaper V10 main appDataPath must be a string');
	}
	return Object.freeze({
		appDataPath: record.appDataPath,
		owner: validateSoundscaperDesktopProjectLibraryV10Owner(record.owner),
		handshake: validateSoundscaperDesktopProjectLibraryV10Handshake(record.handshake),
		qualification: validateQualification(record.qualification),
	});
}

function validateQualification(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryV10Qualification> | null {
	if (value === null) return null;
	const record = snapshotClosedRecord(value, QUALIFICATION_FIELDS, 'Soundscaper V10 qualification');
	if (record.checkpoint !== null && typeof record.checkpoint !== 'function') {
		throw new TypeError('Soundscaper V10 qualification checkpoint must be a function or null');
	}
	return Object.freeze({
		leaseTtlMs: lowerOnlyMilliseconds(record.leaseTtlMs, LEASE_TTL_MS, 'lease TTL'),
		renewIntervalMs: lowerOnlyMilliseconds(record.renewIntervalMs, RENEW_INTERVAL_MS, 'lease renewal interval'),
		checkpoint: record.checkpoint as SoundscaperDesktopProjectLibraryV10Qualification['checkpoint'],
	});
}

/**
 * A qualification run may only tighten a lease timing. Allowing a longer TTL
 * would let the matrix report a fence the shipped product does not enforce.
 */
function lowerOnlyMilliseconds(value: unknown, ceiling: number, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > ceiling) {
		throw new RangeError(`Soundscaper V10 qualification ${name} must be an integer from 1 through ${ceiling} milliseconds`);
	}
	return value as number;
}

async function createPrivateLibrary(
	paths: Readonly<SoundscaperDesktopProjectLibraryV10Paths>,
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
	throw new AggregateError(failures, 'Soundscaper V10 main shutdown failed');
}
