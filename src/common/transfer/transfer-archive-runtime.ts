/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Load the archive machinery on demand, never at page load.
 *
 * `.scape` export and import reach a large part of the editor's storage and
 * archive code. A transfer document that imported it eagerly would download all
 * of it to show a page whose first useful state is "here is what you have" -
 * and the visitor may be on the origin whose editor they have never opened. So
 * every heavy dependency arrives through a dynamic import behind a single
 * awaited call, which also keeps the whole graph out of the transfer page's own
 * chunk.
 *
 * Nothing here is imported statically anywhere in `src/common/transfer/`; the
 * page hands the result to `transfer-session.ts`, which only ever sees injected
 * functions.
 */

import {
	createTransferStoreFederation,
	routesTransferArchivesHome,
	transferStoreForProject,
	transferStoreHomeForSchema,
	isTransferStoreFederation,
	type TransferStoreFault,
	type TransferStoreHandle,
	type TransferStoreHome,
	type TransferStoreHomeSource,
} from './transfer-store-federation.ts';
import {
	discoverTransferStoreDatabases,
	probeTransferStoreDatabases,
	transferStoreGenerationsPresent,
	TRANSFER_SHARED_EDITOR_STORE,
	TRANSFER_STORE_GENERATIONS,
	type TransferStoreGeneration,
	type TransferStoreOpenOptions,
} from './transfer-store-generations.ts';
import type { TransferRuntime } from './transfer-session.ts';

export interface TransferStoreSource {
	/** Stable identifier, used in the page's own reporting. */
	readonly id: string;
	readonly label: string;
	readonly store: unknown;
	/** Every store the page enumerated and could open, in listing order. */
	readonly sources: readonly TransferStoreHandle[];
	/** Every store the page knows about and could not open. */
	readonly unreadable: readonly TransferStoreFault[];
	close(): Promise<void>;
}

export async function loadTransferRuntime(): Promise<TransferRuntime> {
	const [archive, bundle, handshake] = await Promise.all([
		import('../editor/scape-project.js'),
		import('./project-transfer-bundle.ts'),
		import('./project-transfer-handshake.ts'),
	]);
	const inspectProject = archive.inspectScapeProject as TransferRuntime['inspectProject'];
	return Object.freeze({
		exportProject: exportFromOwningStore(
			archive.exportScapeProject as TransferRuntime['exportProject'],
		),
		inspectProject: inspectInHomeStore(inspectProject),
		importProject: importIntoHomeStore(
			archive.importScapeProject as TransferRuntime['importProject'],
			inspectProject,
		),
		exportBundle: bundle.exportProjectTransferBundle,
		importBundle: bundle.importProjectTransferBundle,
		sendTransfer: handshake.sendProjectTransfer,
		receiveTransfer: handshake.receiveProjectTransfer,
	});
}

/**
 * Export every project against the store it was actually listed from.
 *
 * `exportProjectTransferBundle()` hands the archive writer the one store it was
 * given, for every project in the run. That is right when there is one store
 * and wrong the moment there is more than one: `exportScapeProject()` reads the
 * project's media and sources *out of the store it is passed*, and each
 * generation keeps its own OPFS directory. Exporting a Framescaper V31 project
 * against the shared editor database does not fail - it produces an archive
 * whose sources are quietly missing, which is the one outcome a transfer must
 * never produce.
 *
 * So the substitution happens here, in the seam that owns the archive writer,
 * rather than by asking the export layer to understand several stores. A store
 * that is not a federation is passed straight through, which is what keeps every
 * injected-store caller and test working unchanged.
 *
 * Exported so the substitution can be exercised on its own: the runtime it is
 * installed into can only be built by importing the real `.scape` exporter.
 */
export function exportFromOwningStore(
	exportProject: TransferRuntime['exportProject'],
): TransferRuntime['exportProject'] {
	return (project, store, options) => {
		const owner = transferStoreForProject(store, project);
		if (owner) return exportProject(project, owner, options);
		if (isTransferStoreFederation(store)) {
			// Fail closed rather than export against the wrong store. Reaching here
			// means the project was not one of the rows the federation listed, so
			// there is no store this archive could honestly be read from.
			const id = (project as { id?: unknown } | null)?.id;
			throw new Error(
				`No enumerated project store listed ${typeof id === 'string' ? id : 'this project'},`
				+ ' so its archive cannot be read from any of them.',
			);
		}
		return exportProject(project, store, options);
	};
}

/**
 * The name a receiving origin uses for an archive it has nowhere to put.
 *
 * Reported rather than thrown away: the record the visitor reads carries this
 * message, and "schema 33 is not a generation this build knows" is something
 * they can act on - by updating the receiving origin - in a way that "imported
 * 4 of 5" is not.
 */
export class TransferArchiveHomeError extends Error {
	readonly schemaVersion: number | null;

