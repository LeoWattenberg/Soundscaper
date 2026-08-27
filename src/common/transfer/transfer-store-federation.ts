/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * One store's worth of surface over every store this origin actually has.
 *
 * `openTransferStore()` opens the shared editor database and each
 * generation-isolated database a device turns out to hold
 * (`transfer-store-generations.ts`). The page above it - and the export and
 * import layers below it - are written against a single project store, so this
 * module is what makes several of them look like one without losing track of
 * which is which.
 *
 * Three things have to survive that flattening, and each one is a way the
 * transfer could quietly lie to a visitor:
 *
 *   **Attribution.** A project has to stay attached to the store it came from.
 *   `exportScapeProject(project, store)` reads that project's media out of the
 *   store it is handed, so exporting a Framescaper V31 project against the
 *   shared database would produce an archive whose sources are silently absent.
 *   `transferStoreForProject()` is how the archive runtime recovers the right
 *   store, and it is keyed on the listed row itself rather than on its id,
 *   because ids are only unique inside one store.
 *
 *   **One identity per row.** Selection is keyed by string, so every row needs a
 *   distinct key even when the store listed it with no id at all - otherwise
 *   several unidentified rows share the empty string and ticking one ticks them
 *   all. `selectionKey` is that key: the project id where there is one, and a
 *   generated per-row key where there is not.
 *
 *   **No merging two generations into one.** When two generations hold the same
 *   project id - a V27 project reimported into V28 keeps its identity - only the
 *   newest is offered. Sending both would put two archives on the wire under one
 *   entry id, and the receiving origin would take the second for a duplicate of
 *   the first. The older copy is reported with a refusal that names the
 *   generation that shadowed it, never dropped from the listing.
 *
 *   **A home for an arriving archive.** The other direction asks the mirror
 *   question: an archive names a schema generation, and the store the visitor's
 *   editor will open for that generation is the one store it may be written to.
 *   `transferStoreHomeForSchema()` answers it, opening that generation's
 *   database if this origin has never had one - which is the ordinary case on a
 *   receiving origin, and is the same database the editor would create on its
 *   first run. A schema no store here claims has no home, and an archive with no
 *   home is refused by name rather than written into whichever store was handy.
 *
 * The store this exposes refuses nothing on its own. Rows that cannot be
 * exported are kept *out of `listProjects()`* and kept *in the inventory*: the
 * exporter's admission layer refuses a whole run over a single id-less row
 * (`selectProjectTransferProjects()` admits before it selects), so handing it
 * such a row would let one unaddressable project stop every other project from
 * crossing. Reporting it and leaving it behind is the failure shape that fits a
 * page whose job is to rescue as much as it can.
 *
 * ## Why a refusal here is a code, and not a sentence
 *
 * This module is on the dynamic side of the transfer page: it arrives with the
 * archive runtime, after the visitor has asked for a transfer.
 * `transfer-project-selection.ts` is on the *static* side - the page's own chunk
 * - and a module both sides import is hoisted into a third chunk that the page
 * then preloads (`tests/project-transfer-standalone-page-chunks.test.ts` fails
 * on exactly that). So the two sides share types, which are erased, and nothing
 * else: the store layer says *what happened* to a row, and the selection layer
 * owns every sentence the visitor reads. `tests/project-transfer-store-enumeration.test.ts`
 * holds the two admission rules to the same answer.
 */

/** Mirrors MAXIMUM_PROJECT_ID_LENGTH in project-transfer-bundle-admission.ts. */
const MAXIMUM_PROJECT_ID_LENGTH = 256;

/** Why a listed row cannot be handed to the exporter. */
export type TransferStoreRefusal =
	/** The store listed it with no id the exporter would accept. */
	| Readonly<{ code: 'unidentified' }>
	/** An earlier store in the enumeration already claimed this project id. */
	| Readonly<{ code: 'shadowed'; holder: string }>;

export interface TransferStoreHandle {
	/** Stable identifier, used in the page's own reporting and in selection keys. */
	readonly id: string;
	readonly label: string;
	readonly store: unknown;
	/**
	 * The project schema generation whose live editor opens this store.
	 *
	 * Optional because a caller that only lists does not need it; a store that
	 * declares none is never the home of an arriving archive.
	 */
	readonly schemaVersion?: number;
}

