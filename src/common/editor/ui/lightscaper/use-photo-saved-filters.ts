/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';
import { detachPhotoLibrarySavedCommandV1 } from '../../controller/shared/photo-library-saved-command.ts';
import { PHOTO_LIBRARY_SAVED_COLLECTION_LIMITS_V1 as LIMITS,
	type PhotoLibrarySavedCollectionAcknowledgementV1, type PhotoLibrarySavedCollectionCommandV1,
	type PhotoLibrarySavedCollectionContextV1, type PhotoLibrarySavedCollectionPageV1,
	type PhotoLibrarySavedCollectionSnapshotV1, type PhotoLibrarySavedCollectionSummaryV1 } from '../../photo-library-saved-collection-port-v1.ts';
import type { PhotoLibraryPageV1, PhotoLibrarySessionPortV1 } from '../../photo-library-session-port-v1.ts';

export interface PhotoSavedFilterExecutionContextV1 {
	readonly signal: AbortSignal;
	readonly acquire: () => Promise<Pick<PhotoLibrarySessionPortV1, 'savedCollections'>>;
	readonly isCurrent: () => boolean;
	readonly refresh: () => Promise<PhotoLibraryPageV1 | null>;
	readonly activate: (selection: Readonly<{ kind: 'all' }> | Readonly<{ kind: 'saved'; collectionId: string }>) => Promise<PhotoLibraryPageV1 | null>;
	readonly selectedCollectionId: () => string | null;
	readonly retireSavedSelection: (collectionId: string) => void;
}
export type ExecutePhotoSavedFiltersV1 = (action: (context: PhotoSavedFilterExecutionContextV1) => Promise<void>,
	signal?: AbortSignal) => Promise<'completed' | 'failed' | 'cancelled' | 'busy'>;
export interface PhotoSavedFilterLoadedV1 {
	readonly collectionId: string | null;
	readonly context: PhotoLibrarySavedCollectionContextV1;
	readonly definition: PhotoLibrarySavedCollectionSummaryV1 | null;
}
export type PhotoSavedFilterApplyResultV1 = Readonly<{ outcome: 'acknowledged'; receipt: PhotoLibrarySavedCollectionAcknowledgementV1;
	notice: 'refresh-failed' | null }> | Readonly<{ outcome: 'busy' | 'cancelled' | 'failed' }>;
interface Options { readonly generation: unknown; readonly execute: ExecutePhotoSavedFiltersV1 }
interface View {
	readonly generation: unknown;
	readonly page: PhotoLibrarySavedCollectionPageV1 | null;
	readonly loaded: PhotoSavedFilterLoadedV1 | null;
	readonly receipt: PhotoLibrarySavedCollectionAcknowledgementV1 | null;
	readonly notice: 'refresh-failed' | null;
	readonly error: string | null;
}
const nativeThrow = AbortSignal.prototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