	constructor(message: string, schemaVersion: number | null) {
		super(message);
		this.name = 'TransferArchiveHomeError';
		this.schemaVersion = schemaVersion;
	}
}

/**
 * Import every archive into the store its own editor will open, or refuse it.
 *
 * The mirror of `exportFromOwningStore()`, and the same defect in reverse. The
 * receiving page hands the import layer one store, and that store's writes went
 * to the shared `kw-media-audio-editor` database - which no live editor opens
 * for its projects. A visitor was told "imported 5 of 5" and then found their
 * editor empty, because five Framescaper projects had been written into a
 * database Framescaper never reads.
 *
 * A project has a home store, and both directions agree on which one. The sender
 * exports each project from the store that listed it; the receiver imports each
 * archive into the store the visitor's editor will open for that archive's
 * schema generation - creating that generation's database if this origin has
 * never had one, which is exactly what the editor's own first run would do. An
 * archive whose generation no store here claims is refused by name: there is no
 * store it could be written into that anything would read it out of again.
 *
 * The archive is read twice: once with no store at all, to learn which schema it
 * carries, and then again against the home store that answer chose. Both reads
 * are of the archive's envelope - `project.json` and the manifest - never of its
 * media, and the alternative is guessing at a store before knowing what arrived.
 *
 * A store that cannot route - an injected test store, an ordinary single store -
 * is passed straight through unchanged.
 */
export function importIntoHomeStore(
	importProject: TransferRuntime['importProject'],
	inspectProject: TransferRuntime['inspectProject'],
): TransferRuntime['importProject'] {
	return async (input, store, options) => {
		const home = await transferArchiveHome(inspectProject, input, store, options);
		if (!home) return importProject(input, store, options);
		return importProject(input, home.store, homeArchiveOptions(options, home));
	};
}

/**
 * Inspect every archive against the store it would actually be imported into.
 *
 * The import layer takes two decisions off this answer - "a project with this
 * identity is already present" and "this archive opens read-only in this build" -
 * and both are answers *about a store*. Inspecting against the shared database
 * while importing into a generation makes the first one meaningless: it probes a
 * database the project cannot be in.
 */
export function inspectInHomeStore(
	inspectProject: TransferRuntime['inspectProject'],
): TransferRuntime['inspectProject'] {
	return async (input, store, options) => {
		const home = await transferArchiveHome(inspectProject, input, store, options);
		if (!home) return inspectProject(input, store, options);
		return inspectProject(input, home.store, homeArchiveOptions(options, home));
	};
}

async function transferArchiveHome(
	inspectProject: TransferRuntime['inspectProject'],
	input: unknown,
	store: unknown,
	options: Readonly<{ signal?: AbortSignal }>,
): Promise<TransferStoreHome | null> {
	if (!routesTransferArchivesHome(store)) return null;
	const schemaVersion = await transferArchiveSchemaVersion(inspectProject, input, options);
	const home = await transferStoreHomeForSchema(store, schemaVersion);
	if (!home) {
		throw new TransferArchiveHomeError(
			`No project store on this origin holds schema ${schemaVersion} projects, so an archive`
			+ ' of that generation has nowhere to be imported that its editor would find it.',
			schemaVersion,
		);
	}
	return home;
}

/**
 * The schema generation the archive itself declares.
 *
 * Read with no store, so the question costs no database access, and with an
 * owner that stops at the header: a probe that admitted the document would run
 * the whole asset index against a schema it has not chosen a store for yet.
 */
async function transferArchiveSchemaVersion(
	inspectProject: TransferRuntime['inspectProject'],
	input: unknown,
	options: Readonly<{ signal?: AbortSignal }>,
): Promise<number> {
	const probed = await inspectProject(input, null, transferArchiveOptions(options, {
		migrateProject: readTransferArchiveHeader,
	}));
	const schemaVersion = (probed as { schemaVersion?: unknown } | null)?.schemaVersion;
	if (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion)) {
		throw new TransferArchiveHomeError(
			'This .scape archive does not name the project schema it was written from, so no store'
			+ ' on this origin can be chosen for it.',
			null,
		);
	}
	return schemaVersion;
}

/** Stop at the header: `readOnly` is what makes the reader return without indexing. */
function readTransferArchiveHeader(value: unknown): unknown {
	const schemaVersion = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
	return {
		project: value,
		migrated: false,
		fromVersion: typeof schemaVersion === 'number' ? schemaVersion : 0,
		readOnly: true,
		reason: 'transfer-home-probe',
	};
}