/**
 * A store an arriving archive can be written to, and how to reach it.
 *
 * Separate from `TransferStoreHandle` because a home does not have to be open:
 * on a receiving origin the visitor has no generation databases at all, and the
 * one their archive needs is opened - created - when the archive arrives.
 */
export interface TransferStoreHomeSource {
	readonly id: string;
	readonly label: string;
	/** The project schema whose home this store is; exactly one per store. */
	readonly schemaVersion: number;
	/** Who admits the arriving document - see `TransferStoreHome`. */
	readonly documentMigration: TransferDocumentMigration;
	/** Opens the store, creating its database if this origin has never had one. */
	open(): Promise<unknown>;
}

/**
 * Who owns the admission of a document arriving for this store's generation.
 *
 * `this-build` is the shared editor store alone: the `.scape` layer's default
 * document owner (`migrateAudioEditorProject()`) *is* that store's editor's
 * owner, so an arriving V17 document is admitted by exactly the rule its editor
 * applies. Every generation's own owner lives inside that product's chunk and
 * cannot be reached from the transfer page (see `transfer-store-generations.ts`
 * for why), so its documents are admitted `as-stored`: written back exactly as
 * the archive carries them, on the strength of an exact schema match.
 */
export type TransferDocumentMigration = 'this-build' | 'as-stored';

export interface TransferStoreHome {
	readonly storeId: string;
	readonly storeLabel: string;
	readonly schemaVersion: number;
	readonly documentMigration: TransferDocumentMigration;
	readonly store: unknown;
}

/** A store the page knows about and could not read. */
export interface TransferStoreFault {
	readonly storeId: string;
	readonly storeLabel: string;
	readonly reason: string;
}

export interface TransferStoreInventoryRow {
	/** Distinct for every row in one inventory, id or no id. */
	readonly selectionKey: string;
	/** The store's own id, or `null` when it listed the row without a usable one. */
	readonly projectId: string | null;
	/** The listed row itself, as the store handed it over. */
	readonly project: unknown;
	readonly storeId: string;
	readonly storeLabel: string;
	/** False for a row the exporter must never be given. */
	readonly exportable: boolean;
	/** Why this row cannot cross, or `null` when nothing here refuses it. */
	readonly refusal: TransferStoreRefusal | null;
}

export interface TransferStoreInventory {
	/** Every row every readable store listed, in store order then listing order. */
	readonly rows: readonly TransferStoreInventoryRow[];
	/** Stores the page knows about and could not read. */
	readonly unreadable: readonly TransferStoreFault[];
}

export interface TransferStoreListing {
	readonly storeId: string;
	readonly storeLabel: string;
	readonly projects: readonly unknown[];
}

/**
 * Turn what each store listed into one inventory.
 *
 * Pure, and exported, so that the rule can be exercised - and compared against
 * the single-store rule the selection layer runs on the other side of the chunk
 * boundary - without opening a database.
 */
export function buildTransferStoreInventory(
	listings: readonly TransferStoreListing[],
	unreadable: readonly TransferStoreFault[] = [],
): TransferStoreInventory {
	// Ids are claimed in listing order, so a later store's duplicate is the one
	// shadowed. The listing order is home order - the store the visitor's editor
	// would open comes first (`openTransferStore()`) - which makes the winner the
	// copy that editor actually opens.
	const holders = new Map<string, string>();
	const admitted: { readonly projectId: string | null; readonly shadowed: string | null }[] = [];
	for (const listing of listings) {
		for (const project of listing.projects) {
			const projectId = admittedTransferRowId(project);
			const shadowed = projectId === null ? null : holders.get(projectId) ?? null;
			if (projectId !== null && shadowed === null) holders.set(projectId, listing.storeLabel);
			admitted.push({ projectId, shadowed });
		}
	}
	// Every key a real project id will take, claimed before the first generated
	// key is minted. A generated key is the one that has to move out of the way.
	const claimed = new Set<string>(holders.keys());
	const rows: TransferStoreInventoryRow[] = [];
	let index = 0;
	for (const listing of listings) {
		for (const project of listing.projects) {
			const { projectId, shadowed } = admitted[index];
			const exportable = projectId !== null && shadowed === null;
			rows.push(Object.freeze({
				selectionKey: claimTransferSelectionKey(
					claimed,
					exportable ? projectId : null,
					listing.storeId,
					index,
				),
				projectId,
				project,
				storeId: listing.storeId,
				storeLabel: listing.storeLabel,
				exportable,
				refusal: exportable
					? null
					: shadowed === null
						? Object.freeze({ code: 'unidentified' as const })
						: Object.freeze({ code: 'shadowed' as const, holder: shadowed }),
			}));
			index += 1;
		}
	}
	return Object.freeze({ rows: Object.freeze(rows), unreadable: Object.freeze([...unreadable]) });
}

