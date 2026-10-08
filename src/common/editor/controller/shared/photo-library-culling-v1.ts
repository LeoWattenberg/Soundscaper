/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import type { PhotoLibraryPageV1 } from '../../photo-library-session-port-v1.ts';
import { PhotoLibrarySelectionV1, readPhotoLibrarySelectionIdV1, readPhotoLibrarySelectionIdsV1 } from './photo-library-selection-v1.ts';

/** Saved means durable acknowledgement, independently of the subsequent query refresh. */
export type PhotoLibraryCullReceiptV1 =
	| Readonly<{ outcome: 'saved'; photoId: string; page: Readonly<PhotoLibraryPageV1> | null; notice: 'refresh-failed' | null }>
	| Readonly<{ outcome: 'failed' | 'cancelled' | 'busy' }>;
export type PhotoLibraryCullSaveV1 = (signal: AbortSignal) => Promise<PhotoLibraryCullReceiptV1>;
export interface PhotoLibraryCullingSnapshotV1 {
	readonly pendingPhotoId: string | null;
	readonly notice: 'refresh-failed' | null;
}

const SIGNAL_ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const BUSY: PhotoLibraryCullReceiptV1 = Object.freeze({ outcome: 'busy' });
const CANCELLED: PhotoLibraryCullReceiptV1 = Object.freeze({ outcome: 'cancelled' });
const FAILED: PhotoLibraryCullReceiptV1 = Object.freeze({ outcome: 'failed' });

/** One pending edit observer; it owns no document, media body or persistence operation. */
export class PhotoLibraryCullingV1 {
	readonly #selection: PhotoLibrarySelectionV1;
	#active: Readonly<{ photoId: string; controller: AbortController }> | null = null;
	#pending: Promise<PhotoLibraryCullReceiptV1> | null = null;
	#epoch = 0;
	#notice: 'refresh-failed' | null = null;
	#listener: ((snapshot: Readonly<PhotoLibraryCullingSnapshotV1>) => void) | null = null;

	constructor(selection: PhotoLibrarySelectionV1) {
		if (!(selection instanceof PhotoLibrarySelectionV1)) throw new TypeError('Culling requires its bounded selection owner.');
		this.#selection = selection;
	}

