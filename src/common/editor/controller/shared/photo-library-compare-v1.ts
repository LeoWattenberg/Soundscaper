/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import { PhotoLibraryCullingV1, type PhotoLibraryCullReceiptV1, type PhotoLibraryCullSaveV1 } from './photo-library-culling-v1.ts';
import { PhotoLibrarySelectionV1, readPhotoLibrarySelectionIdV1, readPhotoLibrarySelectionIdsV1 } from './photo-library-selection-v1.ts';

export interface PhotoLibraryCompareContextV1 {
	readonly generation: unknown;
	readonly pageIdentity: unknown;
}
export interface PhotoLibraryCompareSnapshotV1 {
	readonly open: boolean;
	readonly photoIds: readonly string[];
	readonly referenceId: string | null;
	readonly candidateId: string | null;
	readonly pendingPhotoId: string | null;
	readonly notice: 'refresh-failed' | null;
}
interface Context extends PhotoLibraryCompareContextV1 { readonly ids: readonly string[] }
interface View { readonly ids: readonly string[]; readonly reference: string; readonly candidate: string }
interface Active {
	readonly photoId: string;
	readonly view: View;
	readonly context: Context;
	readonly epoch: number;
	cancelled: boolean;
}
type Listener = (snapshot: Readonly<PhotoLibraryCompareSnapshotV1>) => void;
const EMPTY: readonly string[] = Object.freeze([]);
const BUSY: PhotoLibraryCullReceiptV1 = Object.freeze({ outcome: 'busy' });
const CANCELLED: PhotoLibraryCullReceiptV1 = Object.freeze({ outcome: 'cancelled' });