/**
 * How the home store's own generation admits an arriving document.
 *
 * The `.scape` layer's default document owner is `migrateAudioEditorProject()`,
 * which is the shared V17 editor's owner and refuses every other generation as
 * `newer-schema` - so with no owner named here, an archive from any generation
 * arrives, is declared read-only and is skipped. That is the second half of the
 * same defect: the shared store was the only store that could be written *and*
 * the only schema that could be read.
 *
 * For the shared store the default owner is exactly right, and is left in place,
 * so a V17 document is still admitted by the rule its editor applies. For a
 * generation the owner lives in that product's chunk and cannot be reached from
 * this page, so the document is admitted as the archive stored it, and the
 * custody that replaces the owner's validation is an exact schema match: the
 * document is written to the generation whose number it carries, or not at all.
 * That is the stance the sending half already takes - it exports what the
 * generation stored, through the generic repository, without migrating it.
 *
 * Nothing else about how the archive is read changes, deliberately: the two
 * halves of one transfer must read and write an archive on the same terms, and
 * `currentProjectSchemaVersion` is left at the default the exporter used.
 */
function homeArchiveOptions<Options extends Readonly<{ signal?: AbortSignal }>>(
	options: Options,
	home: TransferStoreHome,
): Options {
	if (home.documentMigration === 'this-build') return options;
	return transferArchiveOptions(options, {
		migrateProject: admitStoredGeneration(home.schemaVersion),
	});
}

function admitStoredGeneration(schemaVersion: number): (value: unknown) => unknown {
	return (value: unknown) => {
		const stored = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
		if (stored !== schemaVersion) {
			// The header read and this one disagree, so the archive changed under
			// the page. Refusing is the only answer that cannot write a document
			// into a generation that is not its own.
			throw new TransferArchiveHomeError(
				`This .scape archive was read as schema ${schemaVersion} and now carries`
				+ ` ${String(stored)}, so it cannot be admitted to either generation's store.`,
				schemaVersion,
			);
		}
		return {
			project: value,
			migrated: false,
			fromVersion: schemaVersion,
			readOnly: false,
			reason: null,
		};
	};
}

/**
 * Add the transfer's own `.scape` reader options to what the caller passed.
 *
 * The seam types name only what every archive caller passes; the reader accepts
 * the document-owner options as well, and this is the one place that widening
 * happens.
 */
function transferArchiveOptions<Options extends Readonly<{ signal?: AbortSignal }>>(
	options: Options,
	added: Readonly<{ migrateProject: (value: unknown) => unknown }>,
): Options {
	return { ...options, ...added } as Options;
}

/**
 * Open every project store a visitor's projects can be in, as one store.
 *
 * The page used to open exactly one database: `createProjectStore()` with no
 * storage profile, which is `kw-media-audio-editor` and nothing else. Framescaper
 * does not keep projects there - every generation from V18 to V32 has its own
 * database, and Soundscaper's V21/V23/V29/V30 do too - so the transfer offered a
 * visitor the one store that could not hold the work they had come to move.
 *
 * What is opened, and when:
 *
 *   - **The shared editor store, always.** It is the store `app.js` composes
 *     with no profile override, and it is also where every write that is not an
 *     arriving archive goes (see `TransferStoreFederationOptions.writer`), so the
 *     page needs it open whether or not it lists anything.
 *   - **Every generation whose database exists**, discovered through
 *     `indexedDB.databases()` or, where the browser does not implement it, probed
 *     one at a time without creating any (`probeTransferStoreDatabases()`).
 *
 * Eagerly, all of them, rather than lazily per selected project: the first
 * question this page answers is "what do I have", and answering it needs a
 * listing from every store. Laziness would buy nothing at that point and would
 * cost a second open on every export.
 *
 * A generation that cannot be opened is reported as a store the page could not
 * read and the rest of the transfer proceeds. Refusing the whole transfer
 * because one dormant candidate's database is corrupt would strand every project
 * the visitor can actually still move.
 *
 * ## The order these are listed in, and why the shared store is last
 *
 * The listing order is the order a project id held twice is resolved: the first
 * store to claim an id keeps it, and every later copy is reported as shadowed
 * rather than sent (`buildTransferStoreInventory()`). So the order has to be
 * "whichever copy the visitor's editor opens", derived the same way twice:
 *
 *   - **Newest generation first.** A V27 project reimported into V28 keeps its
 *     identity in both databases, and the editor the visitor boots is the newer
 *     generation's, reading the newer database. That is the copy their work is
 *     actually in.
 *   - **The shared editor store last**, for the same reason rather than in spite
 *     of it: no generation-isolated editor ever opens `kw-media-audio-editor`.
 *     Only the pre-generation shell does, so a copy sitting in it is the oldest
 *     copy there is - and while it sat first in this list, it was the copy that
 *     crossed, while the one the visitor's editor opens stayed behind.
 *
 * The `homes` list is deliberately *not* filtered by what exists: it is where an
 * arriving archive of a given generation belongs, and on a receiving origin the
 * answer is a database that does not exist yet.
 */
