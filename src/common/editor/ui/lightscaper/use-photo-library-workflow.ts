/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoLibraryCullReceiptV1 } from '../../controller/shared/photo-library-culling-v1.ts';
import { createPhotoLibraryImportCollectorV1, detachPhotoLibraryImportSettingsV1 } from '../../controller/shared/photo-library-import-gesture-v1.ts';
import type { PhotoLibraryImportGestureReceiptV1, PhotoLibraryImportPresetCommandV1, PhotoLibraryImportPresetSnapshotV1,
	PhotoLibraryImportRequestOptionsV1 } from '../../photo-library-import-settings-port-v1.ts';
import type { PhotoLibraryDefinitionAcknowledgementV1, PhotoLibraryDefinitionCommandV1, PhotoLibraryDefinitionReadRequestV1,
	PhotoLibraryMembershipPatchV1, PhotoLibraryMembershipSnapshotV1 } from '../../photo-library-organization-port-v1.ts';
import type { CreatePhotoLibrarySessionV1, PhotoLibraryAttributePatchV1, PhotoLibraryImportItemV1, PhotoLibraryMetadataPatchV1, PhotoLibraryMetadataSnapshotV1, PhotoLibraryDefinitionPageRequestV1, PhotoLibraryQueryBuildProgressV1, PhotoLibraryQueryV1, PhotoLibraryPreviewTierV1, PhotoLibraryPageV1, PhotoLibraryRowV1, PhotoLibrarySessionPortV1 } from '../../photo-library-session-port-v1.ts';

interface SessionSlot {
	live: boolean;
	readonly factory: CreatePhotoLibrarySessionV1 | undefined;
	readonly lifetime: AbortController;
	readonly beforeDrain: Promise<void> | null;
	pending: Promise<PhotoLibrarySessionPortV1> | null;
	active: AbortController | null;
	query: PhotoLibraryQueryV1 | null;
	page: PhotoLibraryPageV1 | null;
}
type WorkflowAction = (owner: PhotoLibrarySessionPortV1, signal: AbortSignal, current: SessionSlot) => Promise<void>;
type ActionStatus = 'completed' | 'failed' | 'cancelled' | 'busy';
const getFileName = Object.getOwnPropertyDescriptor(File.prototype, 'name')?.get;

