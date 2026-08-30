/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Federates the two family-isolated 1.0 stores behind one transfer interface.
 * Every project remains attached to the store that owns its media. Selection
 * and duplicate detection use `(schemaFamily, projectId)`, so equal ids in the
 * two families remain independent. An arriving archive is routed only to the
 * store matching its complete schema tuple.
 *
 * Non-exportable rows stay visible in the inventory with a refusal code. The
 * static selection chunk owns the human wording, avoiding a shared preload
 * chunk while preserving the same admission rule on both sides.
 */

import {
	isProjectSchemaFamily,
	readProjectSchemaIdentity,
	type ProjectSchemaFamily,
	type ProjectSchemaIdentity,
} from '../editor/project-schema-identity.ts';

/** Mirrors MAXIMUM_PROJECT_ID_LENGTH in project-transfer-bundle-admission.ts. */
const MAXIMUM_PROJECT_ID_LENGTH = 256;

/** Why a listed row cannot be handed to the exporter. */
export type TransferStoreRefusal =
	/** The store listed it with no id the exporter would accept. */
	| Readonly<{ code: 'unidentified' }>
	/** An earlier row already claimed this family-qualified project id. */
	| Readonly<{ code: 'shadowed'; holder: string }>;

export interface TransferStoreHandle {
	/** Stable identifier, used in the page's own reporting and in selection keys. */
	readonly id: string;
	readonly label: string;
	readonly store: unknown;
	/**
	 * The project schema tuple whose live editor opens this store.
	 *
	 * Optional because a caller that only lists does not need it; a store that
	 * declares none is never the home of an arriving archive.
	 */
	readonly schemaFamily?: ProjectSchemaFamily;
	readonly schemaVersion?: number;
}

/**
 * A store an arriving archive can be written to, and how to reach it.
 *
 * Separate from `TransferStoreHandle` because a home does not have to be open:
 * on a receiving origin the visitor has no baseline databases at all, and the
 * one their archive needs is opened - created - when the archive arrives.
 */
export interface TransferStoreHomeSource {
	readonly id: string;
	readonly label: string;
	/** The project schema tuple whose home this store is; exactly one per store. */
	readonly schemaFamily: ProjectSchemaFamily;
	readonly schemaVersion: number;
	/** Opens the store, creating its database if this origin has never had one. */
	open(): Promise<unknown>;
}

