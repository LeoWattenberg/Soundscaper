/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Every project store a visitor's work can actually be sitting in.
 *
 * The transfer page used to open exactly one database - the shared
 * `kw-media-audio-editor` that `createProjectStore()` opens with no storage
 * profile - and then offer whatever it found as "your projects". That is not
 * where most of this origin's work lives. Both products keep
 * generation-isolated storage: every Framescaper generation from V18 to V32 has
 * its own IndexedDB database, its own OPFS directory and its own lock prefix
 * (`src/framescaper/editor-project-storage-profile-v*.ts`), and Soundscaper's
 * V21/V23/V29/V30 do the same. A visitor on soundscaper.org who asked to move
 * their Framescaper projects was shown the one database that could not contain
 * them.
 *
 * ## Which generations are listed
 *
 * The schema numbers come from `src/common/editor/project-schema-version.ts`,
 * the one vocabulary that already names them, rather than from a fresh literal
 * list that would rot the first time a generation is added. V18 is the single
 * exception: it predates the named constants and the vocabulary itself spells it
 * as a bare `18` (see `isFramescaperSequenceProjectSchema`), so it is spelled
 * once here with the same caveat. `tests/project-transfer-store-enumeration.test.ts`
 * fails when an `editor-project-store-v*.ts` module appears under a product
 * directory without an entry here.
 *
 * ## How each one is opened, and why not through its product constructor
 *
 * Each generation's own constructor (`createFramescaperProjectStoreV32()` and
 * its siblings) authenticates an exact runtime profile and installs that
 * generation's exact-write project repository. Reaching for one from here is the
 * obvious move, and it cannot be done: **the transfer page and the product
 * editors are chunks of one build**, so a dynamic import of a product store
 * module makes every module underneath it shared between the transfer graph and
 * that product's startup graph, and rolldown answers by splitting the product's
 * chunks apart. Measured, with the fifteen constructors imported: the Soundscaper
 * product-ready startup graph went from 75 requests to 76 (its budget is 75), and
 * the Framescaper one from 76 to 110 (budget 80). `npm run build` fails on both.
 * A transfer page cannot be paid for by shattering the editors' load.
 *
 * So a generation is opened the way the generic store opens any profile: with a
 * storage profile built here from that generation's four names. The names are
 * uniform across all fifteen generations - `kw-media-<product>-editor-v<n>`,
 * `<product>-editor-v<n>-sources`, `<product>-editor-v<n>-opfs-storage` and
 * `kw-media-<product>-editor-v<n>-lock:` - so they are derived rather than
 * copied, and the enumeration test compares all four against each generation's
 * real storage profile so that a generation which ever breaks the pattern fails
 * there instead of silently dropping out of the transfer.
 *
 * What that gives up is the generation's project repository, which is a
 * *write* custody wrapper: exact-schema validation and attachment fencing on
 * create, save and delete. The generic repository underneath it reads and writes
 * the stored document as stored, which is what both halves of a transfer need -
 * the archive carries what the generation wrote, and an arriving archive is
 * written back as the generation will read it. The custody the transfer keeps in
 * its place is an exact schema match: a store here is only ever the home of the
 * one schema generation it was derived from, so a document is admitted into it
 * on the same field that generation's own validator would check first
 * (`transfer-archive-runtime.ts`).
 *
 * What deriving the profile keeps is the part that matters for the media: the
 * same database, the same OPFS directory. Opening these databases under the
 * *default* names is the thing that would produce archives whose sources are
 * silently missing - and, on the receiving side, imports whose media lands where
 * the editor will never look for it.
 */

import {
	AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION,
	FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION,
	FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION,
	FRAMESCAPER_PROJECT_V22_SCHEMA_VERSION,
	FRAMESCAPER_PROJECT_V24_SCHEMA_VERSION,
	FRAMESCAPER_PROJECT_V25_SCHEMA_VERSION,
	FRAMESCAPER_PROJECT_V26_SCHEMA_VERSION,
	FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION,
	FRAMESCAPER_PROJECT_V28_SCHEMA_VERSION,
	FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION,
	FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION,
} from '../editor/project-schema-version.ts';

/**
 * V18 has no named constant in the schema vocabulary.
 *
 * The vocabulary spells it as a literal too - `isFramescaperSequenceProjectSchema`
 * begins `value === 18` - so this is that same literal, spelled once, beside the
 * generation it opens rather than buried in a table.
 */
const FRAMESCAPER_PROJECT_V18_SCHEMA_VERSION = 18;

/**
 * The one store that is not a generation, and the schema its editor writes.
 *
 * `createProjectStore()` with no storage profile opens `kw-media-audio-editor`,
 * which is what `app.js` composes for an ordinary web session. The document that
 * session writes is the shared V17 audio project - every later revision belongs
 * to a product generation with a database of its own - so V17 is the schema whose
 * home store this is, and the only schema whose document owner
 * (`migrateAudioEditorProject()`) this build can actually reach from here.
 */
export const TRANSFER_SHARED_EDITOR_STORE = Object.freeze({
	id: 'shared-editor-storage',
	label: 'Shared editor storage',
	schemaVersion: AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION,
});

/** The options every store is opened with; a transfer never invents storage. */
export interface TransferStoreOpenOptions {
	/** Never true here: a memory store would offer projects that do not exist. */
	readonly memoryFallback: false;
}

/** The four names that make one generation's storage its own. */
export interface TransferStoreProfileNames {
	readonly databaseName: string;
	readonly opfsDirectoryName: string;
	readonly opfsWorkerName: string;
	readonly projectLockPrefix: string;
}

