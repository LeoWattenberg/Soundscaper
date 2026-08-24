/* SPDX-License-Identifier: AGPL-3.0-only */

import { chmod, mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import { admitLowerOnly } from '../src/common/editor/lower-only-seam.ts';
import {
	SoundscaperDesktopProjectLibraryV11Catalog,
	type SoundscaperDesktopProjectLibraryV11Lease,
	type SoundscaperDesktopProjectLibraryV11Recovery,
} from './soundscaper-project-library-v11-catalog.ts';
import {
	createSoundscaperDesktopProjectLibraryV11Paths,
	validateSoundscaperDesktopProjectLibraryV11Handshake,
	validateSoundscaperDesktopProjectLibraryV11Owner,
	type SoundscaperDesktopProjectLibraryV11Handshake,
	type SoundscaperDesktopProjectLibraryV11Owner,
	type SoundscaperDesktopProjectLibraryV11Paths,
} from './soundscaper-project-library-v11-contract.ts';
import {
	initializeSoundscaperDesktopProjectLibraryV11Database,
} from './soundscaper-project-library-v11-database.ts';
import {
	SoundscaperDesktopProjectLibraryV11MainSessionService,
	type SoundscaperDesktopProjectLibraryV11MainSession,
} from './soundscaper-project-library-v11-main-session.ts';
import {
	SoundscaperDesktopProjectLibraryV11LifecycleHost,
} from './soundscaper-project-library-v11-lifecycle-host.ts';
import {
	SoundscaperDesktopProjectLibraryV11PublicationHost,
} from './soundscaper-project-library-v11-publication-host.ts';
import {
	type SoundscaperDesktopProjectLibraryV11PublicationCheckpoint,
} from './soundscaper-project-library-v11-publication-contract.ts';
import {
	SoundscaperDesktopProjectLibraryV11TransferService,
} from './soundscaper-project-library-v11-transfer-service.ts';
import { acquireProjectLibraryV10LeaseWithWait } from './project-library-v10-lease-wait.ts';
import {
	SoundscaperNativePluginStateStore,
	type SoundscaperNativePluginStateBodyDescriptor,
	type SoundscaperNativePluginStateBodyRecord,
} from './soundscaper-native-plugin-state-store.ts';

const START_FIELDS = ['appDataPath', 'owner', 'handshake', 'qualification'] as const;
const QUALIFICATION_FIELDS = ['leaseTtlMs', 'renewIntervalMs', 'checkpoint'] as const;
const LEASE_TTL_MS = 30_000;
const RENEW_INTERVAL_MS = 10_000;

export interface SoundscaperDesktopProjectLibraryV11MainWriter {
	readonly fencingToken: number;
	readonly tookOverStaleLease: boolean;
	readonly recovery: Readonly<SoundscaperDesktopProjectLibraryV11Recovery>;
}

export interface SoundscaperDesktopProjectLibraryV11MainSnapshot {
	readonly closed: boolean;
	readonly fenced: boolean;
	readonly owner: Readonly<SoundscaperDesktopProjectLibraryV11Owner>;
	readonly activeSessions: number;
	readonly activePublication: boolean;
	readonly writer: Readonly<SoundscaperDesktopProjectLibraryV11MainWriter>;
}

/**
 * Lease timings and journal checkpoints the packaged lease matrix needs to
 * observe concurrency within a bounded run. Both timings are lower-only, so a
 * qualification run can only tighten the fence it is measuring, never relax it,
 * and production passes null.
 */
export interface SoundscaperDesktopProjectLibraryV11Qualification {
	readonly leaseTtlMs: number;
	readonly renewIntervalMs: number;
	readonly checkpoint: ((phase: SoundscaperDesktopProjectLibraryV11PublicationCheckpoint) => void) | null;
}

interface StartOptions {
	readonly appDataPath: string;
	readonly owner: SoundscaperDesktopProjectLibraryV11Owner;
	readonly handshake: SoundscaperDesktopProjectLibraryV11Handshake;
	readonly qualification: Readonly<SoundscaperDesktopProjectLibraryV11Qualification> | null;
}

/** Product-owned V11 main composition selected only by the packaged Soundscaper profile. */
export class SoundscaperDesktopProjectLibraryV11Main {
	readonly localHandshake: Readonly<SoundscaperDesktopProjectLibraryV11Handshake>;
	readonly #catalog: SoundscaperDesktopProjectLibraryV11Catalog;
	readonly #database: DatabaseSync;
	readonly #host: SoundscaperDesktopProjectLibraryV11PublicationHost;
	readonly #lifecycle: SoundscaperDesktopProjectLibraryV11LifecycleHost;
	readonly #owner: Readonly<SoundscaperDesktopProjectLibraryV11Owner>;
	readonly #pluginStates: SoundscaperNativePluginStateStore;
	readonly #paths: Readonly<SoundscaperDesktopProjectLibraryV11Paths>;
	readonly #sessions: SoundscaperDesktopProjectLibraryV11MainSessionService;
	#closePromise: Promise<void> | null = null;
	#closed = false;
	#fencePromise: Promise<void> | null = null;
	#fenced: unknown = null;
	#lease: SoundscaperDesktopProjectLibraryV11Lease;
	#renewTimer: ReturnType<typeof setInterval> | null = null;
	readonly #writer: Readonly<SoundscaperDesktopProjectLibraryV11MainWriter>;
	readonly #leaseTtlMs: number;

	private constructor(
		paths: Readonly<SoundscaperDesktopProjectLibraryV11Paths>,
		database: DatabaseSync,
		catalog: SoundscaperDesktopProjectLibraryV11Catalog,
		host: SoundscaperDesktopProjectLibraryV11PublicationHost,
		lifecycle: SoundscaperDesktopProjectLibraryV11LifecycleHost,
		lease: SoundscaperDesktopProjectLibraryV11Lease,
		owner: Readonly<SoundscaperDesktopProjectLibraryV11Owner>,
		writer: Readonly<SoundscaperDesktopProjectLibraryV11MainWriter>,
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
		this.#pluginStates = new SoundscaperNativePluginStateStore(database);
		const transfer = SoundscaperDesktopProjectLibraryV11TransferService.create({ host });
		this.#sessions = new SoundscaperDesktopProjectLibraryV11MainSessionService(
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

	static async start(value: unknown): Promise<SoundscaperDesktopProjectLibraryV11Main> {
		const options = validateStartOptions(value);
		const paths = createSoundscaperDesktopProjectLibraryV11Paths(options.appDataPath);
		await createPrivateLibrary(paths);
		const database = new DatabaseSync(paths.databasePath, {
			allowExtension: false,
			enableDoubleQuotedStringLiterals: false,
			enableForeignKeyConstraints: true,
			timeout: 50,
		});
		let catalog: SoundscaperDesktopProjectLibraryV11Catalog | null = null;
		let lease: SoundscaperDesktopProjectLibraryV11Lease | null = null;
		try {
			await chmod(paths.databasePath, 0o600);
			initializeSoundscaperDesktopProjectLibraryV11Database(database);
			const leaseTtlMs = options.qualification?.leaseTtlMs ?? LEASE_TTL_MS;
			catalog = SoundscaperDesktopProjectLibraryV11Catalog.create({
				database,
				owner: options.owner,
				...(options.qualification?.checkpoint ? { checkpoint: options.qualification.checkpoint } : {}),
			});
			catalog.acceptHandshake(options.handshake);
			const host = SoundscaperDesktopProjectLibraryV11PublicationHost.create({
				database,
				appDataPath: options.appDataPath,
				...(options.qualification?.checkpoint ? { checkpoint: options.qualification.checkpoint } : {}),
			});
			host.acceptHandshake(options.handshake);
			// A crashed owner leaves its lease unexpired, so wait it out rather than
			// failing startup before any window exists.
			const readyCatalog = catalog;
			lease = await acquireProjectLibraryV10LeaseWithWait(
				() => readyCatalog.acquireLease({ ttlMs: leaseTtlMs }),
				{ waitMs: leaseTtlMs + 1_000 },
			);
			const recovery = await recoverPending(database, catalog, host, lease);
			const lifecycle = SoundscaperDesktopProjectLibraryV11LifecycleHost.create({
				catalog,
				host,
				lease,
			});
			return new SoundscaperDesktopProjectLibraryV11Main(
				paths,
				database,
				catalog,
				host,
				lifecycle,
				lease,
				options.owner,
				Object.freeze({
					fencingToken: lease.fencingToken,
					tookOverStaleLease: lease.tookOverStaleLease,
					recovery,
				}),
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

	snapshot(): Readonly<SoundscaperDesktopProjectLibraryV11MainSnapshot> {
		return Object.freeze({
			closed: this.#closed,
			fenced: this.#fenced !== null,
			owner: this.#owner,
			activeSessions: this.#sessions.activeSessions,
			activePublication: this.#sessions.activePublication,
			writer: this.#writer,
		});
	}

	openSession(value: unknown): SoundscaperDesktopProjectLibraryV11MainSession {
		return this.#sessions.openSession(value);
	}

	persistNativePluginState(bytes: unknown): Readonly<SoundscaperNativePluginStateBodyDescriptor> {
		this.#assertWritable();
		return this.#pluginStates.put(bytes);
	}

	readNativePluginState(bodyId: unknown): Readonly<SoundscaperNativePluginStateBodyRecord> | null {
		this.#assertWritable();
		return this.#pluginStates.read(bodyId);
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
				this.#fenced = new Error('Soundscaper V11 main lost its writer lease before shutdown');
			}
		} catch (error) { failures.push(error); }
		try { this.#database.close(); } catch (error) { failures.push(error); }
		throwFailures(failures);
	}

	#assertWritable(): void {
		if (this.#closed) throw new Error('Soundscaper V11 main is closed.');
		if (this.#fenced !== null) throw new Error('Soundscaper V11 main lost its writer lease.');
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
	catalog: SoundscaperDesktopProjectLibraryV11Catalog,
	host: SoundscaperDesktopProjectLibraryV11PublicationHost,
	lease: SoundscaperDesktopProjectLibraryV11Lease,
): Promise<Readonly<SoundscaperDesktopProjectLibraryV11Recovery>> {
	const metadataPending = Boolean(database.prepare(`
		SELECT 1 AS pending FROM metadata_journal
		WHERE state IN ('prepared', 'committed') LIMIT 1
	`).get());
	const publicationPending = Boolean(database.prepare(`
		SELECT 1 AS pending FROM publication_journal
		WHERE state IN ('prepared', 'materialized', 'committed') LIMIT 1
	`).get());
	if (metadataPending && publicationPending) {
		throw new Error('Soundscaper V11 database has conflicting metadata and body recovery journals');
	}
	if (publicationPending) {
		// The publication journal is finished here, so this is the only place that
		// can say it happened. Discarding the outcome reported the restart as clean
		// and made a recovery the packaged lease matrix asks for unprovable. The
		// journal does not record the metadata revision it superseded, so only the
		// revision it published is known.
		const publication = await host.recover({ lease });
		return Object.freeze({
			outcome: publication.outcome,
			previousRevision: null,
			publishedRevision: publication.metadataRevision,
		});
	}
	if (metadataPending) return catalog.recoverMetadata({ lease });
	return Object.freeze({ outcome: 'clean' as const, previousRevision: null, publishedRevision: null });
}

function validateStartOptions(value: unknown): Readonly<StartOptions> {
	const record = snapshotClosedRecord(value, START_FIELDS, 'Soundscaper V11 main options');
	if (typeof record.appDataPath !== 'string') {
		throw new TypeError('Soundscaper V11 main appDataPath must be a string');
	}
	return Object.freeze({
		appDataPath: record.appDataPath,
		owner: validateSoundscaperDesktopProjectLibraryV11Owner(record.owner),
		handshake: validateSoundscaperDesktopProjectLibraryV11Handshake(record.handshake),
		qualification: validateQualification(record.qualification),
	});
}

function validateQualification(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryV11Qualification> | null {
	if (value === null) return null;
	const record = snapshotClosedRecord(value, QUALIFICATION_FIELDS, 'Soundscaper V11 qualification');
	if (record.checkpoint !== null && typeof record.checkpoint !== 'function') {
		throw new TypeError('Soundscaper V11 qualification checkpoint must be a function or null');
	}
	return Object.freeze({
		leaseTtlMs: lowerOnlyMilliseconds(record.leaseTtlMs, LEASE_TTL_MS, 'lease TTL'),
		renewIntervalMs: lowerOnlyMilliseconds(record.renewIntervalMs, RENEW_INTERVAL_MS, 'lease renewal interval'),
		checkpoint: record.checkpoint as SoundscaperDesktopProjectLibraryV11Qualification['checkpoint'],
	});
}

/**
 * A qualification run may only tighten a lease timing. Allowing a longer TTL
 * would let the matrix report a fence the shipped product does not enforce.
 */
function lowerOnlyMilliseconds(value: unknown, ceiling: number, name: string): number {
	return admitLowerOnly(value, {
		ceiling,
		floor: 1,
		absent: 'refuse',
		refuse: () => new RangeError(
			`Soundscaper V11 qualification ${name} must be an integer from 1 through ${ceiling} milliseconds`,
		),
	});
}

async function createPrivateLibrary(
	paths: Readonly<SoundscaperDesktopProjectLibraryV11Paths>,
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
	throw new AggregateError(failures, 'Soundscaper V11 main shutdown failed');
}
