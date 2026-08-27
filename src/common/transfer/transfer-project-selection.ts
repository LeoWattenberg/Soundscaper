/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Which of this origin's projects a transfer is even allowed to offer.
 *
 * Both products share one origin's storage today, so "every project in the
 * store" is never the right answer to "what should I hand to the other
 * product". A visitor on soundscaper.org who opens the Framescaper transfer is
 * asking to move their *video* projects; sending their audio projects too would
 * copy work across an origin boundary they never asked to cross, and no amount
 * of honest reporting afterwards undoes that.
 *
 * So the page never sends a set it derived on its own. This module turns the
 * store's listing into a per-project offer - what it is, which product it
 * belongs to, which of this origin's stores holds it, and whether it is worth
 * preselecting - and the page turns that into checkboxes the visitor has to
 * leave ticked. The selection the visitor ends up with is the only thing the
 * exporter is ever given.
 *
 * "The store" is several stores: `openTransferStore()` opens the shared editor
 * database and every generation-isolated database this origin turns out to hold,
 * and hands them over as one federated store (`transfer-store-federation.ts`).
 * The listing here is the union of all of them, and every offer keeps the store
 * it came from - both because the exporter has to read each project out of the
 * right one, and because a visitor deciding what to move is entitled to see that
 * two of these rows are two generations rather than one project listed twice.
 *
 * That federation is asked for its inventory through the store itself
 * (`listTransferInventory()`), never through an import. This module is in the
 * transfer page's own chunk and the federation arrives with the archive runtime;
 * a module both of them import is hoisted into a third chunk that the page then
 * preloads, which `tests/project-transfer-standalone-page-chunks.test.ts`
 * refuses. So the store layer reports *what happened* to each row as a code, and
 * every sentence a visitor reads about it is written here.
 *
 * Product identity comes off the project's own schema version, because that is
 * the one field a stored project actually carries: `productId` is a runtime
 * notion of the shell that opened the document, not something persisted with
 * it. A schema this build does not recognize is reported as `null` rather than
 * guessed at - it is still offered, so a visitor can rescue it deliberately,
 * but it is never preselected.
 */

import {
	isActiveAudioEditorProjectSchema,
	isFramescaperSequenceProjectSchema,
	isFramescaperVideoProxyProjectSchema,
	isSelectedFramescaperProjectSchema,
} from '../editor/project-schema-version.ts';
import type {
	TransferStoreInventory,
	TransferStoreInventoryRow,
	TransferStoreRefusal,
} from './transfer-store-federation.ts';

export type TransferProduct = 'soundscaper' | 'framescaper';

/** The origins whose product identity is known without configuration. */
const TRANSFER_ORIGIN_PRODUCTS: ReadonlyMap<string, TransferProduct> = new Map([
	['https://soundscaper.org', 'soundscaper'],
	['https://framescaper.org', 'framescaper'],
]);

/** What a single unfederated store is called when it has no name of its own. */
const UNNAMED_STORE = Object.freeze({ id: 'origin-storage', label: 'this origin\'s project storage' });

/** Mirrors MAXIMUM_PROJECT_ID_LENGTH in project-transfer-bundle-admission.ts. */
const MAXIMUM_PROJECT_ID_LENGTH = 256;

/**
 * Which product an origin serves, or `null` when nothing is known about it.
 *
 * A preview deployment, a dev server and the packaged desktop shell all land on
 * `null`, and `null` deliberately preselects nothing: an exercise that cannot
 * tell the two products apart must ask the visitor rather than assume.
 */
export function transferProductForOrigin(origin: unknown): TransferProduct | null {
	return typeof origin === 'string' ? TRANSFER_ORIGIN_PRODUCTS.get(origin) ?? null : null;
}

/**
 * Which product wrote a stored project, judged by its schema version.
 *
 * The shared V17 audio document counts as Soundscaper: it is an audio-authoring
 * document, and Framescaper never writes one.
 */
export function transferProjectProduct(project: unknown): TransferProduct | null {
	if (project === null || typeof project !== 'object') return null;
	const schemaVersion = (project as { schemaVersion?: unknown }).schemaVersion;
	if (isSelectedFramescaperProjectSchema(schemaVersion)
		|| isFramescaperSequenceProjectSchema(schemaVersion)
		|| isFramescaperVideoProxyProjectSchema(schemaVersion)) {
		return 'framescaper';
	}
	return isActiveAudioEditorProjectSchema(schemaVersion) ? 'soundscaper' : null;
}

/**
 * What the page says about a row nothing can address.
 *
 * The exporter's admission layer refuses a run that reaches a row with no usable
 * id - `selectProjectTransferProjects()` admits every listed row before it
 * consults the caller's selection - so such a row is kept out of what the
 * exporter is given and reported here instead. The visitor can do nothing about
 * it from this page, which is exactly why they are told: this is the last page
 * they see before their projects have to survive an origin move.
 */
