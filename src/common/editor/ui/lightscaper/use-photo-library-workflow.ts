/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreatePhotoLibrarySessionV1, PhotoLibraryAttributePatchV1, PhotoLibraryImportItemV1, PhotoLibraryMetadataPatchV1, PhotoLibraryMetadataSnapshotV1, PhotoLibraryDefinitionPageRequestV1, PhotoLibraryQueryBuildProgressV1, PhotoLibraryQueryV1, PhotoLibraryPreviewTierV1, PhotoLibraryPageV1, PhotoLibraryRowV1, PhotoLibrarySessionPortV1 } from '../../photo-library-session-port-v1.ts';

interface SessionSlot {
	live: boolean;
	readonly factory: CreatePhotoLibrarySessionV1 | undefined;
	readonly lifetime: AbortController;
	readonly beforeDrain: Promise<void> | null;
	pending: Promise<PhotoLibrarySessionPortV1> | null;
	active: AbortController | null;
	query: PhotoLibraryQueryV1 | null;
}

/** The effect owns one resource generation, including factories resolving after cleanup. */
export function usePhotoLibraryWorkflow(createSession?: CreatePhotoLibrarySessionV1) {
	const slot = useRef<SessionSlot | null>(null);
	const retiring = useRef<Promise<void> | null>(null);
	const [page, setPage] = useState<PhotoLibraryPageV1 | null>(null);
	const [receipts, setReceipts] = useState<readonly PhotoLibraryImportItemV1[]>([]);
	const [metadata, setMetadata] = useState<PhotoLibraryMetadataSnapshotV1 | null>(null);
	const [busy, setBusy] = useState(false);
	const [query, setQuery] = useState<PhotoLibraryQueryV1 | null>(null);
	const [needsQueryIndex, setNeedsQueryIndex] = useState(false);
	const [queryIndexProgress, setQueryIndexProgress] = useState<PhotoLibraryQueryBuildProgressV1 | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		const current: SessionSlot = { live: true, factory: createSession, lifetime: new AbortController(),
			beforeDrain: retiring.current, pending: null, active: null, query: null };
		slot.current = current;
		queueMicrotask(() => {
			if (!current.live) return;
			setQuery(null); setNeedsQueryIndex(false); setQueryIndexProgress(null);
			setPage(null); setMetadata(null); setReceipts([]); setError(null); setBusy(current.active !== null);
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
	}, [createSession]);

	const run = useCallback(async (action: (owner: PhotoLibrarySessionPortV1, signal: AbortSignal, current: SessionSlot) => Promise<void>) => {
		const current = slot.current;
		if (!current?.live || current.factory !== createSession || current.active) return;
		const active = new AbortController(); current.active = active;
		setBusy(true); setError(null);
		try {
			const owner = await acquire(current);
			active.signal.throwIfAborted();
			await action(owner, active.signal, current);
		} catch (failure) {
			if (current.live) {
				if (!active.signal.aborted && errorCode(failure) === 'PHOTO_QUERY_INDEX_NOT_READY') { setNeedsQueryIndex(true); setError(null); }
				else setError(active.signal.aborted ? null : message(failure));
			}
		} finally {
			if (current.live) setBusy(false);
			current.active = null;
		}
	}, [createSession]);

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
		if (current.live) setPage(next);
	}), [run]);
	const applyQuery = (nextQuery: PhotoLibraryQueryV1) => run(async (owner, signal, current) => {
		const next = await readNonemptyQueryPage(owner, nextQuery, null, signal);
		if (current.live) { current.query = nextQuery; setQuery(nextQuery); setNeedsQueryIndex(false); setPage(next); }
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

	const importFiles = (files: readonly File[]) => run(async (owner, signal, current) => {
		setReceipts([]);
		const results = await owner.importFiles(files, { signal });
		if (current.live) setReceipts(results);
		const next = current.query ? await readNonemptyQueryPage(owner, current.query, null, signal) : await owner.readPage({ signal });
		if (current.live) setPage(next);
	});
	const refreshQuery = async (owner: PhotoLibrarySessionPortV1, signal: AbortSignal, current: SessionSlot) => {
		if (!current.query) return;
		const next = await readNonemptyQueryPage(owner, current.query, null, signal);
		if (current.live) setPage(next);
	};
	const updateRow = (updated: PhotoLibraryRowV1, current: SessionSlot) => {
		if (current.live) setPage(previous => previous ? Object.freeze({ ...previous, cursor: null,
			rows: Object.freeze(previous.rows.map(row => row.id === updated.id ? updated : row)) }) : null);
	};
	const setRating = (photoId: string, rating: number) => run(async (owner, signal, current) => {
		updateRow(await owner.setRating(photoId, rating, { signal }), current);
		await refreshQuery(owner, signal, current);
	});
	const applyAttributes = (photoId: string, changes: PhotoLibraryAttributePatchV1) => run(async (owner, signal, current) => {
		updateRow(await owner.applyAttributes(photoId, changes, { signal }), current);
		await refreshQuery(owner, signal, current);
	});
	const readMetadata = useCallback((photoId: string) => run(async (owner, signal, current) => {
		setMetadata(null);
		const next = await owner.readMetadata(photoId, { signal });
		if (current.live) setMetadata(next);
	}), [run]);
	const applyMetadata = (photoId: string, expectedRevision: number, changes: PhotoLibraryMetadataPatchV1) => run(async (owner, signal, current) => {
		const next = await owner.applyMetadata(photoId, expectedRevision, changes, { signal });
		if (current.live) {
			setMetadata(next);
			setPage(previous => previous ? Object.freeze({ ...previous, cursor: null,
				rows: Object.freeze(previous.rows.map(row => row.id === next.photoId ? Object.freeze({ ...row, fileName: next.metadata.fileName }) : row)) }) : null);
		}
		await refreshQuery(owner, signal, current);
	});
	return { page, metadata, readPreview, query, needsQueryIndex, queryIndexProgress, applyQuery, probeQuery, buildQueryIndex, readDefinitions, receipts, busy, error, readMetadata, applyMetadata, readPage, importFiles, setRating, applyAttributes,
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