/**
 * The id the exporter would accept for this row, or `null`.
 *
 * Deliberately the same test `admittedProjectTransferId()` applies one layer
 * down, length included: a row this returns `null` for is a row that would make
 * `selectProjectTransferProjects()` refuse the whole run, and those are exactly
 * the rows that must be reported rather than handed over.
 */
export function admittedTransferRowId(project: unknown): string | null {
	if (project === null || typeof project !== 'object') return null;
	const id = (project as { id?: unknown }).id;
	return typeof id === 'string' && id.length > 0 && id.length <= MAXIMUM_PROJECT_ID_LENGTH ? id : null;
}

/**
 * A key no other row in this inventory holds.
 *
 * An addressable row keeps its project id, whatever else is in the inventory,
 * because that is the string the page's selection is read back against: a real
 * row renamed to `id~` is a project the visitor ticked and the exporter is never
 * asked for. So a real id never yields - a generated key does, and `claimed`
 * arrives already holding every real id this inventory will hand out, so the
 * generated key moves even when the row it would collide with is listed later.
 *
 * The loop rather than a counter because the alternative key can collide too:
 * a store whose id ends in `#1` can produce `store#1~` twice over.
 */
export function claimTransferSelectionKey(
	claimed: Set<string>,
	projectId: string | null,
	storeId: string,
	index: number,
): string {
	if (projectId !== null) {
		claimed.add(projectId);
		return projectId;
	}
	let key = `${storeId}#${index}`;
	while (claimed.has(key)) key += '~';
	claimed.add(key);
	return key;
}

interface TransferStoreFederationState {
	readonly sources: readonly TransferStoreHandle[];
	readonly unreadable: readonly TransferStoreFault[];
	readonly owners: WeakMap<object, unknown>;
	/** One home per schema generation, keyed by the schema its editor writes. */
	readonly homes: ReadonlyMap<number, TransferStoreHomeSource>;
	/** Homes this federation opened itself, so `close()` can close them again. */
	readonly opened: Map<string, Promise<unknown>>;
	readonly writer: unknown;
	inventory: TransferStoreInventory | null;
}

const FEDERATIONS = new WeakMap<object, TransferStoreFederationState>();

export interface TransferStoreFederationOptions {
	/** Every store to list from, in listing order; includes the writer. */
	readonly sources: readonly TransferStoreHandle[];
	/**
	 * Every store an arriving archive may be written to, one per schema.
	 *
	 * Not the same set as `sources`: a home is where a *generation* of project
	 * lives, whether or not this device has one yet, while a source is a store
	 * that was open in time to be listed. On a receiving origin the two barely
	 * overlap - there is nothing to list and everything to write.
	 */
	readonly homes?: readonly TransferStoreHomeSource[];
	/**
	 * The store every call this module does not route itself reaches.
	 *
	 * Three kinds of call are routed rather than delegated here, and each one is
	 * a place where "one store" would be a wrong answer rather than a simple one:
	 * a listing is the union of every store; `loadProject` is a question about
	 * the origin, so it is asked of each store in home order; and an arriving
	 * archive is written to the home of its own generation
	 * (`transferStoreHomeForSchema()`). Export is routed too, one layer up:
	 * `transferStoreForProject()` sends each export to the store that listed the
	 * project. What is left - everything an ordinary page does with a project
	 * store - reaches this one store, exactly as it did before this origin's
	 * other generations were enumerated.
	 */
	readonly writer: unknown;
	readonly unreadable?: readonly TransferStoreFault[];
}

export interface TransferStoreFederation {
	/** One project store, standing in for every store this origin has. */
	readonly store: unknown;
	close(): Promise<void>;
}