export interface TransferStoreGeneration {
	/** Stable identifier, used in the page's own reporting and in selection keys. */
	readonly id: string;
	readonly label: string;
	/** The database this generation keeps its projects in, for discovery. */
	readonly databaseName: string;
	/** The project schema its editor writes, from the shared vocabulary. */
	readonly schemaVersion: number;
	/** Pinned against the generation's real storage profile by the enumeration test. */
	readonly profileNames: TransferStoreProfileNames;
	open(options: TransferStoreOpenOptions): Promise<unknown>;
}

function generation(
	product: 'framescaper' | 'soundscaper',
	schemaVersion: number,
): TransferStoreGeneration {
	const name = product === 'framescaper' ? 'Framescaper' : 'Soundscaper';
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
		schemaVersion,
		profileNames,
		open: (options: TransferStoreOpenOptions) => openProfiledProjectStore(profileNames, options),
	});
}

/**
 * Open one generation's database through the generic store, under its own names.
 *
 * Both imports are dynamic and both are already on the transfer page's dynamic
 * side - `transfer-archive-runtime.ts` loads `storage.js` for the shared store,
 * and `storage.js` imports the profile factory - so enumerating fifteen
 * generations adds no chunk to anybody's graph.
 */
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

/**
 * Every generation store, newest first.
 *
 * The order is the listing order and, with it, the order in which a project id
 * held by two generations is resolved: the newest generation holding an id is
 * the copy the visitor's editor actually opens, so it is the copy the transfer
 * offers. See `transfer-store-federation.ts` for what becomes of the older one -
 * it is reported by name, never silently merged into the newer.
 */
export const TRANSFER_STORE_GENERATIONS: readonly TransferStoreGeneration[] = Object.freeze([
	generation('framescaper', FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION),
	generation('framescaper', FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION),
	generation('soundscaper', SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION),
	generation('soundscaper', SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION),
	generation('framescaper', FRAMESCAPER_PROJECT_V28_SCHEMA_VERSION),
	generation('framescaper', FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION),
	generation('framescaper', FRAMESCAPER_PROJECT_V26_SCHEMA_VERSION),
	generation('framescaper', FRAMESCAPER_PROJECT_V25_SCHEMA_VERSION),
	generation('framescaper', FRAMESCAPER_PROJECT_V24_SCHEMA_VERSION),
	generation('soundscaper', SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION),
	generation('framescaper', FRAMESCAPER_PROJECT_V22_SCHEMA_VERSION),
	generation('soundscaper', SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION),
	generation('framescaper', FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION),
	generation('framescaper', FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION),
	generation('framescaper', FRAMESCAPER_PROJECT_V18_SCHEMA_VERSION),
]);

/**
 * The databases that exist on this device, or `null` when the browser will not
 * say.
 *
 * `indexedDB.databases()` is the difference between opening the one or two
 * generations a visitor actually has and opening all fifteen. Chromium and
 * WebKit implement it; **Firefox does not**, and it is the only enumeration
 * IndexedDB offers.
 *
 * Every failure answers `null` rather than an empty set: "I cannot tell" must
 * fall through to the probe below, while "I asked, and there are none" would
 * skip everything.
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
 * This is the Firefox path, and it exists because the alternative was not
 * acceptable. `indexedDB.open(name)` creates the database as a side effect, so a
 * page that opened all fifteen registered generations to find out which ones
 * held anything left fifteen empty databases behind on a visitor who had two -
 * on the *receiving* origin, where the visitor has none at all, it left one per
 * generation on a browser that had never run either editor. They are the same
 * databases each editor would eventually create, they hold nothing, and they are
 * still storage this page created on an origin it was only asked to read.
 *
 * IndexedDB does have a way to ask, once you accept that the answer arrives
 * inside the creation itself: `open()` with no version fires `upgradeneeded`
 * exactly when the database did not exist (an existing one is opened at its own
 * version and no upgrade runs), and aborting that version-change transaction
 * discards the database the request created. So `upgradeneeded` *is* the "not
 * there" answer, and the abort is what stops the asking from being a write.
 *
 * Nothing here deletes a database. An abort that some engine did not honour
 * leaves an empty database - exactly what the old fallback left, so the worst
 * case is the behaviour this replaces - while a `deleteDatabase()` reached by a
 * wrong answer would destroy a visitor's projects. That asymmetry decides it.
 *
 * A probe that throws answers `null` for the whole set, for the same reason as
 * above: a page that cannot tell must open everything rather than hide work.
 */
export async function probeTransferStoreDatabases(
	factory: unknown,
	generations: readonly TransferStoreGeneration[] = TRANSFER_STORE_GENERATIONS,
): Promise<ReadonlySet<string> | null> {
	const open = (factory as { open?: unknown } | null)?.open;
	if (typeof open !== 'function') return null;
	const present = new Set<string>();
	try {
		await Promise.all(generations.map(async (entry) => {
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
 * The generations worth opening on this device.
 *
 * A generation whose database is absent holds nothing by definition, so it is
 * skipped rather than opened - and skipping it is also what keeps the transfer
 * page from creating fifteen empty databases on a device that has two.
 *
 * This is the *listing* question only. An arriving archive still opens its own
 * generation on demand, absent database and all, because that is the database
 * its editor will open to find the project (`transfer-store-federation.ts`).
 */
export function transferStoreGenerationsPresent(
	present: ReadonlySet<string> | null,
	generations: readonly TransferStoreGeneration[] = TRANSFER_STORE_GENERATIONS,
): readonly TransferStoreGeneration[] {
	if (!present) return generations;
	return Object.freeze(generations.filter((entry) => present.has(entry.databaseName)));
}