	execute(photoId: string, save: PhotoLibraryCullSaveV1, options: Readonly<{ autoAdvance: boolean }>): Promise<PhotoLibraryCullReceiptV1> {
		const id = readPhotoLibrarySelectionIdV1(photoId), input = record(options, 'culling options', ['autoAdvance']);
		const autoAdvance = field(input, 'autoAdvance', 'culling options');
		if (typeof autoAdvance !== 'boolean' || typeof save !== 'function') throw new TypeError('Culling requires an explicit advance choice and save port.');
		if (this.#pending) return Promise.resolve(BUSY);
		const context = this.#selection.capture(), selected = this.#selection.snapshot();
		if (!context.photoIds.includes(id)) throw new RangeError('Culling must target a visible photo.');
		const mayAdvance = autoAdvance && context.singleSelectedId === id && selected.focusedId === id;
		const successors = context.photoIds.slice(context.photoIds.indexOf(id) + 1), controller = new AbortController(), epoch = this.#epoch;
		const job = Object.freeze({ photoId: id, controller }); this.#active = job; this.#notice = null;
		const pending = Promise.resolve().then(async (): Promise<PhotoLibraryCullReceiptV1> => {
			if (aborted(controller.signal)) return CANCELLED;
			let result: PhotoLibraryCullReceiptV1;
			try { result = await save(controller.signal); }
			catch { return aborted(controller.signal) ? CANCELLED : FAILED; }
			const { receipt, ids } = readReceipt(result, id);
			if (receipt.outcome !== 'saved' || epoch !== this.#epoch || aborted(controller.signal)) return receipt;
			if (receipt.page === null) {
				// The workflow may already have published its acknowledged fallback row.
				if (this.#selection.isSameInteraction(context) && this.#selection.snapshot().photoIds.includes(id)) this.#notice = receipt.notice;
				return receipt;
			}
			if (!this.#selection.isCurrent(context, receipt.page)) return receipt;
			this.#notice = null;
			this.#selection.setPage(ids!, { generation: context.generation, pageIdentity: receipt.page });
			if (mayAdvance && epoch === this.#epoch && !aborted(controller.signal) && this.#selection.isCurrent(context, receipt.page)) {
				const next = successors.find(candidate => ids!.includes(candidate));
				if (next) this.#selection.select(next);
			}
			return receipt;
		}).finally(() => {
			if (this.#active === job) { this.#active = null; this.#pending = null; }
			this.#notify();
		});
		// Register before observers or the injected port can cancel/reenter this owner.
		this.#pending = pending; this.#notify(); return pending;
	}

	pause(): Promise<void> {
		this.#epoch++; this.#active?.controller.abort(); this.#notice = null;
		return this.#pending?.then(() => undefined, () => undefined) ?? Promise.resolve();
	}
	async drain(): Promise<void> { while (this.#pending) await this.#pending; }
	snapshot(): Readonly<PhotoLibraryCullingSnapshotV1> {
		return Object.freeze({ pendingPhotoId: this.#active?.photoId ?? null, notice: this.#notice });
	}
	subscribe(listener: (snapshot: Readonly<PhotoLibraryCullingSnapshotV1>) => void): () => void {
		if (typeof listener !== 'function') throw new TypeError('Culling requires a scalar observer.');
		this.#listener = listener; this.#notify();
		return () => { if (this.#listener === listener) this.#listener = null; };
	}
	#notify(): void {
		try { this.#listener?.(this.snapshot()); }
		catch { /* The owner must return and join its pending save even if a UI observer fails. */ }
	}
}

function readReceipt(value: unknown, photoId: string): Readonly<{ receipt: PhotoLibraryCullReceiptV1; ids: readonly string[] | null }> {
	const input = record(value, 'culling receipt', ['outcome', 'photoId', 'page', 'notice'], ['outcome']);
	const outcome = field(input, 'outcome', 'culling receipt');
	if (outcome === 'failed' || outcome === 'cancelled' || outcome === 'busy') {
		record(value, 'unsaved culling receipt', ['outcome']); return { receipt: Object.freeze({ outcome }), ids: null };
	}
	if (outcome !== 'saved') throw new RangeError('Unknown culling outcome.');
	const id = readPhotoLibrarySelectionIdV1(field(input, 'photoId', 'culling receipt'));
	if (id !== photoId) throw new RangeError('Culling acknowledgement belongs to another photo.');
	const page = field(input, 'page', 'culling receipt'), notice = field(input, 'notice', 'culling receipt');
	if (notice !== null && notice !== 'refresh-failed') throw new RangeError('Unknown culling notice.');
	if ((page === null) !== (notice === 'refresh-failed')) throw new TypeError('A saved cull must carry its published page or refresh-failed notice.');
	const ids = page === null ? null : readPageIds(page);
	// Keep the already-published page identity; only its detached IDs enter selection state.
	return { receipt: Object.freeze({ outcome: 'saved', photoId: id, page: page as Readonly<PhotoLibraryPageV1> | null, notice }), ids };
}
function readPageIds(value: unknown): readonly string[] {
	const input = record(value, 'culling page', ['catalogName', 'totalCount', 'rows', 'cursor']);
	text(field(input, 'catalogName', 'culling page'), 256, 'catalog name');
	const count = field(input, 'totalCount', 'culling page');
	if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid culling catalog count.');
	const cursor = field(input, 'cursor', 'culling page'); if (cursor !== null) text(cursor, 2048, 'page cursor');
	const rows = array(field(input, 'rows', 'culling page'), 'culling rows', 0, 64);
	if (rows.length > count) throw new RangeError('Culling page exceeds its catalog count.');
	const ids = rows.map(value => {
		const row = record(value, 'culling row', ['id', 'fileName', 'width', 'height', 'rating', 'flag', 'colorLabel']);
		const id = readPhotoLibrarySelectionIdV1(field(row, 'id', 'culling row'));
		text(field(row, 'fileName', 'culling row'), 256, 'file name');
		for (const key of ['width', 'height']) {
			const dimension = field(row, key, 'culling row');
			if (typeof dimension !== 'number' || !Number.isSafeInteger(dimension) || dimension < 1) throw new RangeError('Invalid culling geometry.');
		}
		const rating = field(row, 'rating', 'culling row');
		if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 0 || rating > 5) throw new RangeError('Invalid culling rating.');
		if (!['unflagged', 'pick', 'reject'].includes(field(row, 'flag', 'culling row') as string)) throw new RangeError('Invalid culling flag.');
		if (!['none', 'red', 'yellow', 'green', 'blue', 'purple'].includes(field(row, 'colorLabel', 'culling row') as string)) throw new RangeError('Invalid culling label.');
		return id;
	});
	return readPhotoLibrarySelectionIdsV1(ids);
}
function text(value: unknown, maximum: number, name: string): void {
	if (typeof value !== 'string' || value.length > maximum) throw new TypeError(`Invalid bounded ${name}.`);
}
function aborted(signal: AbortSignal): boolean { return Reflect.apply(SIGNAL_ABORTED, signal, []) === true; }