export function createTransferStoreFederation(
	options: TransferStoreFederationOptions,
): TransferStoreFederation {
	const writer = options.writer;
	if (writer === null || typeof writer !== 'object') {
		throw new TypeError('A transfer store federation needs a store to delegate writes to.');
	}
	const homes = new Map<number, TransferStoreHomeSource>();
	for (const home of options.homes ?? []) {
		// First claim wins, and a second claim on one schema is a registry defect
		// rather than a visitor's problem: two homes for one generation would send
		// two archives of the same kind to two different databases.
		if (!homes.has(home.schemaVersion)) homes.set(home.schemaVersion, home);
	}
	const state: TransferStoreFederationState = {
		sources: Object.freeze([...options.sources]),
		unreadable: Object.freeze([...options.unreadable ?? []]),
		owners: new WeakMap<object, unknown>(),
		homes,
		opened: new Map<string, Promise<unknown>>(),
		writer,
		inventory: null,
	};
	const listTransferInventory = async (): Promise<TransferStoreInventory> => {
		const listings: TransferStoreListing[] = [];
		const faults = [...state.unreadable];
		for (const source of state.sources) {
			try {
				listings.push({
					storeId: source.id,
					storeLabel: source.label,
					projects: await listOneStore(source.store),
				});
			} catch (error) {
				// One generation the page cannot read must not refuse the whole
				// transfer: the rest of the visitor's projects are still movable,
				// and this store is reported as one the page could not read.
				faults.push(Object.freeze({
					storeId: source.id,
					storeLabel: source.label,
					reason: describeStoreFault(error),
				}));
			}
		}
		const inventory = buildTransferStoreInventory(listings, faults);
		state.inventory = inventory;
		for (const row of inventory.rows) {
			if (typeof row.project === 'object' && row.project !== null) {
				state.owners.set(row.project, storeFor(state, row.storeId));
			}
		}
		return inventory;
	};
	const listProjects = async (): Promise<readonly unknown[]> => {
		const inventory = await listTransferInventory();
		return Object.freeze(inventory.rows.filter((row) => row.exportable).map((row) => row.project));
	};
	const resolveHome = async (schemaVersion: unknown): Promise<TransferStoreHome | null> => {
		if (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion)) return null;
		const home = state.homes.get(schemaVersion);
		if (!home) return null;
		const already = state.sources.find((source) => source.id === home.id);
		if (already) return frozenHome(home, already.store);
		// Not open, and on a receiving origin it never was: opening it here is
		// what creates the database the editor will open on its first run. The
		// promise is retained rather than the store, so two archives of one
		// generation arriving back to back open it once.
		let opening = state.opened.get(home.id);
		if (!opening) {
			opening = home.open();
			state.opened.set(home.id, opening);
		}
		return frozenHome(home, await opening);
	};
	const loadProject = async (projectId: unknown, options?: unknown): Promise<unknown> => {
		// Asked of the federation, "is this identity present?" is a question about
		// the origin rather than about one database, and the caller that asks it -
		// the import layer's residue guard - has no schema to route by. Answering
		// only for the writer would report an untidied import into a generation
		// store as nothing at all.
		for (const store of await federatedStores(state)) {
			const load = (store as { loadProject?: unknown } | null)?.loadProject;
			if (typeof load !== 'function') continue;
			const found = await (load as (id: unknown, options?: unknown) => Promise<unknown>)
				.call(store, projectId, options);
			if (found) return found;
		}
		return null;
	};
	const store = new Proxy(writer as object, {
		get(target, property) {
			if (property === 'listProjects') return listProjects;
			if (property === 'listTransferInventory') return listTransferInventory;
			if (property === 'transferStoreHome') return resolveHome;
			if (property === 'loadProject') return loadProject;
			const value = Reflect.get(target, property, target);
			if (typeof value !== 'function') return value;
			// Applied to the real store, never to this proxy: a store built on
			// private fields throws the moment a method runs with the wrong
			// receiver, and every editor store is built that way.
			const method = value as (...args: unknown[]) => unknown;
			return (...args: unknown[]) => method.apply(target, args);
		},
	});
	FEDERATIONS.set(store, state);
	return Object.freeze({
		store,
		close: async () => {
			// Every store is closed, whatever any one of them does about it: a
			// generation left open holds a connection that blocks the editor's own
			// version upgrades. Homes opened for an arriving archive are closed the
			// same way - they are the connections most likely to be in the editor's
			// path, since the visitor is about to go and open that generation.
			const opened = [...state.opened.values()].map(
				(pending) => pending.catch(() => null),
			);
			await Promise.all([
				...state.sources.map((source) => closeOneStore(source.store)),
				...opened.map(async (pending) => closeOneStore(await pending)),
			]);
		},
	});
}

