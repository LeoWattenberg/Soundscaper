/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The transfer page opens exactly the two fresh 1.0 stores. Pre-release store
 * names are intentionally absent: the baseline must not enumerate, open,
 * migrate, mutate, or delete them. Each entry is keyed by the complete project
 * identity, because both families use schema version 1.
 *
 * The generic store is opened under the product's exact database, OPFS, worker,
 * and lock names. This keeps archive media beside the document its editor opens
 * without importing either product bootstrap into the transfer chunk.
 */

import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	type ProjectSchemaFamily,
} from '../editor/project-schema-identity.ts';

/** The options every store is opened with; a transfer never invents storage. */
export interface TransferStoreOpenOptions {
	/** Never true here: a memory store would offer projects that do not exist. */
	readonly memoryFallback: false;
}

/** The four names that make one product family's baseline storage its own. */
export interface TransferStoreProfileNames {
	readonly databaseName: string;
	readonly opfsDirectoryName: string;
	readonly opfsWorkerName: string;
	readonly projectLockPrefix: string;
}

export interface TransferStoreBaseline {
	/** Stable identifier, used in the page's own reporting and in selection keys. */
	readonly id: string;
	readonly label: string;
	/** The database this family keeps its baseline projects in, for discovery. */
	readonly databaseName: string;
	/** The product family this isolated store owns. */
	readonly schemaFamily: ProjectSchemaFamily;
	/** The project schema its editor writes. */
	readonly schemaVersion: number;
	/** Pinned against the product's real storage profile by the enumeration test. */
	readonly profileNames: TransferStoreProfileNames;
	open(options: TransferStoreOpenOptions): Promise<unknown>;
}

function baseline(
	product: ProjectSchemaFamily,
): TransferStoreBaseline {
	const name = product === 'framescaper' ? 'Framescaper' : 'Soundscaper';
	const schemaVersion = PROJECT_SCHEMA_VERSION;
	const profileNames: TransferStoreProfileNames = Object.freeze({
		databaseName: `kw-media-${product}-editor-v${schemaVersion}`,
		opfsDirectoryName: `${product}-editor-v${schemaVersion}-sources`,
		opfsWorkerName: `${product}-editor-v${schemaVersion}-opfs-storage`,
		projectLockPrefix: `kw-media-${product}-editor-v${schemaVersion}-lock:`,
	});
	return Object.freeze({
		id: `${product}-v${schemaVersion}`,
		label: `${name} V${schemaVersion} project storage`,
		databaseName: profileNames.databaseName,
		schemaFamily: product,
		schemaVersion,
		profileNames,
		open: (options: TransferStoreOpenOptions) => openProfiledProjectStore(profileNames, options),
	});
}

/** Open one family's baseline database through the generic store. */
async function openProfiledProjectStore(
	names: TransferStoreProfileNames,
	options: TransferStoreOpenOptions,
): Promise<unknown> {
	const [storage, profiles] = await Promise.all([
		import('../editor/storage.js'),
		import('../editor/storage/project-storage-profile.ts'),
	]);
	return storage.createProjectStore({
		...options,
		projectStorageProfile: profiles.createEditorProjectStorageProfile({ ...names }),
	});
}

/** Both independent 1.0 stores. Neither family shadows the other. */
export const TRANSFER_STORE_BASELINES: readonly TransferStoreBaseline[] = Object.freeze([
	baseline(FRAMESCAPER_PROJECT_SCHEMA_FAMILY),
	baseline(SOUNDSCAPER_PROJECT_SCHEMA_FAMILY),
]);

/**
 * The databases that exist on this device, or `null` when the browser will not
 * say.
 *
 * `indexedDB.databases()` avoids opening either baseline merely to discover it.
 * Chromium and WebKit implement it; Firefox uses the probe below.
 *
 * Every failure answers `null` rather than an empty set: "I cannot tell" falls
 * through to the non-creating probe below.
 */
export async function discoverTransferStoreDatabases(
	factory: unknown,
): Promise<ReadonlySet<string> | null> {
	const databases = (factory as { databases?: unknown } | null)?.databases;
	if (typeof databases !== 'function') return null;
	try {
		const listed = await databases.call(factory);
		if (!Array.isArray(listed)) return null;
		const names = new Set<string>();
		for (const entry of listed) {
			const name = (entry as { name?: unknown } | null)?.name;
			if (typeof name === 'string' && name) names.add(name);
		}
		return names;
	} catch {
		return null;
	}
}