export const TRANSFER_UNIDENTIFIED_ROW_REFUSAL =
	'Cannot be transferred: this origin listed it without a usable project id, so'
	+ ' nothing can address it. It is left out of the transfer; every other project'
	+ ' still crosses.';

/** What the page says about the older of two copies that share one identity. */
export function transferShadowedRowRefusal(holder: string): string {
	return `Cannot be transferred: ${holder} holds a project with the same id, and one`
		+ ' identity can only cross once. Transfer that copy, or rename this one in its'
		+ ' own generation first.';
}

/** What the page says about a store it could not read at all. */
export function transferUnreadableStoreRefusal(reason: string): string {
	return `This storage could not be read, so any projects in it are not listed: ${reason}`;
}

function describeTransferRefusal(refusal: TransferStoreRefusal | null): string | null {
	if (!refusal) return null;
	return refusal.code === 'shadowed'
		? transferShadowedRowRefusal(refusal.holder)
		: TRANSFER_UNIDENTIFIED_ROW_REFUSAL;
}

/** The label for an unidentified row, which has no id to fall back to. */
const UNTITLED_PROJECT = 'Untitled project';

export interface TransferProjectOffer {
	/**
	 * This row's identity for selection, which is what the page ticks and reads
	 * back.
	 *
	 * The project's own id wherever it has one that the exporter would accept.
	 * Where it does not - a row this origin listed without an id, or the older of
	 * two copies sharing one id - it is a generated key that is still distinct
	 * from every other row's. It has to be: the page keys its checkboxes by this
	 * string, and rows that shared one key were selected and deselected together.
	 * A generated key matches no project, which is exactly right for a row that
	 * cannot be exported.
	 */
	readonly projectId: string;
	/** The store's own id, or `null` when this row has none the exporter accepts. */
	readonly storeProjectId: string | null;
	/** Whether this row is a project at all, or a store that could not be read. */
	readonly kind: 'project' | 'store';
	/** Which of this origin's stores listed it. */
	readonly storeId: string;
	readonly storeLabel: string;
	readonly title: string;
	readonly product: TransferProduct | null;
	readonly schemaVersion: number | null;
	/** True only when this project belongs to the product being transferred to. */
	readonly preselected: boolean;
	/** Why this row cannot cross, or `null` when nothing here refuses it. */
	readonly refusal: string | null;
}

export interface ListTransferProjectsOptions {
	readonly store: {
		listProjects(): Promise<readonly unknown[]> | readonly unknown[];
		/** Present only on the federated store; asked for by shape, never imported. */
		listTransferInventory?: () => Promise<TransferStoreInventory> | TransferStoreInventory;
	};
	/** The peer origin's product, or `null` when it cannot be determined. */
	readonly product: TransferProduct | null;
}

/**
 * Read this origin's project listing as a set of offers, in listing order.
 *
 * Reading only: nothing here exports an archive, so opening the page costs one
 * listing per store rather than a full export of every project the visitor
 * happens to have.
 *
 * Every row every store listed becomes an offer, including the ones that cannot
 * cross - a row listed without a usable id, and the older of two copies that
 * share one id. Those are never preselected and carry their own refusal instead
 * of a product phrase. They are *offered* rather than dropped because a row the
 * page hides is a project the visitor never learns about, and this page is the
 * last thing they see before their projects have to survive an origin move.
 *
 * Stores the page could not read at all are listed the same way, one row each:
 * "there may be projects in here and I could not see them" is a fact the visitor
 * needs before they decide the move is done.
 */
export async function listTransferProjects(
	options: ListTransferProjectsOptions,
): Promise<readonly TransferProjectOffer[]> {
	if (options === null || typeof options !== 'object') {
		throw new TypeError('Listing transfer projects needs an options record.');
	}
	const store = options.store;
	if (typeof store?.listProjects !== 'function') {
		throw new TypeError('Listing transfer projects needs a store that can list projects.');
	}
	const inventory = await readTransferInventory(store);
	const offers: TransferProjectOffer[] = [];
	for (const row of inventory.rows) {
		const record = row.project as { title?: unknown; schemaVersion?: unknown } | null;
		const product = transferProjectProduct(record);
		const schemaVersion = typeof record?.schemaVersion === 'number' ? record.schemaVersion : null;
		const title = typeof record?.title === 'string' && record.title.trim() ? record.title : null;
		offers.push(Object.freeze({
			projectId: row.selectionKey,
			storeProjectId: row.projectId,
			kind: 'project' as const,
			storeId: row.storeId,
			storeLabel: row.storeLabel,
			title: title ?? row.projectId ?? UNTITLED_PROJECT,
			product,
			schemaVersion,
			// A row the exporter must never be given is never ticked for the
			// visitor either, whatever product wrote it.
			preselected: row.exportable && options.product !== null && product === options.product,
			refusal: describeTransferRefusal(row.refusal),
		}));
	}
	for (const fault of inventory.unreadable) {
		offers.push(Object.freeze({
			projectId: `${fault.storeId}#unreadable`,
			storeProjectId: null,
			kind: 'store' as const,
			storeId: fault.storeId,
			storeLabel: fault.storeLabel,
			title: fault.storeLabel,
			product: null,
			schemaVersion: null,
			preselected: false,
			refusal: transferUnreadableStoreRefusal(fault.reason),
		}));
	}
	return Object.freeze(offers);
}

