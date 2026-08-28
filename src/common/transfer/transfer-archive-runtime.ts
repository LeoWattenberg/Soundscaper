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
	ProjectReimportRequiredError,
	readProjectSchemaIdentity,
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	type ProjectSchemaFamily,
	type ProjectSchemaIdentity,
} from '../editor/project-schema-identity.ts';
import {
	discoverTransferStoreDatabases,
	probeTransferStoreDatabases,
	transferStoreBaselinesPresent,
	TRANSFER_STORE_BASELINES,
	type TransferStoreBaseline,
	type TransferStoreOpenOptions,
} from './transfer-store-baselines.ts';
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
 * project's media and sources *out of the store it is passed*, and each family
 * keeps its own OPFS directory. Using the wrong family store could otherwise
 * produce an archive whose sources are quietly missing.
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
 * message, and "this family/schema tuple has no home" is something
 * they can act on - by updating the receiving origin - in a way that "imported
 * 4 of 5" is not.
 */
export class TransferArchiveHomeError extends Error {
	readonly schemaFamily: ProjectSchemaFamily | null;
	readonly schemaVersion: number | null;

	constructor(
		message: string,
		identity: Readonly<Partial<ProjectSchemaIdentity>> | null,
	) {
		super(message);
		this.name = 'TransferArchiveHomeError';
		this.schemaFamily = identity?.schemaFamily ?? null;
		this.schemaVersion = identity?.schemaVersion ?? null;
	}
}

/**
 * Import every archive into the store its own editor will open, or refuse it.
 *
 * A project has a home store, and both directions agree on which one. The sender
 * exports each project from the store that listed it; the receiver imports each
 * archive into the store the visitor's editor will open for that archive's
 * family-qualified schema - creating that baseline database if this origin has
 * never had one, which is exactly what the editor's own first run would do. An
 * archive whose tuple no store here claims is refused by name: there is no
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
 * while importing into another family makes the first one meaningless: it probes a
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
	const identity = await transferArchiveSchemaIdentity(inspectProject, input, options);
	const home = await transferStoreHomeForSchema(store, identity);
	if (!home) {
		throw new TransferArchiveHomeError(
			`No project store on this origin holds ${identity.schemaFamily} schema ${identity.schemaVersion}`
			+ ' projects, so an archive'
			+ ' has nowhere to be imported that its editor would find it.',
			identity,
		);
	}
	return home;
}

/**
 * The schema tuple the archive itself declares.
 *
 * Read with no store, so the question costs no database access, and with an
 * owner that stops at the header: a probe that admitted the document would run
 * the whole asset index against a schema it has not chosen a store for yet.
 */
async function transferArchiveSchemaIdentity(
	inspectProject: TransferRuntime['inspectProject'],
	input: unknown,
	options: Readonly<{ signal?: AbortSignal }>,
): Promise<Readonly<ProjectSchemaIdentity>> {
	const probed = await inspectProject(input, null, transferArchiveOptions(options, {
		loadProject: readTransferArchiveHeader,
		currentProjectSchemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	}));
	try {
		return readProjectSchemaIdentity(probed);
	} catch (error) {
		if (error instanceof ProjectReimportRequiredError) throw error;
		throw new TransferArchiveHomeError(
			'This .scape archive does not name the project family and schema it was written from, so no store'
			+ ' on this origin can be chosen for it.',
			null,
		);
	}
}

/** Stop at the header: `readOnly` is what makes the reader return without indexing. */
function readTransferArchiveHeader(value: unknown): unknown {
	readProjectSchemaIdentity(value);
	return {
		project: value,
		readOnly: true,
		reason: 'transfer-home-probe',
	};
}

/**
 * How the home store admits an arriving document. The product domain owner is
 * not imported into the transfer chunk, so exact tuple agreement provides the
 * boundary custody and the document is stored without migration.
 */
function homeArchiveOptions<Options extends Readonly<{ signal?: AbortSignal }>>(
	options: Options,
	home: TransferStoreHome,
): Options {
	return transferArchiveOptions(options, {
		loadProject: admitStoredBaseline(home),
		currentProjectSchemaFamily: home.schemaFamily,
	});
}

function admitStoredBaseline(identity: ProjectSchemaIdentity): (value: unknown) => unknown {
	return (value: unknown) => {
		const stored = readProjectSchemaIdentity(value);
		if (stored.schemaFamily !== identity.schemaFamily
			|| stored.schemaVersion !== identity.schemaVersion) {
			// The header read and this one disagree, so the archive changed under
			// the page. Refusing is the only answer that cannot write a document
			// into a family store that is not its own.
			throw new TransferArchiveHomeError(
				`This .scape archive was read as ${identity.schemaFamily} schema ${identity.schemaVersion}`
					+ ` and now carries ${stored.schemaFamily} schema ${stored.schemaVersion}, so it cannot`
					+ ' be admitted to either family store.',
				identity,
			);
		}
		return {
			project: value,
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
	added: Readonly<{
		loadProject: (value: unknown) => unknown;
		currentProjectSchemaFamily: ProjectSchemaFamily;
	}>,
): Options {
	return { ...options, ...added } as Options;
}

/**
 * Opens the existing Soundscaper and Framescaper baseline stores as one source.
 * Retired database names are never enumerated or opened. Homes are not filtered
 * by existence because an arriving v1 archive may create its family's fresh
 * store exactly as the editor's first run would.
 */
export interface OpenTransferStoreOptions {
	/** Injected by tests; production reads the page's own `indexedDB`. */
	readonly databases?: unknown;
	readonly baselines?: readonly TransferStoreBaseline[];
}

const TRANSFER_STORE_OPEN_OPTIONS: TransferStoreOpenOptions = Object.freeze({ memoryFallback: false });

export async function openTransferStore(
	options: OpenTransferStoreOptions = {},
): Promise<TransferStoreSource> {
	const writer = Object.freeze({});
	const sources: TransferStoreHandle[] = [];
	const unreadable: TransferStoreFault[] = [];
	const registered = options.baselines ?? TRANSFER_STORE_BASELINES;
	const factory = options.databases ?? (globalThis as { indexedDB?: unknown }).indexedDB;
	const present = await discoverTransferStoreDatabases(factory)
		?? await probeTransferStoreDatabases(factory, registered);
	const opened = await Promise.all(
		transferStoreBaselinesPresent(present, registered).map(async (baseline) => {
			try {
				return {
					id: baseline.id,
					label: baseline.label,
					schemaFamily: baseline.schemaFamily,
					schemaVersion: baseline.schemaVersion,
					store: await openStoreHandle(baseline.open, TRANSFER_STORE_OPEN_OPTIONS),
				};
			} catch (error) {
				return Object.freeze({
					storeId: baseline.id,
					storeLabel: baseline.label,
					reason: describeStoreOpenFailure(error),
				});
			}
		}),
	);
	for (const result of opened) {
		if ('store' in result) sources.push(result);
		else unreadable.push(result);
	}
	const federation = createTransferStoreFederation({
		sources,
		homes: transferStoreHomes(registered),
		writer,
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
 * Where an archive of each baseline tuple belongs, open or not.
 */
function transferStoreHomes(
	registered: readonly TransferStoreBaseline[],
): readonly TransferStoreHomeSource[] {
	return Object.freeze(registered.map((baseline) => Object.freeze({
			id: baseline.id,
		label: baseline.label,
		schemaFamily: baseline.schemaFamily,
		schemaVersion: baseline.schemaVersion,
		open: () => openStoreHandle(baseline.open, TRANSFER_STORE_OPEN_OPTIONS),
	})));
}

/**
 * Why one baseline store could not be opened, as prose.
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