/** Menu-owned scalar comparison; no resource factory, document, body or DOM owner. */
export class PhotoLibraryCompareV1 {
	readonly #selection = new PhotoLibrarySelectionV1();
	readonly #culling = new PhotoLibraryCullingV1(this.#selection);
	readonly #listeners = new Map<object, Listener>();
	#context: Context | null = null;
	#view: View | null = null;
	#active: Active | null = null;
	#pending: Promise<PhotoLibraryCullReceiptV1> | null = null;
	#epoch = 0;
	#revision = 0;
	#notice: 'refresh-failed' | null = null;
	#notifying = false;
	#snapshot: Readonly<PhotoLibraryCompareSnapshotV1> = Object.freeze({ open: false, photoIds: EMPTY,
		referenceId: null, candidateId: null, pendingPhotoId: null, notice: null });

	/** Retire immediately and return a settlement barrier, including native late ACKs. */
	setPage(photoIds: readonly string[], context: PhotoLibraryCompareContextV1): Promise<void> {
		const revision = this.#revision, ids = readPhotoLibrarySelectionIdsV1(photoIds);
		const input = record(context, 'Compare context', ['generation', 'pageIdentity']);
		const next: Context = Object.freeze({ ids, generation: field(input, 'generation', 'Compare context'),
			pageIdentity: field(input, 'pageIdentity', 'Compare context') });
		this.#unchangedAdmission(revision);
		if (this.#context && sameContext(this.#context, next)) {
			if (!sameIds(this.#context.ids, ids)) throw new RangeError('One Compare page identity cannot publish different IDs.');
			return this.#join();
		}
		const sameGeneration = this.#context !== null && Object.is(this.#context.generation, next.generation);
		this.#context = next; this.#selection.setPage(ids, { generation: next.generation, pageIdentity: next.pageIdentity }); this.#view = null;
		// Retiring page authority does not erase a same-generation durable ACK fact.
		if (!sameGeneration) { this.#notice = null; this.#epoch++; if (this.#active) this.#active.cancelled = true; }
		// An early React page may be our own acknowledged page. Keep its captured
		// scalar pair until the exact receipt identity proves that association.
		const joining = this.#culling.pause(); this.#revision++; this.#notify();
		return Promise.all([joining, this.#join()]).then(() => undefined);
	}

	open(selectedIds: readonly string[]): void {
		this.#idle(); const revision = this.#revision, selected = readPhotoLibrarySelectionIdsV1(selectedIds);
		this.#unchangedAdmission(revision);
		const context = this.#context;
		if (!context || selected.length < 2 || selected.some(id => !context.ids.includes(id))) {
			throw new RangeError('Compare requires two through64 distinct selected visible photos.');
		}
		const ids = Object.freeze(context.ids.filter(id => selected.includes(id)));
		this.#view = Object.freeze({ ids, reference: ids[0]!, candidate: ids[1]! });
		this.#notice = null; this.#epoch++; this.#revision++; this.#notify();
	}

	next(): void { this.#navigate(1); }
	previous(): void { this.#navigate(-1); }
	swap(): void {
		const view = this.#editable();
		this.#publishView({ ...view, reference: view.candidate, candidate: view.reference });
	}
	promoteCandidate(): void {
		const view = this.#editable(), index = view.ids.indexOf(view.candidate);
		const candidate = view.ids.slice(index + 1).find(id => id !== view.candidate) ?? view.reference;
		this.#publishView({ ...view, reference: view.candidate, candidate });
	}

	executeCull(photoId: string, save: PhotoLibraryCullSaveV1,
		options: Readonly<{ autoAdvance: boolean }>): Promise<PhotoLibraryCullReceiptV1> {
		const revision = this.#revision, id = readPhotoLibrarySelectionIdV1(photoId);
		const input = record(options, 'Compare culling options', ['autoAdvance']), autoAdvance = field(input, 'autoAdvance', 'Compare culling options');
		if (typeof autoAdvance !== 'boolean' || typeof save !== 'function') throw new TypeError('Compare requires an explicit advance choice and borrowed save port.');
		this.#unchangedAdmission(revision);
		if (this.#pending) return Promise.resolve(BUSY);
		const view = this.#editable(), context = this.#context!;
		if (id !== view.reference && id !== view.candidate) throw new RangeError('Compare culling must target one displayed side.');
		this.#selection.select(id);
		const active: Active = { photoId: id, view, context, epoch: this.#epoch, cancelled: false };
		this.#active = active; this.#notice = null;
		const pending = Promise.resolve().then(async () => {
			if (active.cancelled || active.epoch !== this.#epoch) return CANCELLED;
			const receipt = await this.#culling.execute(id, save, { autoAdvance: false });
			if (receipt.outcome === 'saved') this.#reconcile(active, receipt, autoAdvance);
			return receipt;
		}).finally(() => {
			if (this.#active === active) { this.#active = null; this.#pending = null; }
			this.#revision++; this.#notify();
		});
		// Exclusion exists before observers, borrowed ports or cancellation reenter.
		this.#pending = pending; this.#revision++; this.#notify(); return pending;
	}

	cancelAndJoin(): Promise<void> {
		if (this.#active && !this.#active.cancelled) {
			this.#active.cancelled = true; this.#epoch++; this.#revision++;
		}
		return Promise.all([this.#culling.pause(), this.#join()]).then(() => undefined);
	}
	close(): Promise<void> {
		const changed = this.#view !== null || this.#notice !== null;
		this.#view = null; this.#notice = null; this.#epoch++;
		const joining = this.cancelAndJoin();
		if (changed) { this.#revision++; this.#notify(); }
		return joining;
	}
	async drain(): Promise<void> { while (this.#pending) await this.#pending; }
	snapshot(): Readonly<PhotoLibraryCompareSnapshotV1> { return this.#snapshot; }
	subscribe(listener: Listener): () => void {
		if (typeof listener !== 'function') throw new TypeError('Compare requires a scalar observer.');
		if (this.#listeners.size >= 64) throw new RangeError('Compare admits at most64 observers.');
		const token = {}; this.#listeners.set(token, listener);
		try { listener(this.#snapshot); } catch { /* Observers cannot veto state or ACK ownership. */ }
		return () => { this.#listeners.delete(token); };
	}

	#reconcile(active: Active, receipt: Extract<PhotoLibraryCullReceiptV1, { outcome: 'saved' }>, advance: boolean): void {
		const context = this.#context;
		if (active.cancelled || active.epoch !== this.#epoch || !context || !Object.is(context.generation, active.context.generation)) return;
		if (receipt.page === null) {
			// A same-generation fallback can retire the pair before its durable ACK
			// settles. Retain the notice without granting that page Compare authority.
			this.#notice = 'refresh-failed';
			return;
		}
		if (!Object.is(context.pageIdentity, active.context.pageIdentity) && !Object.is(context.pageIdentity, receipt.page)) return;
		// Shared Culling already validates the full receipt/page. Read detached IDs
		// through descriptors as the published page itself remains an opaque token.
		const rows = array(field(record(receipt.page, 'Compare acknowledged page', ['catalogName', 'totalCount', 'rows', 'cursor']),
			'rows', 'Compare acknowledged page'), 'Compare acknowledged rows', 0, 64);
		const pageIds = readPhotoLibrarySelectionIdsV1(rows.map(row => field(record(row, 'Compare acknowledged row',
			['id', 'fileName', 'width', 'height', 'rating', 'flag', 'colorLabel']), 'id', 'Compare acknowledged row')));
		if (active.cancelled || active.epoch !== this.#epoch || this.#context !== context) return;
		if (Object.is(context.pageIdentity, receipt.page) && !sameIds(context.ids, pageIds)) {
			// A presentation identity conflict cannot revoke the validated durable ACK.
			this.#view = null; this.#notice = null; return;
		}
		this.#context = Object.freeze({ generation: context.generation, pageIdentity: receipt.page, ids: pageIds });
		this.#selection.setPage(pageIds, { generation: context.generation, pageIdentity: receipt.page });
		const ids = Object.freeze(active.view.ids.filter(id => pageIds.includes(id)));
		if (ids.length < 2) { this.#view = null; this.#notice = null; return; }
		const reference = ids.includes(active.view.reference) ? active.view.reference : ids[0]!;
		const successors = active.view.ids.slice(active.view.ids.indexOf(active.view.candidate) + 1);
		const successor = successors.find(id => id !== reference && ids.includes(id));
		const retained = ids.includes(active.view.candidate) && active.view.candidate !== reference ? active.view.candidate : null;
		const candidate = advance && active.photoId === active.view.candidate ? successor ?? retained : retained;
		this.#view = Object.freeze({ ids, reference, candidate: candidate ?? successor ?? ids.find(id => id !== reference)! });
		this.#notice = null;
	}
	#navigate(direction: 1 | -1): void {
		const view = this.#editable(), candidates = view.ids.filter(id => id !== view.reference), index = candidates.indexOf(view.candidate);
		const candidate = candidates[index + direction];
		if (candidate) this.#publishView({ ...view, candidate });
	}
	#publishView(view: View): void {
		this.#view = Object.freeze(view); this.#notice = null; this.#epoch++; this.#revision++; this.#notify();
	}
	#editable(): View {
		this.#idle(); if (!this.#view) throw new Error('Compare is closed.'); return this.#view;
	}
	#idle(): void { if (this.#pending) throw new Error('A Compare cull is already pending.'); }
	#unchangedAdmission(revision: number): void {
		if (revision !== this.#revision) throw new Error('Compare ownership changed during admission.');
	}
	#join(): Promise<void> { return this.#pending?.then(() => undefined, () => undefined) ?? Promise.resolve(); }
	#notify(): void {
		const snapshot = this.#snapshot = Object.freeze({ open: this.#view !== null, photoIds: this.#view?.ids ?? EMPTY,
			referenceId: this.#view?.reference ?? null, candidateId: this.#view?.candidate ?? null,
			pendingPhotoId: this.#active?.photoId ?? null, notice: this.#notice });
		if (this.#notifying) return;
		this.#notifying = true;
		try {
			for (const [token, listener] of this.#listeners) {
				if (snapshot !== this.#snapshot) break;
				if (this.#listeners.has(token)) try { listener(snapshot); } catch { /* Observers cannot revoke ACKs. */ }
			}
		} finally { this.#notifying = false; }
	}
}

function sameContext(left: PhotoLibraryCompareContextV1, right: PhotoLibraryCompareContextV1): boolean {
	return Object.is(left.generation, right.generation) && Object.is(left.pageIdentity, right.pageIdentity);
}
function sameIds(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((id, index) => id === right[index]);
}