/**
 * What the store holds, as rows that know which store they came from.
 *
 * A federated store already knows - it listed several stores to produce one
 * inventory, and it hands that inventory over itself. Anything else is one
 * store, and its rows go through the rule below.
 */
async function readTransferInventory(
	store: ListTransferProjectsOptions['store'],
): Promise<TransferStoreInventory> {
	if (typeof store.listTransferInventory === 'function') return store.listTransferInventory();
	const listed = await store.listProjects();
	if (!Array.isArray(listed)) {
		throw new TypeError('A project store must list projects as an array.');
	}
	return singleStoreInventory(listed);
}

/**
 * The one-store case of the federation's own inventory rule.
 *
 * Deliberately a second copy, and a small one: this module and the federation
 * sit on opposite sides of the transfer page's chunk boundary (see the docblock
 * above), so the rule cannot be shared as a value without putting a hoisted
 * chunk into the standalone page's preload set. What is duplicated is only what
 * a single store needs - the exporter's own id test, and one distinct key per
 * row - and `tests/project-transfer-store-enumeration.test.ts` holds the two
 * copies to the same answer for the same listing.
 */
function singleStoreInventory(listed: readonly unknown[]): TransferStoreInventory {
	const rows: TransferStoreInventoryRow[] = [];
	const held = new Set<string>();
	const admitted = listed.map((project) => {
		const id = (project as { id?: unknown } | null)?.id;
		const projectId = project !== null && typeof project === 'object'
			&& typeof id === 'string' && id.length > 0 && id.length <= MAXIMUM_PROJECT_ID_LENGTH
			? id
			: null;
		const shadowed = projectId !== null && held.has(projectId);
		if (projectId !== null) held.add(projectId);
		return { projectId, shadowed };
	});
	// Every key a real id will take, claimed before the first generated key is
	// minted, so the generated key is the one that moves - a real project whose
	// id happens to read like a generated key keeps its own id, whichever of the
	// two the store listed first.
	const claimed = new Set<string>(
		admitted.filter((row) => row.projectId !== null && !row.shadowed)
			.map((row) => row.projectId as string),
	);
	for (const [index, project] of listed.entries()) {
		const { projectId, shadowed } = admitted[index];
		const exportable = projectId !== null && !shadowed;
		let selectionKey = projectId ?? '';
		if (!exportable) {
			selectionKey = `${UNNAMED_STORE.id}#${index}`;
			while (claimed.has(selectionKey)) selectionKey += '~';
		}
		claimed.add(selectionKey);
		rows.push(Object.freeze({
			selectionKey,
			projectId,
			project,
			storeId: UNNAMED_STORE.id,
			storeLabel: UNNAMED_STORE.label,
			exportable,
			refusal: exportable
				? null
				: shadowed
					? Object.freeze({ code: 'shadowed' as const, holder: UNNAMED_STORE.label })
					: Object.freeze({ code: 'unidentified' as const }),
		}));
	}
	return Object.freeze({ rows: Object.freeze(rows), unreadable: Object.freeze([]) });
}

/**
 * A human phrase for the product column of the confirmation list.
 *
 * A refusal outranks the product name: what the visitor needs from a row that
 * cannot cross is the reason, not which product wrote it.
 *
 * A named store is named here as well. Two generations can hold projects with
 * the same title, and "Interview cut - Framescaper project" twice over is a list
 * a visitor cannot act on; which storage each one is in is the difference
 * between them.
 */
export function describeTransferProduct(offer: TransferProjectOffer): string {
	if (offer.refusal) return offer.refusal;
	const product = describeOfferProduct(offer);
	return offer.storeId === UNNAMED_STORE.id ? product : `${product}, in ${offer.storeLabel}`;
}

function describeOfferProduct(offer: TransferProjectOffer): string {
	if (offer.product === 'framescaper') return 'Framescaper project';
	if (offer.product === 'soundscaper') return 'Soundscaper project';
	return offer.schemaVersion === null
		? 'Project of an unrecognized kind'
		: `Project of an unrecognized kind (schema ${offer.schemaVersion})`;
}