async function listOneStore(store: unknown): Promise<readonly unknown[]> {
	const list = (store as { listProjects?: unknown } | null)?.listProjects;
	if (typeof list !== 'function') {
		throw new TypeError('A project store must be able to list projects.');
	}
	const listed = await (list as () => Promise<unknown>).call(store);
	if (!Array.isArray(listed)) throw new TypeError('A project store must list projects as an array.');
	return listed;
}

/**
 * Why one store could not be read, as prose.
 *
 * Spelled here rather than imported from `transfer-archive-stream.ts`, which
 * says the same thing: that module belongs to the page's own chunk, and a module
 * this one imports from there is hoisted into a chunk the standalone transfer
 * document then preloads.
 */
function describeStoreFault(error: unknown): string {
	if (error instanceof Error) return error.message || error.name;
	if (typeof error === 'string' && error) return error;
	return 'The store failed to answer for an unreported reason.';
}

function storeFor(state: TransferStoreFederationState, storeId: string): unknown {
	return state.sources.find((source) => source.id === storeId)?.store ?? null;
}

/** True when this store is one of ours, standing in for several. */
export function isTransferStoreFederation(store: unknown): boolean {
	return typeof store === 'object' && store !== null && FEDERATIONS.has(store);
}

/**
 * What the last listing found, or `null` for a store that is not a federation.
 *
 * `null` is not an empty inventory: it means the caller is holding an ordinary
 * store and has to derive its own rows.
 */
export function transferStoreInventory(store: unknown): TransferStoreInventory | null {
	if (typeof store !== 'object' || store === null) return null;
	return FEDERATIONS.get(store)?.inventory ?? null;
}

/**
 * The store that listed this project, or `null` when this is not a federation.
 *
 * Keyed on the listed row itself. Two generations can list two different
 * projects under one id, so an id-keyed lookup would be able to answer with the
 * wrong store - and the wrong store is an archive with no media in it.
 */
export function transferStoreForProject(store: unknown, project: unknown): unknown {
	if (typeof store !== 'object' || store === null) return null;
	const state = FEDERATIONS.get(store);
	if (!state || typeof project !== 'object' || project === null) return null;
	return state.owners.get(project) ?? null;
}

function frozenHome(home: TransferStoreHomeSource, store: unknown): TransferStoreHome {
	if (store === null || typeof store !== 'object') {
		throw new TypeError(`The ${home.label} store did not open as a store.`);
	}
	return Object.freeze({
		storeId: home.id,
		storeLabel: home.label,
		schemaVersion: home.schemaVersion,
		documentMigration: home.documentMigration,
		store,
	});
}

/** Every store this federation is holding open, in home order, each one once. */
async function federatedStores(state: TransferStoreFederationState): Promise<readonly unknown[]> {
	const opened = await Promise.all(
		[...state.opened.values()].map((pending) => pending.catch(() => null)),
	);
	const stores: unknown[] = [];
	const seen = new Set<unknown>();
	for (const candidate of [...state.sources.map((source) => source.store), ...opened, state.writer]) {
		if (candidate === null || typeof candidate !== 'object' || seen.has(candidate)) continue;
		seen.add(candidate);
		stores.push(candidate);
	}
	return stores;
}

async function closeOneStore(store: unknown): Promise<void> {
	try {
		await (store as { close?: () => Promise<unknown> } | null)?.close?.();
	} catch {
		// A store that will not close has nothing more to tell the page.
	}
}

/**
 * The store an archive of this schema generation belongs in, or `null`.
 *
 * Asked of the store rather than of this module's own registry, and by shape, so
 * that it survives the facades the import layer wraps a receiving store in:
 * `witnessProjectTransferWrites()` hands the archive importer a proxy over this
 * store, and a proxy forwards a property read but is not this store's identity.
 *
 * `null` is "no store here is the home of that generation", which is a refusal
 * for the caller to name - never a licence to write somewhere else.
 */
export async function transferStoreHomeForSchema(
	store: unknown,
	schemaVersion: number,
): Promise<TransferStoreHome | null> {
	const resolve = (store as { transferStoreHome?: unknown } | null)?.transferStoreHome;
	if (typeof resolve !== 'function') return null;
	return (resolve as (version: number) => Promise<TransferStoreHome | null>).call(
		store,
		schemaVersion,
	);
}

/** True when this store can answer where an arriving archive belongs. */
export function routesTransferArchivesHome(store: unknown): boolean {
	return typeof (store as { transferStoreHome?: unknown } | null)?.transferStoreHome === 'function';
}
