/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import { PhotoLibraryCullingV1, type PhotoLibraryCullReceiptV1, type PhotoLibraryCullSaveV1 } from './photo-library-culling-v1.ts';
import { PhotoLibrarySelectionV1, readPhotoLibrarySelectionIdV1, readPhotoLibrarySelectionIdsV1 } from './photo-library-selection-v1.ts';

export interface PhotoLibrarySurveyContextV1 {
	readonly generation: unknown;
	readonly pageIdentity: unknown;
}
export interface PhotoLibrarySurveySnapshotV1 {
	readonly open: boolean;
	readonly capturedPhotoIds: readonly string[];
	readonly photoIds: readonly string[];
	readonly removedPhotoIds: readonly string[];
	readonly focusedPhotoId: string | null;
	readonly pendingPhotoId: string | null;
	readonly notice: 'refresh-failed' | null;
}
interface Context extends PhotoLibrarySurveyContextV1 { readonly ids: readonly string[] }
interface View {
	readonly captured: readonly string[];
	readonly available: readonly string[];
	readonly ids: readonly string[];
	readonly removed: readonly string[];
	readonly focused: string | null;
}
interface Active {
	readonly photoId: string;
	readonly view: View;
	readonly context: Context;
	readonly epoch: number;
	cancelled: boolean;
}
type Listener = (snapshot: Readonly<PhotoLibrarySurveySnapshotV1>) => void;
const EMPTY: readonly string[] = Object.freeze([]);
const BUSY: PhotoLibraryCullReceiptV1 = Object.freeze({ outcome: 'busy' });
const CANCELLED: PhotoLibraryCullReceiptV1 = Object.freeze({ outcome: 'cancelled' });

