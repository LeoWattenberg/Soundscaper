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

const START_FIELDS = ['appDataPath', 'owner', 'handshake', 'onLeaseLost', 'testControl'] as const;
const TEST_CONTROL_FIELDS = ['leaseTtlMs', 'renewIntervalMs', 'checkpoint'] as const;
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
 * Lease timings and journal checkpoints used by bounded crash/concurrency
 * tests. Both timings are lower-only, so a test can only tighten the fence it
 * is measuring, never relax it, and production passes null.
 */
export interface SoundscaperDesktopProjectLibraryTestControl {
	readonly leaseTtlMs: number;
	readonly renewIntervalMs: number;
	readonly checkpoint: ((phase: SoundscaperDesktopProjectLibraryPublicationCheckpoint) => void) | null;
}

interface StartOptions {
	readonly appDataPath: string;
	readonly owner: SoundscaperDesktopProjectLibraryOwner;
	readonly handshake: SoundscaperDesktopProjectLibraryHandshake;
	readonly onLeaseLost: (error: unknown) => void;
	readonly testControl: Readonly<SoundscaperDesktopProjectLibraryTestControl> | null;
}

/** Product-owned baseline composition selected only by the packaged Soundscaper profile. */
export class SoundscaperDesktopProjectLibraryMain {
	readonly localHandshake: Readonly<SoundscaperDesktopProjectLibraryHandshake>;
	readonly #catalog: SoundscaperDesktopProjectLibraryCatalog;
	readonly #database: DatabaseSync;
	readonly #host: SoundscaperDesktopProjectLibraryPublicationHost;
	readonly #lifecycle: SoundscaperDesktopProjectLibraryLifecycleHost;
	readonly #owner: Readonly<SoundscaperDesktopProjectLibraryOwner>;
	readonly #onLeaseLost: (error: unknown) => void;
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
		onLeaseLost: (error: unknown) => void,
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
		this.#onLeaseLost = onLeaseLost;
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
		const leaseTtlMs = options.testControl?.leaseTtlMs ?? LEASE_TTL_MS;
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
			// A live holder can renew while another process performs this idempotent
			// schema check. Keep that SQLite write-lock race inside the same bounded
			// contention window as acquisition so it cannot bypass the lease refusal.
			await acquireSoundscaperDesktopProjectLibraryLeaseWithWait(
				() => initializeSoundscaperDesktopProjectLibraryDatabase(database),
				{ waitMs: leaseTtlMs + 1_000 },
			);
			catalog = SoundscaperDesktopProjectLibraryCatalog.create({
				database,
				owner: options.owner,
				...(options.testControl?.checkpoint ? { checkpoint: options.testControl.checkpoint } : {}),
			});
			catalog.acceptHandshake(options.handshake);
			const host = SoundscaperDesktopProjectLibraryPublicationHost.create({
				database,
				appDataPath: options.appDataPath,
				...(options.testControl?.checkpoint ? { checkpoint: options.testControl.checkpoint } : {}),
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
			await host.reclaimStorage().catch(() => undefined);
			// Reclaim opaque state only before a renderer can open a session. A live
			// undo stack may still own a newly persisted body not present in a durable
			// project revision, so publication-time reclamation would be unsafe.
			try {
				new SoundscaperNativePluginStateStore(database)
					.reclaimUnreferencedProjectStateBodies();
			} catch { /* Reclamation is best-effort and leaves every body intact on failure. */ }
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
				options.onLeaseLost,
				Object.freeze({
					fencingToken: lease.fencingToken,
					tookOverStaleLease: lease.tookOverStaleLease,
					recovery,
				}),
				options.testControl?.renewIntervalMs ?? RENEW_INTERVAL_MS,
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
			if (this.#renewTimer) clearInterval(this.#renewTimer);
			this.#renewTimer = null;
			this.#fencePromise = this.#sessions.fence(error);
			try { this.#onLeaseLost(error); } catch { /* The fence remains authoritative. */ }
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
		// and made the recovery exercised by the packaged smoke unobservable. The
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
	if (typeof record.onLeaseLost !== 'function') {
		throw new TypeError('Soundscaper desktop baseline main onLeaseLost must be a function');
	}
	return Object.freeze({
		appDataPath: record.appDataPath,
		owner: validateSoundscaperDesktopProjectLibraryOwner(record.owner),
		handshake: validateSoundscaperDesktopProjectLibraryHandshake(record.handshake),
		onLeaseLost: record.onLeaseLost as (error: unknown) => void,
		testControl: validateTestControl(record.testControl),
	});
}

function validateTestControl(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryTestControl> | null {
	if (value === null) return null;
	const record = snapshotClosedRecord(value, TEST_CONTROL_FIELDS, 'Soundscaper desktop baseline test control');
	if (record.checkpoint !== null && typeof record.checkpoint !== 'function') {
		throw new TypeError('Soundscaper desktop baseline test-control checkpoint must be a function or null');
	}
	return Object.freeze({
		leaseTtlMs: lowerOnlyMilliseconds(record.leaseTtlMs, LEASE_TTL_MS, 'lease TTL'),
		renewIntervalMs: lowerOnlyMilliseconds(record.renewIntervalMs, RENEW_INTERVAL_MS, 'lease renewal interval'),
		checkpoint: record.checkpoint as SoundscaperDesktopProjectLibraryTestControl['checkpoint'],
	});
}

/**
 * A test may only tighten a lease timing. Allowing a longer TTL would exercise
 * a fence the shipped product does not enforce.
 */
function lowerOnlyMilliseconds(value: unknown, ceiling: number, name: string): number {
	return admitLowerOnly(value, {
		ceiling,
		floor: 1,
		absent: 'refuse',
		refuse: () => new RangeError(
			`Soundscaper desktop baseline test-control ${name} must be an integer from 1 through ${ceiling} milliseconds`,
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