export interface TransferStoreHome {
	readonly storeId: string;
	readonly storeLabel: string;
	readonly schemaFamily: ProjectSchemaFamily;
	readonly schemaVersion: number;
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
	readonly schemaFamily?: ProjectSchemaFamily;
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
	const admitted: {
		readonly projectId: string | null;
		readonly selectionIdentity: string | null;
		readonly shadowed: string | null;
	}[] = [];
	for (const listing of listings) {
		for (const project of listing.projects) {
			const projectId = admittedTransferRowId(project);
			const schemaFamily = listing.schemaFamily ?? admittedTransferRowFamily(project);
			const selectionIdentity = projectId === null ? null : schemaFamily
				? `${schemaFamily}:${projectId}`
				: projectId;
			const shadowed = selectionIdentity === null ? null : holders.get(selectionIdentity) ?? null;
			if (selectionIdentity !== null && shadowed === null) {
				holders.set(selectionIdentity, listing.storeLabel);
			}
			admitted.push({ projectId, selectionIdentity, shadowed });
		}
	}
	// Every key a real project id will take, claimed before the first generated
	// key is minted. A generated key is the one that has to move out of the way.
	const claimed = new Set<string>(holders.keys());
	const rows: TransferStoreInventoryRow[] = [];
	let index = 0;
	for (const listing of listings) {
		for (const project of listing.projects) {
			const { projectId, selectionIdentity, shadowed } = admitted[index];
			const exportable = projectId !== null && shadowed === null;
			rows.push(Object.freeze({
				selectionKey: claimTransferSelectionKey(
					claimed,
					exportable ? selectionIdentity : null,
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

function admittedTransferRowFamily(project: unknown): ProjectSchemaFamily | null {
	try {
		return readProjectSchemaIdentity(project).schemaFamily;
	} catch {
		return null;
	}
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
	/** One home per schema tuple, keyed by family and version. */
	readonly homes: ReadonlyMap<string, TransferStoreHomeSource>;
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
	 * Not the same set as `sources`: a home is where a family-qualified project
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
	 * archive is written to the home of its own tuple
	 * (`transferStoreHomeForSchema()`). Export is routed too, one layer up:
	 * `transferStoreForProject()` sends each export to the store that listed the
	 * project. What is left - everything an ordinary page does with a project
	 * store - reaches this one store, exactly as it did before this origin's
	 * other family stores were enumerated.
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
	const homes = new Map<string, TransferStoreHomeSource>();
	for (const home of options.homes ?? []) {
		// First claim wins, and a second claim on one tuple is a registry defect
		// rather than a visitor's problem: two homes for one tuple would send
		// two archives of the same kind to two different databases.
		const key = projectSchemaIdentityKey(home);
		if (!homes.has(key)) homes.set(key, home);
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
					...(source.schemaFamily ? { schemaFamily: source.schemaFamily } : {}),
					projects: await listOneStore(source.store),
				});
			} catch (error) {
				// One family store the page cannot read must not refuse the whole
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
	const resolveHome = async (identity: unknown): Promise<TransferStoreHome | null> => {
		let key: string;
		try {
			key = projectSchemaIdentityKey(readProjectSchemaIdentity(identity));
		} catch {
			return null;
		}
		const home = state.homes.get(key);
		if (!home) return null;
		const already = state.sources.find((source) => source.id === home.id);
		if (already) return frozenHome(home, already.store);
		// Not open, and on a receiving origin it never was: opening it here is
		// what creates the database the editor will open on its first run. The
		// promise is retained rather than the store, so two archives of one tuple
		// arriving back to back open it once.
		let opening = state.opened.get(home.id);
		if (!opening) {
			opening = home.open();
			state.opened.set(home.id, opening);
			void opening.catch(() => {
				if (state.opened.get(home.id) === opening) state.opened.delete(home.id);
			});
		}
		return frozenHome(home, await opening);
	};
	const loadProject = async (projectId: unknown, options?: unknown): Promise<unknown> => {
		// Asked of the federation, "is this identity present?" is a question about
		// the origin rather than about one database, and the caller that asks it -
		// the import layer's residue guard - has no schema to route by. Answering
		// only for the writer would report an untidied import into a family
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
	const deleteProjectIfCurrent = async (project: unknown): Promise<unknown> => {
		let identity: ProjectSchemaIdentity;
		try {
			identity = readProjectSchemaIdentity(project);
		} catch {
			return false;
		}
		const home = await resolveHome(identity);
		if (!home) return false;
		const remove = (home.store as { deleteProjectIfCurrent?: unknown }).deleteProjectIfCurrent;
		if (typeof remove !== 'function') return false;
		return (remove as (value: unknown) => PromiseLike<unknown> | unknown)
			.call(home.store, project);
	};
	const store = new Proxy(writer as object, {
		get(target, property) {
			if (property === 'listProjects') return listProjects;
			if (property === 'listTransferInventory') return listTransferInventory;
			if (property === 'transferStoreHome') return resolveHome;
			if (property === 'loadProject') return loadProject;
			if (property === 'deleteProjectIfCurrent') return deleteProjectIfCurrent;
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
			// family store left open holds a connection that blocks the editor's own
			// version upgrades. Homes opened for an arriving archive are closed the
			// same way - they are the connections most likely to be in the editor's
			// path, since the visitor is about to open that product.
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
 * Keyed on the listed row itself. Two family stores can list two different
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
		schemaFamily: home.schemaFamily,
		schemaVersion: home.schemaVersion,
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
 * The store an archive of this schema tuple belongs in, or `null`.
 *
 * Asked of the store rather than of this module's own registry, and by shape, so
 * that it survives the facades the import layer wraps a receiving store in:
 * `witnessProjectTransferWrites()` hands the archive importer a proxy over this
 * store, and a proxy forwards a property read but is not this store's identity.
 *
 * `null` is "no store here is the home of that tuple", which is a refusal
 * for the caller to name - never a licence to write somewhere else.
 */
export async function transferStoreHomeForSchema(
	store: unknown,
	identity: ProjectSchemaIdentity,
): Promise<TransferStoreHome | null> {
	const resolve = (store as { transferStoreHome?: unknown } | null)?.transferStoreHome;
	if (typeof resolve !== 'function') return null;
	return (resolve as (value: ProjectSchemaIdentity) => Promise<TransferStoreHome | null>).call(
		store,
		identity,
	);
}

/** True when this store can answer where an arriving archive belongs. */
export function routesTransferArchivesHome(store: unknown): boolean {
	return typeof (store as { transferStoreHome?: unknown } | null)?.transferStoreHome === 'function';
}

function projectSchemaIdentityKey(identity: ProjectSchemaIdentity): string {
	if (!isProjectSchemaFamily(identity.schemaFamily)
		|| !Number.isSafeInteger(identity.schemaVersion) || identity.schemaVersion < 1) {
		throw new TypeError('A transfer home requires a valid project schema identity.');
	}
	return `${identity.schemaFamily}:${String(identity.schemaVersion)}`;
}
