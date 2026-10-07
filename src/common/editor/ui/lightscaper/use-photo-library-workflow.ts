/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreatePhotoLibrarySessionV1, PhotoLibraryAttributePatchV1, PhotoLibraryImportItemV1, PhotoLibraryMetadataPatchV1, PhotoLibraryMetadataSnapshotV1, PhotoLibraryPageV1, PhotoLibraryRowV1, PhotoLibrarySessionPortV1 } from '../../photo-library-session-port-v1.ts';

interface SessionSlot {
	live: boolean;
	pending: Promise<PhotoLibrarySessionPortV1> | null;
	active: AbortController | null;
}

/** The effect owns one resource generation, including factories resolving after cleanup. */
export function usePhotoLibraryWorkflow(createSession?: CreatePhotoLibrarySessionV1) {
	const slot = useRef<SessionSlot | null>(null);
	const [page, setPage] = useState<PhotoLibraryPageV1 | null>(null);
	const [receipts, setReceipts] = useState<readonly PhotoLibraryImportItemV1[]>([]);
	const [metadata, setMetadata] = useState<PhotoLibraryMetadataSnapshotV1 | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		const current: SessionSlot = { live: true, pending: null, active: null };
		slot.current = current;
		queueMicrotask(() => {
			if (!current.live) return;
			setPage(null); setMetadata(null); setReceipts([]); setError(null); setBusy(current.active !== null);
		});
		return () => {
			current.live = false; current.active?.abort();
			if (slot.current === current) slot.current = null;
			if (current.pending) void current.pending.then(owner => owner.close()).catch(() => undefined);
		};
	}, [createSession]);

	const run = useCallback(async (action: (owner: PhotoLibrarySessionPortV1, signal: AbortSignal, current: SessionSlot) => Promise<void>) => {
		const current = slot.current;
		if (!current?.live || current.active) return;
		const active = new AbortController(); current.active = active;
		setBusy(true); setError(null);
		try {
			if (!createSession) throw new Error('The photo library is unavailable.');
			current.pending ??= createSession().catch((failure: unknown) => { current.pending = null; throw failure; });
			const owner = await current.pending;
			active.signal.throwIfAborted();
			await action(owner, active.signal, current);
		} catch (failure) {
			if (current.live) setError(active.signal.aborted ? null : message(failure));
		} finally {
			if (current.live) setBusy(false);
			current.active = null;
		}
	}, [createSession]);

	const readPage = useCallback((cursor: string | null = null) => run(async (owner, signal, current) => {
		const next = await owner.readPage({ cursor, signal });
		if (current.live) setPage(next);
	}), [run]);
	const importFiles = (files: readonly File[]) => run(async (owner, signal, current) => {
		setReceipts([]);
		const results = await owner.importFiles(files, { signal });
		if (current.live) setReceipts(results);
		const next = await owner.readPage({ signal });
		if (current.live) setPage(next);
	});
	const updateRow = (updated: PhotoLibraryRowV1, current: SessionSlot) => {
		if (current.live) setPage(previous => previous ? Object.freeze({ ...previous, cursor: null,
			rows: Object.freeze(previous.rows.map(row => row.id === updated.id ? updated : row)) }) : null);
	};
	const setRating = (photoId: string, rating: number) => run(async (owner, signal, current) => {
		updateRow(await owner.setRating(photoId, rating, { signal }), current);
	});
	const applyAttributes = (photoId: string, changes: PhotoLibraryAttributePatchV1) => run(async (owner, signal, current) => {
		updateRow(await owner.applyAttributes(photoId, changes, { signal }), current);
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
	});
	return { page, metadata, receipts, busy, error, readMetadata, applyMetadata, readPage, importFiles, setRating, applyAttributes,
		cancel: () => { slot.current?.active?.abort(); } };
}

function message(failure: unknown): string {
	const descriptor = failure && typeof failure === 'object' ? Object.getOwnPropertyDescriptor(failure, 'message') : undefined;
	return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
		? descriptor.value.slice(0, 2_048) : 'The photo library action failed.';
}
