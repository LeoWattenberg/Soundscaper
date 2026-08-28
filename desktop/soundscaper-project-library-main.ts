/* SPDX-License-Identifier: AGPL-3.0-only */

import { chmod, mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import { admitLowerOnly } from '../src/common/editor/lower-only-seam.ts';
import {
	SoundscaperDesktopProjectLibraryCatalog,
	type SoundscaperDesktopProjectLibraryLease,
	type SoundscaperDesktopProjectLibraryRecovery,
} from './soundscaper-project-library-catalog.ts';
import {
	createSoundscaperDesktopProjectLibraryPaths,
	validateSoundscaperDesktopProjectLibraryHandshake,
	validateSoundscaperDesktopProjectLibraryOwner,
	type SoundscaperDesktopProjectLibraryHandshake,
	type SoundscaperDesktopProjectLibraryOwner,
	type SoundscaperDesktopProjectLibraryPaths,
} from './soundscaper-project-library-contract.ts';
import {
	initializeSoundscaperDesktopProjectLibraryDatabase,
} from './soundscaper-project-library-database.ts';
import {
	SoundscaperDesktopProjectLibraryMainSessionService,
	type SoundscaperDesktopProjectLibraryMainSession,
} from './soundscaper-project-library-main-session.ts';
import {
	SoundscaperDesktopProjectLibraryLifecycleHost,
} from './soundscaper-project-library-lifecycle-host.ts';
import {
	SoundscaperDesktopProjectLibraryPublicationHost,
} from './soundscaper-project-library-publication-host.ts';
import {
	type SoundscaperDesktopProjectLibraryPublicationCheckpoint,
} from './soundscaper-project-library-publication-contract.ts';
import {
	SoundscaperDesktopProjectLibraryTransferService,
} from './soundscaper-project-library-transfer-service.ts';
import {
	acquireSoundscaperDesktopProjectLibraryLeaseWithWait,
} from './soundscaper-project-library-lease-wait.ts';
import {
	SoundscaperNativePluginStateStore,
	type SoundscaperNativePluginStateBodyDescriptor,
	type SoundscaperNativePluginStateBodyRecord,
} from './soundscaper-native-plugin-state-store.ts';

const START_FIELDS = ['appDataPath', 'owner', 'handshake', 'qualification'] as const;
const QUALIFICATION_FIELDS = ['leaseTtlMs', 'renewIntervalMs', 'checkpoint'] as const;
const LEASE_TTL_MS = 30_000;
const RENEW_INTERVAL_MS = 10_000;

export interface SoundscaperDesktopProjectLibraryMainWriter {
	readonly fencingToken: number;
	readonly tookOverStaleLease: boolean;
	readonly recovery: Readonly<SoundscaperDesktopProjectLibraryRecovery>;
}

export interface SoundscaperDesktopProjectLibraryMainSnapshot {
	readonly closed: boolean;
	readonly fenced: boolean;
	readonly owner: Readonly<SoundscaperDesktopProjectLibraryOwner>;
	readonly activeSessions: number;
	readonly activePublication: boolean;
	readonly writer: Readonly<SoundscaperDesktopProjectLibraryMainWriter>;
}

/**
 * Lease timings and journal checkpoints the packaged lease matrix needs to
 * observe concurrency within a bounded run. Both timings are lower-only, so a
 * qualification run can only tighten the fence it is measuring, never relax it,
 * and production passes null.
 */
export interface SoundscaperDesktopProjectLibraryQualification {
	readonly leaseTtlMs: number;
	readonly renewIntervalMs: number;
	readonly checkpoint: ((phase: SoundscaperDesktopProjectLibraryPublicationCheckpoint) => void) | null;
}

interface StartOptions {
	readonly appDataPath: string;
	readonly owner: SoundscaperDesktopProjectLibraryOwner;
	readonly handshake: SoundscaperDesktopProjectLibraryHandshake;
	readonly qualification: Readonly<SoundscaperDesktopProjectLibraryQualification> | null;
}

/** Product-owned baseline composition selected only by the packaged Soundscaper profile. */
export class SoundscaperDesktopProjectLibraryMain {
	readonly localHandshake: Readonly<SoundscaperDesktopProjectLibraryHandshake>;
	readonly #catalog: SoundscaperDesktopProjectLibraryCatalog;
	readonly #database: DatabaseSync;
	readonly #host: SoundscaperDesktopProjectLibraryPublicationHost;
	readonly #lifecycle: SoundscaperDesktopProjectLibraryLifecycleHost;
	readonly #owner: Readonly<SoundscaperDesktopProjectLibraryOwner>;
	readonly #pluginStates: SoundscaperNativePluginStateStore;
	readonly #paths: Readonly<SoundscaperDesktopProjectLibraryPaths>;
	readonly #sessions: SoundscaperDesktopProjectLibraryMainSessionService;
	#closePromise: Promise<void> | null = null;
	#closed = false;
	#fencePromise: Promise<void> | null = null;
	#fenced: unknown = null;
	#lease: SoundscaperDesktopProjectLibraryLease;
	#renewTimer: ReturnType<typeof setInterval> | null = null;
	readonly #writer: Readonly<SoundscaperDesktopProjectLibraryMainWriter>;
	readonly #leaseTtlMs: number;

	private constructor(
		paths: Readonly<SoundscaperDesktopProjectLibraryPaths>,
		database: DatabaseSync,
		catalog: SoundscaperDesktopProjectLibraryCatalog,
		host: SoundscaperDesktopProjectLibraryPublicationHost,
		lifecycle: SoundscaperDesktopProjectLibraryLifecycleHost,
		lease: SoundscaperDesktopProjectLibraryLease,
		owner: Readonly<SoundscaperDesktopProjectLibraryOwner>,
		writer: Readonly<SoundscaperDesktopProjectLibraryMainWriter>,
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
		const transfer = SoundscaperDesktopProjectLibraryTransferService.create({ host });
		this.#sessions = new SoundscaperDesktopProjectLibraryMainSessionService(
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

	static async start(value: unknown): Promise<SoundscaperDesktopProjectLibraryMain> {
		const options = validateStartOptions(value);
		const paths = createSoundscaperDesktopProjectLibraryPaths(options.appDataPath);
		await createPrivateLibrary(paths);
		const database = new DatabaseSync(paths.databasePath, {
			allowExtension: false,
			enableDoubleQuotedStringLiterals: false,
			enableForeignKeyConstraints: true,
			timeout: 50,
		});
		let catalog: SoundscaperDesktopProjectLibraryCatalog | null = null;
		let lease: SoundscaperDesktopProjectLibraryLease | null = null;
		try {
			await chmod(paths.databasePath, 0o600);
			initializeSoundscaperDesktopProjectLibraryDatabase(database);
			const leaseTtlMs = options.qualification?.leaseTtlMs ?? LEASE_TTL_MS;
			catalog = SoundscaperDesktopProjectLibraryCatalog.create({
				database,
				owner: options.owner,
				...(options.qualification?.checkpoint ? { checkpoint: options.qualification.checkpoint } : {}),
			});
			catalog.acceptHandshake(options.handshake);
			const host = SoundscaperDesktopProjectLibraryPublicationHost.create({
				database,
				appDataPath: options.appDataPath,
				...(options.qualification?.checkpoint ? { checkpoint: options.qualification.checkpoint } : {}),
			});
			host.acceptHandshake(options.handshake);
			// A crashed owner leaves its lease unexpired, so wait it out rather than
			// failing startup before any window exists.
			const readyCatalog = catalog;
			lease = await acquireSoundscaperDesktopProjectLibraryLeaseWithWait(
				() => readyCatalog.acquireLease({ ttlMs: leaseTtlMs }),
				{ waitMs: leaseTtlMs + 1_000 },
			);
			const recovery = await recoverPending(database, catalog, host, lease);
			const lifecycle = SoundscaperDesktopProjectLibraryLifecycleHost.create({
				catalog,
				host,
				lease,
			});
			return new SoundscaperDesktopProjectLibraryMain(
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

	snapshot(): Readonly<SoundscaperDesktopProjectLibraryMainSnapshot> {
		return Object.freeze({
			closed: this.#closed,
			fenced: this.#fenced !== null,
			owner: this.#owner,
			activeSessions: this.#sessions.activeSessions,
			activePublication: this.#sessions.activePublication,
			writer: this.#writer,
		});
	}

	openSession(value: unknown): SoundscaperDesktopProjectLibraryMainSession {
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
				this.#fenced = new Error('Soundscaper desktop baseline main lost its writer lease before shutdown');
			}
		} catch (error) { failures.push(error); }
		try { this.#database.close(); } catch (error) { failures.push(error); }
		throwFailures(failures);
	}

	#assertWritable(): void {
		if (this.#closed) throw new Error('Soundscaper desktop baseline main is closed.');
		if (this.#fenced !== null) throw new Error('Soundscaper desktop baseline main lost its writer lease.');
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
	catalog: SoundscaperDesktopProjectLibraryCatalog,
	host: SoundscaperDesktopProjectLibraryPublicationHost,
	lease: SoundscaperDesktopProjectLibraryLease,
): Promise<Readonly<SoundscaperDesktopProjectLibraryRecovery>> {
	const metadataPending = Boolean(database.prepare(`
		SELECT 1 AS pending FROM metadata_journal
		WHERE state IN ('prepared', 'committed') LIMIT 1
	`).get());
	const publicationPending = Boolean(database.prepare(`
		SELECT 1 AS pending FROM publication_journal
		WHERE state IN ('prepared', 'materialized', 'committed') LIMIT 1
	`).get());
	if (metadataPending && publicationPending) {
		throw new Error('Soundscaper desktop baseline database has conflicting metadata and body recovery journals');
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
	const record = snapshotClosedRecord(value, START_FIELDS, 'Soundscaper desktop baseline main options');
	if (typeof record.appDataPath !== 'string') {
		throw new TypeError('Soundscaper desktop baseline main appDataPath must be a string');
	}
	return Object.freeze({
		appDataPath: record.appDataPath,
		owner: validateSoundscaperDesktopProjectLibraryOwner(record.owner),
		handshake: validateSoundscaperDesktopProjectLibraryHandshake(record.handshake),
		qualification: validateQualification(record.qualification),
	});
}

function validateQualification(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryQualification> | null {
	if (value === null) return null;
	const record = snapshotClosedRecord(value, QUALIFICATION_FIELDS, 'Soundscaper desktop baseline qualification');
	if (record.checkpoint !== null && typeof record.checkpoint !== 'function') {
		throw new TypeError('Soundscaper desktop baseline qualification checkpoint must be a function or null');
	}
	return Object.freeze({
		leaseTtlMs: lowerOnlyMilliseconds(record.leaseTtlMs, LEASE_TTL_MS, 'lease TTL'),
		renewIntervalMs: lowerOnlyMilliseconds(record.renewIntervalMs, RENEW_INTERVAL_MS, 'lease renewal interval'),
		checkpoint: record.checkpoint as SoundscaperDesktopProjectLibraryQualification['checkpoint'],
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
			`Soundscaper desktop baseline qualification ${name} must be an integer from 1 through ${ceiling} milliseconds`,
		),
	});
}

async function createPrivateLibrary(
	paths: Readonly<SoundscaperDesktopProjectLibraryPaths>,
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
	throw new AggregateError(failures, 'Soundscaper desktop baseline main shutdown failed');
}