/**
 * The same question, asked one database at a time, without creating any.
 *
 * This is the Firefox path. `indexedDB.open(name)` otherwise creates a database
 * as a side effect, so an aborted `upgradeneeded` transaction is used as the
 * non-existent answer without leaving empty baseline stores behind.
 *
 * IndexedDB does have a way to ask, once you accept that the answer arrives
 * inside the creation itself: `open()` with no version fires `upgradeneeded`
 * exactly when the database did not exist (an existing one is opened at its own
 * version and no upgrade runs), and aborting that version-change transaction
 * discards the database the request created. So `upgradeneeded` *is* the "not
 * there" answer, and the abort is what stops the asking from being a write.
 *
 * Nothing here calls `deleteDatabase`; retired names are not even candidates.
 *
 * A probe that throws answers `null` for the whole set, for the same reason as
 * above: a page that cannot tell must open everything rather than hide work.
 */
export async function probeTransferStoreDatabases(
	factory: unknown,
	baselines: readonly TransferStoreBaseline[] = TRANSFER_STORE_BASELINES,
): Promise<ReadonlySet<string> | null> {
	const open = (factory as { open?: unknown } | null)?.open;
	if (typeof open !== 'function') return null;
	const present = new Set<string>();
	try {
		await Promise.all(baselines.map(async (entry) => {
			const existed = await probeOneTransferStoreDatabase(
				open as TransferDatabaseOpen,
				factory,
				entry.databaseName,
			);
			if (existed) present.add(entry.databaseName);
		}));
	} catch {
		return null;
	}
	return present;
}

/** The part of `IDBOpenDBRequest` this probe needs, and nothing else. */
interface TransferDatabaseOpenRequest {
	onupgradeneeded: ((event: unknown) => void) | null;
	onsuccess: ((event: unknown) => void) | null;
	onerror: ((event: unknown) => void) | null;
	onblocked?: ((event: unknown) => void) | null;
	readonly error?: unknown;
	readonly result?: { close?: () => void } | null;
	readonly transaction?: { abort?: () => void } | null;
}

type TransferDatabaseOpen = (name: string) => TransferDatabaseOpenRequest;

function probeOneTransferStoreDatabase(
	open: TransferDatabaseOpen,
	factory: unknown,
	name: string,
): Promise<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		let request: TransferDatabaseOpenRequest;
		try {
			request = open.call(factory, name);
		} catch (error) {
			reject(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		let existed = true;
		request.onupgradeneeded = () => {
			// The database was not there: this request is what created it. Abort
			// the version-change transaction so the creation is rolled back, and
			// let the request fail - that failure is this probe's answer.
			existed = false;
			try {
				request.transaction?.abort?.();
			} catch {
				// An engine that will not abort leaves an empty database, which is
				// the cost the caller already paid before this probe existed.
			}
		};
		request.onsuccess = () => {
			try {
				request.result?.close?.();
			} catch {
				// A connection that will not close still answered the question.
			}
			resolve(existed);
		};
		request.onerror = () => {
			if (!existed) {
				resolve(false);
				return;
			}
			const error = request.error;
			reject(error instanceof Error ? error : new Error(`Could not probe ${name}.`));
		};
		request.onblocked = () => {
			// Another connection is mid-upgrade. It exists, then.
			resolve(true);
		};
	});
}

/**
 * The baseline stores worth opening on this device.
 *
 * A baseline whose database is absent holds nothing by definition, so listing
 * skips it rather than creating an empty database.
 *
 * An arriving archive still opens its own family home on demand because that is
 * the database its editor will use (`transfer-store-federation.ts`).
 */
export function transferStoreBaselinesPresent(
	present: ReadonlySet<string> | null,
	baselines: readonly TransferStoreBaseline[] = TRANSFER_STORE_BASELINES,
): readonly TransferStoreBaseline[] {
	if (!present) return baselines;
	return Object.freeze(baselines.filter((entry) => present.has(entry.databaseName)));
}