/** Menu authoring borrows the workflow's settlement and writer; no recipe is retained beside the parent's draft. */
export function usePhotoSavedFilters({ generation, execute }: Options) {
	const latest = useRef({ generation, execute }); latest.current = { generation, execute };
	const live = useRef(true), active = useRef<object | null>(null);
	const [busy, setBusy] = useState(false), [view, setView] = useState<View>(() => empty(generation));
	const owner = useRef(view);
	useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	const matches = useCallback(() => live.current && Object.is(latest.current.generation, generation)
		&& latest.current.execute === execute, [generation, execute]);
	const publish = useCallback((patch: Partial<Omit<View, 'generation'>>) => {
		if (!matches()) return;
		const previous = Object.is(owner.current.generation, generation) ? owner.current : empty(generation);
		owner.current = { ...previous, ...patch }; setView(owner.current);
	}, [generation, matches]);
	const run = useCallback(async (action: (context: PhotoSavedFilterExecutionContextV1, current: () => boolean) => Promise<void>) => {
		if (!matches()) return 'cancelled' as const;
		if (active.current) return 'busy' as const;
		const demand = {}; active.current = demand; setBusy(true); publish({ error: null });
		let entered = false, failed = false;
		try {
			const status = await execute(async context => {
				const current = () => matches() && context.isCurrent();
				if (!current()) return;
				entered = true;
				try { checkSignal(context.signal); await action(context, current); }
				catch (failure) {
					if (!cancelled(context.signal, failure)) { failed = true; if (current()) publish({ error: message(failure) }); }
					throw failure;
				}
			});
			if (failed) return 'failed' as const;
			if (status === 'failed') publish({ error: 'The saved filter action failed.' });
			return status === 'completed' && !entered ? 'cancelled' as const : status;
		} catch (failure) { publish({ error: message(failure) }); return 'failed' as const; }
		finally { if (active.current === demand) { active.current = null; if (live.current) setBusy(false); } }
	}, [execute, matches, publish]);
	const readPage = useCallback(async (cursor: string | null = null): Promise<void> => {
		if (!matches() || active.current) return;
		try { boundedCursor(cursor); } catch (failure) { publish({ error: message(failure) }); return; }
		await run(async (context, current) => {
			const session = await context.acquire(); checkSignal(context.signal); if (!current()) return;
			const page = await savedPort(session).readPage({ cursor, signal: context.signal }); checkSignal(context.signal);
			if (current()) publish({ page: copyPage(page) });
		});
	}, [matches, publish, run]);
	const readSnapshot = useCallback(async (collectionId: string | null): Promise<PhotoLibrarySavedCollectionSnapshotV1 | null> => {
		if (!matches() || active.current) return null;
		try { if (collectionId !== null) stableId(collectionId); } catch (failure) { publish({ error: message(failure) }); return null; }
		let result: PhotoLibrarySavedCollectionSnapshotV1 | null = null;
		await run(async (context, current) => {
			publish({ loaded: null });
			const session = await context.acquire(); checkSignal(context.signal); if (!current()) return;
			const snapshot = await savedPort(session).readSnapshot({ collectionId, signal: context.signal }); checkSignal(context.signal);
			if (!current()) return;
			if (snapshot.collectionId !== collectionId || (snapshot.definition !== null && snapshot.definition.id !== collectionId)) {
				throw new Error('Loaded saved filter does not match the requested selection.');
			}
			const definition = snapshot.definition;
			if (definition !== null && new TextEncoder().encode(definition.queryJson).byteLength > LIMITS.maximumQueryJsonBytes) {
				throw new RangeError('Loaded saved filter recipe exceeds its bound.');
			}
			const loaded = Object.freeze({ collectionId, context: copyContext(snapshot.context), definition: definition === null ? null : copySummary(definition) });
			publish({ loaded });
			result = Object.freeze({ ...loaded, definition: definition === null ? null : Object.freeze({ ...loaded.definition!, queryJson: definition.queryJson }) });
		});
		return result;
	}, [matches, publish, run]);
	const apply = useCallback(async (command: PhotoLibrarySavedCollectionCommandV1): Promise<PhotoSavedFilterApplyResultV1> => {
		if (!matches()) return Object.freeze({ outcome: 'cancelled' });
		if (active.current) return Object.freeze({ outcome: 'busy' });
		let admitted: PhotoLibrarySavedCollectionCommandV1;
		try { admitted = detachPhotoLibrarySavedCommandV1(command); }
		catch (failure) { publish({ error: message(failure) }); return Object.freeze({ outcome: 'failed' }); }
		const known: { receipt: PhotoLibrarySavedCollectionAcknowledgementV1 | null; notice: 'refresh-failed' | null } = { receipt: null, notice: null };
		const status = await run(async (context, current) => {
			const refuseActiveDelete = () => {
				if (admitted.type === 'delete' && context.selectedCollectionId() === admitted.collectionId) {
					throw new Error('Show all photos or use another filter before deleting the active saved filter.');
				}
			};
			refuseActiveDelete();
			const session = await context.acquire(); checkSignal(context.signal); if (!current()) return;
			refuseActiveDelete();
			known.receipt = copyReceipt(await savedPort(session).apply(admitted, { signal: context.signal }));
			const acknowledged = { receipt: known.receipt, notice: null, error: null, page: null,
				loaded: Object.freeze({ collectionId: known.receipt.collectionId, context: known.receipt.context, definition: known.receipt.summary }) };
			try {
				const editedActiveId = admitted.type === 'update' && context.selectedCollectionId() === admitted.collectionId ? admitted.collectionId : null;
				// The host independently fences Session authority when authoring controls retire.
				if (editedActiveId !== null) context.retireSavedSelection(editedActiveId);
				if (!current()) return;
				publish(acknowledged);
				checkSignal(context.signal);
				const page = editedActiveId !== null
					? await context.activate(Object.freeze({ kind: 'saved', collectionId: editedActiveId })) : await context.refresh();
				checkSignal(context.signal);
				if (page === null) throw new Error('Saved filter library refresh is unavailable.');
			} catch (failure) {
				known.notice = 'refresh-failed';
				if (current()) publish({ ...acknowledged, notice: known.notice, error: cancelled(context.signal, failure) ? null : message(failure) });
			}
		});
		if (known.receipt !== null) return Object.freeze({ outcome: 'acknowledged', receipt: known.receipt, notice: known.notice });
		return Object.freeze({ outcome: status === 'busy' ? 'busy' : status === 'cancelled' || !matches() ? 'cancelled' : 'failed' });
	}, [matches, publish, run]);
	const use = useCallback(async (collectionId: string): Promise<void> => {
		if (!matches() || active.current) return;
		try { stableId(collectionId); } catch (failure) { publish({ error: message(failure) }); return; }
		await run(async (context, current) => {
			if (!current()) return;
			await context.activate(Object.freeze({ kind: 'saved', collectionId })); checkSignal(context.signal);
		});
	}, [matches, publish, run]);
	const showAll = useCallback(async (): Promise<void> => {
		await run(async (context, current) => {
			if (!current()) return;
			await context.activate(Object.freeze({ kind: 'all' })); checkSignal(context.signal);
		});
	}, [run]);
	const visible = Object.is(view.generation, generation) ? view : empty(generation);
	return { page: visible.page, loaded: visible.loaded, receipt: visible.receipt, notice: visible.notice, error: visible.error,
		busy, readPage, readSnapshot, apply, use, showAll };
}
function empty(generation: unknown): View { return { generation, page: null, loaded: null, receipt: null, notice: null, error: null }; }
function checkSignal(signal: AbortSignal): void { Reflect.apply(nativeThrow, signal, []); }
function cancelled(signal: AbortSignal, value: unknown): boolean {
	return Reflect.apply(nativeAborted, signal, []) === true && value === Reflect.apply(nativeReason, signal, []);
}
function savedPort(session: Pick<PhotoLibrarySessionPortV1, 'savedCollections'>) {
	if (!session.savedCollections) throw new Error('Saved photo filters are unavailable.');
	return session.savedCollections;
}
function stableId(value: string): void {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError('Saved filter requires a stable ID.');
}
function boundedCursor(value: string | null): void {
	if (value !== null && (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > LIMITS.maximumCursorBytes)) {
		throw new TypeError('Saved filter page requires a bounded opaque cursor.');
	}
}
function copyContext(context: PhotoLibrarySavedCollectionContextV1): PhotoLibrarySavedCollectionContextV1 {
	return Object.freeze({ catalogId: context.catalogId, catalogRevision: context.catalogRevision, indexRevision: context.indexRevision,
		collectionStateRevision: context.collectionStateRevision, collectionCount: context.collectionCount });
}
function copySummary(summary: PhotoLibrarySavedCollectionSummaryV1): PhotoLibrarySavedCollectionSummaryV1 {
	return Object.freeze({ id: summary.id, revision: summary.revision, name: summary.name });
}
function copyPage(page: PhotoLibrarySavedCollectionPageV1): PhotoLibrarySavedCollectionPageV1 {
	if (page.items.length > LIMITS.maximumPageItems) throw new RangeError('Saved filter summary page exceeds its 64 row bound.');
	const copy = Object.freeze({ items: Object.freeze(page.items.map(copySummary)), cursor: page.cursor });
	if (new TextEncoder().encode(JSON.stringify(copy)).byteLength > LIMITS.maximumPageBytes) throw new RangeError('Saved filter summary page exceeds its byte bound.');
	return copy;
}
function copyReceipt(receipt: PhotoLibrarySavedCollectionAcknowledgementV1): PhotoLibrarySavedCollectionAcknowledgementV1 {
	return Object.freeze({ outcome: receipt.outcome, collectionId: receipt.collectionId, context: copyContext(receipt.context),
		summary: receipt.summary === null ? null : copySummary(receipt.summary), notices: Object.freeze([...receipt.notices]) });
}
function message(value: unknown): string {
	try {
		const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'message') : undefined;
		if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string') return descriptor.value.slice(0, 2048);
	} catch { /* A hostile failure cannot erase a known acknowledgement. */ }
	return 'The saved filter action failed.';
}