export interface OpenTransferStoreOptions {
	/** Injected by tests; production reads the page's own `indexedDB`. */
	readonly databases?: unknown;
	readonly generations?: readonly TransferStoreGeneration[];
	/** Injected by tests, so enumeration is exercisable without IndexedDB. */
	readonly openSharedStore?: (options: TransferStoreOpenOptions) => Promise<unknown>;
}

const TRANSFER_STORE_OPEN_OPTIONS: TransferStoreOpenOptions = Object.freeze({ memoryFallback: false });

export async function openTransferStore(
	options: OpenTransferStoreOptions = {},
): Promise<TransferStoreSource> {
	const shared = await openStoreHandle(
		options.openSharedStore ?? openSharedEditorStore,
		TRANSFER_STORE_OPEN_OPTIONS,
	);
	const sources: TransferStoreHandle[] = [];
	const unreadable: TransferStoreFault[] = [];
	const registered = options.generations ?? TRANSFER_STORE_GENERATIONS;
	const factory = options.databases ?? (globalThis as { indexedDB?: unknown }).indexedDB;
	const present = await discoverTransferStoreDatabases(factory)
		?? await probeTransferStoreDatabases(factory, registered);
	const opened = await Promise.all(
		transferStoreGenerationsPresent(present, registered).map(async (generation) => {
			try {
				return {
					id: generation.id,
					label: generation.label,
					schemaVersion: generation.schemaVersion,
					store: await openStoreHandle(generation.open, TRANSFER_STORE_OPEN_OPTIONS),
				};
			} catch (error) {
				return Object.freeze({
					storeId: generation.id,
					storeLabel: generation.label,
					reason: describeStoreOpenFailure(error),
				});
			}
		}),
	);
	for (const result of opened) {
		if ('store' in result) sources.push(result);
		else unreadable.push(result);
	}
	sources.push({
		id: TRANSFER_SHARED_EDITOR_STORE.id,
		label: TRANSFER_SHARED_EDITOR_STORE.label,
		schemaVersion: TRANSFER_SHARED_EDITOR_STORE.schemaVersion,
		store: shared,
	});
	const federation = createTransferStoreFederation({
		sources,
		homes: transferStoreHomes(registered, shared),
		writer: shared,
		unreadable,
	});
	return Object.freeze({
		id: 'this-origin-storage',
		label: 'This origin\'s project storage',
		store: federation.store,
		sources: Object.freeze([...sources]),
		unreadable: Object.freeze([...unreadable]),
		close: () => federation.close(),
	});
}

/**
 * Where an archive of each schema generation belongs, open or not.
 *
 * Every registered generation is a home, including the ones this device has no
 * database for: that is the ordinary case on a receiving origin, and opening one
 * creates exactly the database the editor would create on its first run. The
 * shared editor store is the home of the V17 document, and the only home whose
 * document owner this build can reach - see `TransferDocumentMigration`.
 */
function transferStoreHomes(
	registered: readonly TransferStoreGeneration[],
	shared: unknown,
): readonly TransferStoreHomeSource[] {
	return Object.freeze([
		...registered.map((generation) => Object.freeze({
			id: generation.id,
			label: generation.label,
			schemaVersion: generation.schemaVersion,
			documentMigration: 'as-stored' as const,
			open: () => openStoreHandle(generation.open, TRANSFER_STORE_OPEN_OPTIONS),
		})),
		Object.freeze({
			id: TRANSFER_SHARED_EDITOR_STORE.id,
			label: TRANSFER_SHARED_EDITOR_STORE.label,
			schemaVersion: TRANSFER_SHARED_EDITOR_STORE.schemaVersion,
			documentMigration: 'this-build' as const,
			open: async () => shared,
		}),
	]);
}

/**
 * Why one generation could not be opened, as prose.
 *
 * Spelled here rather than imported from `transfer-archive-stream.ts`, which
 * says the same thing: that module belongs to the transfer page's own chunk, and
 * a module this one imports from there is hoisted into a chunk the standalone
 * transfer document then preloads.
 */
function describeStoreOpenFailure(error: unknown): string {
	if (error instanceof Error) return error.message || error.name;
	if (typeof error === 'string' && error) return error;
	return 'The store could not be opened, for an unreported reason.';
}

/** The store both products' web sessions use for ordinary, unprofiled projects. */
async function openSharedEditorStore(options: TransferStoreOpenOptions): Promise<unknown> {
	const { createProjectStore } = await import('../editor/storage.js');
	return createProjectStore(options);
}

async function openStoreHandle(
	open: (options: TransferStoreOpenOptions) => Promise<unknown>,
	options: TransferStoreOpenOptions,
): Promise<unknown> {
	const store = await open(options);
	if (store === null || typeof store !== 'object') {
		throw new TypeError('A project store constructor did not produce a store.');
	}
	await (store as { ready?: () => Promise<unknown> }).ready?.();
	return store;
}