/** Menu-owned scalar review; removals never mutate the catalog or media custody. */
export class PhotoLibrarySurveyV1 {
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
	#snapshot: Readonly<PhotoLibrarySurveySnapshotV1> = Object.freeze({ open: false,
		capturedPhotoIds: EMPTY, photoIds: EMPTY, removedPhotoIds: EMPTY,
		focusedPhotoId: null, pendingPhotoId: null, notice: null });

	/** Retire immediately; join any borrowed native save rather than claiming cancellation finished it. */
	setPage(photoIds: readonly string[], context: PhotoLibrarySurveyContextV1): Promise<void> {
		const revision = this.#revision, ids = readPhotoLibrarySelectionIdsV1(photoIds);
		const input = record(context, 'Survey context', ['generation', 'pageIdentity']);
		const next: Context = Object.freeze({ ids, generation: field(input, 'generation', 'Survey context'),
			pageIdentity: field(input, 'pageIdentity', 'Survey context') });
		this.#unchangedAdmission(revision);
		if (this.#context && sameContext(this.#context, next)) {
			if (!sameIds(this.#context.ids, ids)) throw new RangeError('One Survey page identity cannot publish different IDs.');
			return this.#join();
		}
		const sameGeneration = this.#context !== null && Object.is(this.#context.generation, next.generation);
		this.#context = next;
		this.#selection.setPage(ids, { generation: next.generation, pageIdentity: next.pageIdentity });
		this.#view = null;
		// A same-generation page can arrive before its exact own saved receipt.
		// Retiring its review authority must not erase an earlier durable ACK notice.
		if (!sameGeneration) { this.#notice = null; this.#epoch++; if (this.#active) this.#active.cancelled = true; }
		const joining = this.#culling.pause(); this.#revision++; this.#notify();
		return Promise.all([joining, this.#join()]).then(() => undefined);
	}

	open(selectedIds: readonly string[]): void {
		this.#idle(); const revision = this.#revision, selected = readPhotoLibrarySelectionIdsV1(selectedIds);
		this.#unchangedAdmission(revision);
		const context = this.#context;
		if (!context || selected.length < 2 || selected.some(id => !context.ids.includes(id))) {
			throw new RangeError('Survey requires two through64 distinct selected visible photos.');
		}
		const ids = Object.freeze(context.ids.filter(id => selected.includes(id)));
		this.#publishView({ captured: ids, available: ids, ids, removed: EMPTY, focused: ids[0]! });
	}

	focus(photoId: string): void {
		const view = this.#editable(), id = readPhotoLibrarySelectionIdV1(photoId);
		if (!view.ids.includes(id)) throw new RangeError('Survey focus must target a reviewed photo.');
		if (view.focused !== id) this.#publishView({ ...view, focused: id });
	}
	next(): void { this.#navigate(1); }
	previous(): void { this.#navigate(-1); }
	remove(photoId: string): void {
		const view = this.#editable(), id = readPhotoLibrarySelectionIdV1(photoId);
		if (!view.ids.includes(id)) throw new RangeError('Survey removal must target a reviewed photo.');
		const ids = Object.freeze(view.ids.filter(candidate => candidate !== id));
		const removed = Object.freeze(view.available.filter(candidate => view.removed.includes(candidate) || candidate === id));
		this.#publishView({ ...view, ids, removed, focused: nextFocus(view, ids, id, false) });
	}
	restoreRemoved(): void {
		const view = this.#editable();
		if (view.removed.length) this.#publishView({ ...view, ids: view.available, removed: EMPTY,
			focused: view.focused ?? view.available[0] ?? null });
	}

	executeCull(photoId: string, save: PhotoLibraryCullSaveV1,
		options: Readonly<{ autoAdvance: boolean }>): Promise<PhotoLibraryCullReceiptV1> {
		const revision = this.#revision, id = readPhotoLibrarySelectionIdV1(photoId);
		const input = record(options, 'Survey culling options', ['autoAdvance']);
		const autoAdvance = field(input, 'autoAdvance', 'Survey culling options');
		if (typeof autoAdvance !== 'boolean' || typeof save !== 'function') throw new TypeError('Survey requires an explicit advance choice and borrowed save port.');
		this.#unchangedAdmission(revision);
		if (this.#pending) return Promise.resolve(BUSY);
		const view = this.#editable(), context = this.#context!;
		if (!view.ids.includes(id)) throw new RangeError('Survey culling must target a reviewed photo.');
		this.#selection.select(id);
		const active: Active = { photoId: id, view, context, epoch: this.#epoch, cancelled: false };
		this.#active = active; this.#notice = null;
		const pending = Promise.resolve().then(async () => {
			if (active.cancelled || active.epoch !== this.#epoch || this.#context !== active.context) return CANCELLED;
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
		this.#view = null; this.#notice = null; this.#epoch++; this.#revision++;
		const joining = this.cancelAndJoin(); if (changed) this.#notify(); return joining;
	}
	async drain(): Promise<void> { while (this.#pending) await this.#pending; }
	snapshot(): Readonly<PhotoLibrarySurveySnapshotV1> { return this.#snapshot; }
	subscribe(listener: Listener): () => void {
		if (typeof listener !== 'function') throw new TypeError('Survey requires a scalar observer.');
		if (this.#listeners.size >= 64) throw new RangeError('Survey admits at most64 observers.');
		const token = {}; this.#listeners.set(token, listener);
		try { listener(this.#snapshot); } catch { /* Observers cannot veto state or ACK ownership. */ }
		return () => { this.#listeners.delete(token); };
	}

	#reconcile(active: Active, receipt: Extract<PhotoLibraryCullReceiptV1, { outcome: 'saved' }>, advance: boolean): void {
		const context = this.#context;
		if (active.cancelled || active.epoch !== this.#epoch || !context || !Object.is(context.generation, active.context.generation)) return;
		if (receipt.page === null) { this.#view = null; this.#notice = 'refresh-failed'; return; }
		if (!Object.is(context.pageIdentity, active.context.pageIdentity) && !Object.is(context.pageIdentity, receipt.page)) return;
		// Shared Culling validates the entire receipt. Descriptors detach only its
		// scalar IDs; the exact published page remains an opaque authority token.
		const rows = array(field(record(receipt.page, 'Survey acknowledged page', ['catalogName', 'totalCount', 'rows', 'cursor']),
			'rows', 'Survey acknowledged page'), 'Survey acknowledged rows', 0, 64);
		const pageIds = readPhotoLibrarySelectionIdsV1(rows.map(row => field(record(row, 'Survey acknowledged row',
			['id', 'fileName', 'width', 'height', 'rating', 'flag', 'colorLabel']), 'id', 'Survey acknowledged row')));
		if (active.cancelled || active.epoch !== this.#epoch || this.#context !== context) return;
		if (Object.is(context.pageIdentity, receipt.page) && !sameIds(context.ids, pageIds)) {
			// A conflicting presentation identity cannot revoke a validated durable ACK.
			this.#view = null; this.#notice = null; return;
		}
		this.#context = Object.freeze({ generation: context.generation, pageIdentity: receipt.page, ids: pageIds });
		this.#selection.setPage(pageIds, { generation: context.generation, pageIdentity: receipt.page });
		// Query-excluded captures never become new review matches on a later ACK.
		const available = Object.freeze(active.view.available.filter(id => pageIds.includes(id)));
		const removed = Object.freeze(active.view.removed.filter(id => available.includes(id)));
		const ids = Object.freeze(available.filter(id => !removed.includes(id)));
		this.#view = Object.freeze({ captured: active.view.captured, available, ids, removed,
			focused: nextFocus(active.view, ids, active.photoId, advance) });
		this.#notice = null;
	}
	#navigate(direction: 1 | -1): void {
		const view = this.#editable(); if (view.focused === null) return;
		const focused = view.ids[view.ids.indexOf(view.focused) + direction];
		if (focused) this.#publishView({ ...view, focused });
	}
	#publishView(view: View): void {
		this.#view = Object.freeze(view); this.#notice = null; this.#epoch++; this.#revision++; this.#notify();
	}
	#editable(): View { this.#idle(); if (!this.#view) throw new Error('Survey is closed.'); return this.#view; }
	#idle(): void { if (this.#pending) throw new Error('A Survey cull is already pending.'); }
	#unchangedAdmission(revision: number): void {
		if (revision !== this.#revision) throw new Error('Survey ownership changed during admission.');
	}
	#join(): Promise<void> { return this.#pending?.then(() => undefined, () => undefined) ?? Promise.resolve(); }
	#notify(): void {
		this.#snapshot = Object.freeze({ open: this.#view !== null,
			capturedPhotoIds: this.#view?.captured ?? EMPTY, photoIds: this.#view?.ids ?? EMPTY,
			removedPhotoIds: this.#view?.removed ?? EMPTY, focusedPhotoId: this.#view?.focused ?? null,
			pendingPhotoId: this.#active?.photoId ?? null, notice: this.#notice });
		if (this.#notifying) return;
		this.#notifying = true;
		try {
			// Reentered mutations publish a new snapshot. Give remaining observers
			// that current publication, with at most64 bounded notification passes.
			for (let pass = 0; pass < 64; pass++) {
				const snapshot = this.#snapshot;
				// Snapshot tokens too: remove/re-add cannot extend this iteration.
				for (const [token, listener] of [...this.#listeners]) {
					if (snapshot !== this.#snapshot) break;
					if (this.#listeners.has(token)) try { listener(snapshot); } catch { /* Observers cannot revoke ACKs. */ }
				}
				if (snapshot === this.#snapshot) break;
			}
		} finally { this.#notifying = false; }
	}
}

function nextFocus(view: View, ids: readonly string[], culledId: string, advance: boolean): string | null {
	const focused = view.focused; if (focused === null) return ids[0] ?? null;
	if (ids.includes(focused) && (!advance || culledId !== focused)) return focused;
	const index = view.ids.indexOf(focused);
	const next = view.ids.slice(index + 1).find(id => ids.includes(id));
	if (next) return next;
	if (ids.includes(focused)) return focused;
	return view.ids.slice(0, index).reverse().find(id => ids.includes(id)) ?? ids[0] ?? null;
}
function sameContext(left: PhotoLibrarySurveyContextV1, right: PhotoLibrarySurveyContextV1): boolean {
	return Object.is(left.generation, right.generation) && Object.is(left.pageIdentity, right.pageIdentity);
}
function sameIds(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((id, index) => id === right[index]);
}