/** The effect owns one resource generation, including factories resolving after cleanup. */
export function usePhotoLibraryWorkflow(createSession?: CreatePhotoLibrarySessionV1) {
	const factory = useRef(createSession); factory.current = createSession;
	const slot = useRef<SessionSlot | null>(null);
	const retiring = useRef<Promise<void> | null>(null);
	const [page, setPage] = useState<PhotoLibraryPageV1 | null>(null);
	const [receipts, setReceipts] = useState<readonly PhotoLibraryImportItemV1[]>([]);
	const [importReceipt, setImportReceipt] = useState<PhotoLibraryImportGestureReceiptV1 | null>(null);
	const [metadata, setMetadata] = useState<PhotoLibraryMetadataSnapshotV1 | null>(null);
	const [memberships, setMemberships] = useState<PhotoLibraryMembershipSnapshotV1 | null>(null);
	const [busy, setBusy] = useState(false);
	const [query, setQuery] = useState<PhotoLibraryQueryV1 | null>(null);
	const [needsQueryIndex, setNeedsQueryIndex] = useState(false);
	const [queryIndexProgress, setQueryIndexProgress] = useState<PhotoLibraryQueryBuildProgressV1 | null>(null);
	const [error, setError] = useState<string | null>(null);
	const publishPage = useCallback((current: SessionSlot, next: PhotoLibraryPageV1 | null) => {
		if (!current.live) return null;
		current.page = next; setPage(next); return next;
	}, []);
	useEffect(() => {
		const current: SessionSlot = { live: true, factory: createSession, lifetime: new AbortController(),
			beforeDrain: retiring.current, pending: null, active: null, query: null, page: null };
		slot.current = current;
		queueMicrotask(() => {
			if (!current.live) return;
			setQuery(null); setNeedsQueryIndex(false); setQueryIndexProgress(null);
			publishPage(current, null); setMetadata(null); setMemberships(null); setReceipts([]); setImportReceipt(null); setError(null); setBusy(current.active !== null);
		});
		return () => {
			current.live = false; current.lifetime.abort(); current.active?.abort();
			if (slot.current === current) slot.current = null;
			const pending = current.pending;
			const closing = (async () => {
				if (current.beforeDrain) await current.beforeDrain;
				const owner = await pending?.catch(() => null);
				await owner?.close();
			})();
			retiring.current = closing;
			void closing.catch(() => undefined);
		};
	}, [createSession, publishPage]);

	const perform = useCallback(async (action: WorkflowAction, externalSignal?: AbortSignal): Promise<ActionStatus> => {
		const current = slot.current;
		if (!current?.live || current.factory !== createSession) return 'cancelled';
		if (current.active) return 'busy';
		const active = new AbortController(); current.active = active;
		const signal = AbortSignal.any([active.signal, current.lifetime.signal, ...(externalSignal ? [externalSignal] : [])]);
		setBusy(true); setError(null);
		try {
			signal.throwIfAborted();
			const owner = await acquire(current);
			signal.throwIfAborted();
			await action(owner, signal, current);
			return 'completed';
		} catch (failure) {
			if (current.live) {
				if (!signal.aborted && errorCode(failure) === 'PHOTO_QUERY_INDEX_NOT_READY') { setNeedsQueryIndex(true); setError(null); }
				else setError(signal.aborted ? null : message(failure));
			}
			return signal.aborted ? 'cancelled' : 'failed';
		} finally {
			if (current.live) setBusy(false);
			current.active = null;
		}
	}, [createSession]);
	const run = useCallback(async (action: WorkflowAction): Promise<void> => { await perform(action); }, [perform]);

	const readPreview = useCallback(async (photoId: string, tier: PhotoLibraryPreviewTierV1,
		options: Readonly<{ signal?: AbortSignal }> = {}) => {
		const current = slot.current;
		if (!current?.live || current.factory !== createSession) throw new DOMException('Photo preview generation is closed.', 'AbortError');
		const signal = options.signal ? AbortSignal.any([options.signal, current.lifetime.signal]) : current.lifetime.signal;
		signal.throwIfAborted();
		const owner = await acquire(current); signal.throwIfAborted();
		const result = await owner.readPreview(photoId, tier, { signal }); signal.throwIfAborted();
		return result;
	}, [createSession]);

	const readPage = useCallback((cursor: string | null = null) => run(async (owner, signal, current) => {
		const next = current.query ? await readNonemptyQueryPage(owner, current.query, cursor, signal) : await owner.readPage({ cursor, signal });
		publishPage(current, next);
	}), [run, publishPage]);
	const applyQuery = (nextQuery: PhotoLibraryQueryV1) => run(async (owner, signal, current) => {
		const next = await readNonemptyQueryPage(owner, nextQuery, null, signal);
		if (current.live) { current.query = nextQuery; setQuery(nextQuery); setNeedsQueryIndex(false); publishPage(current, next); }
	});
	const probeQuery = () => run(async (owner, signal, current) => {
		await owner.readQueryStep({ query: current.query ?? DEFAULT_QUERY, signal });
		signal.throwIfAborted(); if (current.live) setNeedsQueryIndex(false);
	});
	const buildQueryIndex = () => run(async (owner, signal, current) => {
		let processed = 0, readBytes = 0;
		while (true) {
			signal.throwIfAborted();
			const next = await owner.rebuildQueryStep({ signal }); signal.throwIfAborted();
			processed += next.processed; readBytes += next.readBytes;
			if (current.live) setQueryIndexProgress(Object.freeze({ processed, readBytes, ready: next.ready }));
			if (next.ready) { if (current.live) setNeedsQueryIndex(false); return; }
			await yieldTask(signal);
		}
	});
	const readDefinitions = useCallback(async (request: PhotoLibraryDefinitionPageRequestV1) => {
		const current = slot.current;
		if (!current?.live || current.factory !== createSession) throw new DOMException('Definition page generation is closed.', 'AbortError');
		const signal = request.signal ? AbortSignal.any([request.signal, current.lifetime.signal]) : current.lifetime.signal;
		signal.throwIfAborted();
		const owner = await acquire(current); signal.throwIfAborted();
		const result = await owner.readDefinitionPage({ ...request, signal }); signal.throwIfAborted(); return result;
	}, [createSession]);
	const readDefinition = useCallback(async (request: PhotoLibraryDefinitionReadRequestV1) => {
		const current = slot.current;
		if (!current?.live || current.factory !== createSession) throw new DOMException('Definition generation is closed.', 'AbortError');
		const signal = request.signal ? AbortSignal.any([request.signal, current.lifetime.signal]) : current.lifetime.signal;
		signal.throwIfAborted();
		const owner = await acquire(current); signal.throwIfAborted();
		const result = await owner.readDefinition({ ...request, signal }); signal.throwIfAborted(); return result;
	}, [createSession]);

	const readImportPresets = useCallback(async (options: Readonly<{ signal?: AbortSignal }> = {}) => {
		const current = slot.current;
		if (!current?.live || current.factory !== createSession) throw new DOMException('Import preset generation is closed.', 'AbortError');
		const signal = options.signal ? AbortSignal.any([options.signal, current.lifetime.signal]) : current.lifetime.signal;
		signal.throwIfAborted(); const owner = await acquire(current); signal.throwIfAborted();
		const result = await owner.readImportPresets({ signal }); signal.throwIfAborted(); return result;
	}, [createSession]);
	const applyImportPreset = useCallback(async (command: PhotoLibraryImportPresetCommandV1, options: Readonly<{ signal?: AbortSignal }> = {}) => {
		const result: { ack?: PhotoLibraryImportPresetSnapshotV1; failure?: Readonly<{ value: unknown }> } = {};
		const status = await perform(async (owner, signal) => {
			try { result.ack = await owner.applyImportPreset(command, { signal }); }
			catch (failure) { result.failure = { value: failure }; throw failure; }
		}, options.signal);
		if (result.ack) return result.ack;
		if (result.failure) throw result.failure.value;
		if (status === 'cancelled') throw new DOMException('Import preset authoring was cancelled.', 'AbortError');
		throw new Error(status === 'busy' ? 'A photo library change is already pending.' : 'Import preset authoring failed.');
	}, [perform]);
	const importFiles = useCallback(async (files: readonly File[], options: Pick<PhotoLibraryImportRequestOptionsV1, 'settings' | 'signal'> = {}): Promise<PhotoLibraryImportGestureReceiptV1> => {
		const admission = slot.current;
		if (!admission?.live || admission.factory !== factory.current || options.signal?.aborted) return Object.freeze({ outcome: 'cancelled' });
		if (admission.active) return Object.freeze({ outcome: 'busy' });
		// Capture authored state and original source names before the lazy factory can yield.
		let draft;
		try {
			if (files.length < 1 || files.length > 64) throw new RangeError('Import requires one through 64 selected Files.');
			const selected = Object.freeze([...files]);
			const names = selected.map(file => { const name: unknown = getFileName?.call(file);
				if (typeof name !== 'string') throw new TypeError('Import requires selected source Files.'); return name; });
			draft = { selected, collector: createPhotoLibraryImportCollectorV1(names),
				settings: options.settings === undefined ? undefined : detachPhotoLibraryImportSettingsV1(options.settings) };
		} catch (failure) {
			const current = slot.current;
			if (!current?.live || current.factory !== createSession || options.signal?.aborted) return Object.freeze({ outcome: 'cancelled' });
			if (current.active) return Object.freeze({ outcome: 'busy' });
			setError(message(failure)); return Object.freeze({ outcome: 'failed' });
		}
		const { selected, collector, settings } = draft;
		setReceipts([]); setImportReceipt(null);
		let receipt: PhotoLibraryImportGestureReceiptV1 | null = null;
		const publication: { generation?: SessionSlot } = {};
		const status = await perform(async (owner, signal, current) => {
			publication.generation = current; setImportReceipt(null);
			const publish = () => {
				if (!current.live || current.factory !== factory.current) return;
				setReceipts(collector.snapshot());
				if (current.page) publishPage(current, Object.freeze({ ...current.page, cursor: null }));
			};
			let observing = true;
			try {
				const results = await owner.importFiles(selected, { signal, ...(settings === undefined ? {} : { settings }),
					onAcknowledged: item => { if (observing && collector.acknowledge(item)) publish(); } });
				observing = false;
				collector.finish(results);
				receipt = Object.freeze({ outcome: 'acknowledged', items: collector.snapshot(), completion: 'finished', notice: 'refresh-failed' });
			} catch (failure) {
				observing = false;
				if (collector.hasAcknowledgement()) receipt = Object.freeze({ outcome: 'acknowledged', items: collector.snapshot(),
					completion: signal.aborted ? 'cancelled' : 'failed', notice: 'refresh-failed' });
				publish(); throw failure;
			}
			publish(); signal.throwIfAborted();
			const next = current.query ? await readNonemptyQueryPage(owner, current.query, null, signal) : await owner.readPage({ signal });
			signal.throwIfAborted();
			if (publishPage(current, next)) receipt = Object.freeze({ outcome: 'acknowledged', items: collector.snapshot(), completion: 'finished', notice: null });
		}, options.signal);
		if (publication.generation?.live && slot.current === publication.generation && publication.generation.factory === factory.current) setImportReceipt(receipt);
		return receipt ?? Object.freeze({ outcome: status === 'completed' ? 'failed' : status });
	}, [createSession, perform, publishPage]);
	const refreshQuery = async (owner: PhotoLibrarySessionPortV1, signal: AbortSignal, current: SessionSlot) => {
		if (!current.query) return current.live ? current.page : null;
		const next = await readNonemptyQueryPage(owner, current.query, null, signal);
		return publishPage(current, next);
	};
	const updateRow = (updated: PhotoLibraryRowV1, current: SessionSlot) => {
		const previous = current.page;
		return publishPage(current, previous ? Object.freeze({ ...previous, cursor: null,
			rows: Object.freeze(previous.rows.map(row => row.id === updated.id ? updated : row)) }) : null);
	};
	const editAttributes = async (save: (owner: PhotoLibrarySessionPortV1, signal: AbortSignal) => Promise<PhotoLibraryRowV1>,
		options: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryCullReceiptV1> => {
		let receipt: PhotoLibraryCullReceiptV1 | null = null;
		const status = await perform(async (owner, signal, current) => {
			const updated = await save(owner, signal);
			// The durable acknowledgement remains saved even if refresh or cancellation follows.
			receipt = Object.freeze({ outcome: 'saved', photoId: updated.id, page: null, notice: 'refresh-failed' });
			try {
				// A successful query publishes one final page; an intermediate page would
				// invalidate the culling observer's captured page identity while awaiting it.
				const next = current.query ? await refreshQuery(owner, signal, current) : updateRow(updated, current);
				if (next) receipt = Object.freeze({ outcome: 'saved', photoId: updated.id, page: next, notice: null });
			} catch (failure) { updateRow(updated, current); throw failure; }
		}, options.signal);
		return receipt ?? Object.freeze({ outcome: status === 'completed' ? 'failed' : status });
	};
	const setRating = (photoId: string, rating: number, options: Readonly<{ signal?: AbortSignal }> = {}) =>
		editAttributes((owner, signal) => owner.setRating(photoId, rating, { signal }), options);
	const applyAttributes = (photoId: string, changes: PhotoLibraryAttributePatchV1, options: Readonly<{ signal?: AbortSignal }> = {}) =>
		editAttributes((owner, signal) => owner.applyAttributes(photoId, changes, { signal }), options);
	const readMetadata = useCallback((photoId: string) => run(async (owner, signal, current) => {
		setMetadata(null);
		const next = await owner.readMetadata(photoId, { signal });
		if (current.live) setMetadata(next);
	}), [run]);
	const applyMetadata = (photoId: string, expectedRevision: number, changes: PhotoLibraryMetadataPatchV1) => run(async (owner, signal, current) => {
		const next = await owner.applyMetadata(photoId, expectedRevision, changes, { signal });
		if (current.live) {
			setMetadata(next);
			const previous = current.page;
			publishPage(current, previous ? Object.freeze({ ...previous, cursor: null,
				rows: Object.freeze(previous.rows.map(row => row.id === next.photoId ? Object.freeze({ ...row, fileName: next.metadata.fileName }) : row)) }) : null);
		}
		await refreshQuery(owner, signal, current);
	});
	const applyDefinition = async (expectedRootRevision: number, command: PhotoLibraryDefinitionCommandV1): Promise<PhotoLibraryDefinitionAcknowledgementV1> => {
		const result: { ack?: PhotoLibraryDefinitionAcknowledgementV1; failure?: Readonly<{ value: unknown }> } = {};
		const status = await perform(async (owner, signal, current) => {
			try { result.ack = await owner.applyDefinition(expectedRootRevision, command, { signal }); }
			catch (failure) { result.failure = { value: failure }; throw failure; }
			if (current.page) publishPage(current, Object.freeze({ ...current.page, cursor: null }));
			await refreshQuery(owner, signal, current);
		});
		if (result.ack) return result.ack;
		if (result.failure) throw result.failure.value;
		if (status === 'cancelled') throw new DOMException('Catalog authoring was cancelled.', 'AbortError');
		throw new Error(status === 'busy' ? 'A photo library change is already pending.' : 'Catalog authoring failed.');
	};
	const readMemberships = useCallback((photoId: string) => run(async (owner, signal, current) => {
		setMemberships(null);
		const next = await owner.readMemberships(photoId, { signal });
		if (current.live) setMemberships(next);
	}), [run]);
	const applyMemberships = (photoId: string, expectedRevision: number, changes: PhotoLibraryMembershipPatchV1) => run(async (owner, signal, current) => {
		const next = await owner.applyMemberships(photoId, expectedRevision, changes, { signal });
		if (current.live) setMemberships(next.snapshot);
		updateRow(next.row, current);
		await refreshQuery(owner, signal, current);
	});
	return { page, metadata, memberships, readPreview, query, needsQueryIndex, queryIndexProgress, applyQuery, probeQuery, buildQueryIndex, readDefinitions,
		readDefinition, applyDefinition, readMemberships, applyMemberships, readImportPresets, applyImportPreset, receipts, importReceipt, busy, error, readMetadata, applyMetadata, readPage, importFiles, setRating, applyAttributes,
		cancel: () => { slot.current?.active?.abort(); } };
}

function message(failure: unknown): string {
	const descriptor = failure && typeof failure === 'object' ? Object.getOwnPropertyDescriptor(failure, 'message') : undefined;
	return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
		? descriptor.value.slice(0, 2_048) : 'The photo library action failed.';
}

/** A canceled observer can settle before native close; replacement joins that close. */
function acquire(current: SessionSlot): Promise<PhotoLibrarySessionPortV1> {
	if (!current.pending) {
		const pending = Promise.resolve().then(async () => {
			if (current.beforeDrain) await current.beforeDrain;
			current.lifetime.signal.throwIfAborted();
			if (!current.factory) throw new Error('The photo library is unavailable.');
			return current.factory();
		});
		current.pending = pending;
		void pending.catch(() => { if (current.pending === pending) current.pending = null; });
	}
	return current.pending;
}

export const DEFAULT_PHOTO_LIBRARY_QUERY_V1: PhotoLibraryQueryV1 = Object.freeze({ text: '', filter: null,
	sort: Object.freeze({ field: 'photo-id', direction: 'ascending' }) });
const DEFAULT_QUERY = DEFAULT_PHOTO_LIBRARY_QUERY_V1;

async function readNonemptyQueryPage(owner: PhotoLibrarySessionPortV1, query: PhotoLibraryQueryV1, cursor: string | null, signal: AbortSignal): Promise<PhotoLibraryPageV1> {
	while (true) {
		signal.throwIfAborted(); const next = await owner.readQueryStep({ query, cursor, signal }); signal.throwIfAborted();
		if (next.rows.length > 0 || next.cursor === null) return Object.freeze({
			catalogName: next.catalogName, totalCount: next.totalCount, rows: next.rows, cursor: next.cursor,
		});
		if (next.cursor === cursor) throw new Error('Photo query continuation did not advance.');
		cursor = next.cursor; await yieldTask(signal);
	}
}
async function yieldTask(signal: AbortSignal): Promise<void> {
	await new Promise<void>(resolve => { setTimeout(resolve, 0); }); signal.throwIfAborted();
}
function errorCode(value: unknown): unknown {
	return value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'code')?.value as unknown : undefined;
}
