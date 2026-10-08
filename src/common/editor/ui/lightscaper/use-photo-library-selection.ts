/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { PhotoLibrarySelectionV1, readPhotoLibrarySelectionIdV1, readPhotoLibrarySelectionIdsV1, type PhotoLibrarySelectionModifiersV1 } from '../../controller/shared/photo-library-selection-v1.ts';
import { PhotoLibraryCullingV1, type PhotoLibraryCullSaveV1 } from '../../controller/shared/photo-library-culling-v1.ts';

export interface PhotoLibrarySelectionOptionsV1 {
	readonly photoIds: readonly string[];
	readonly generation: unknown;
	readonly pageIdentity: unknown;
	readonly autoAdvance: boolean;
}

/** Scalar selection observation and <=64 borrowed button targets; no second session. */
export function usePhotoLibrarySelection(options: PhotoLibrarySelectionOptionsV1) {
	const owner = useRef<PhotoLibrarySelectionV1 | null>(null); owner.current ??= new PhotoLibrarySelectionV1();
	const selection = owner.current;
	const cullOwner = useRef<PhotoLibraryCullingV1 | null>(null); cullOwner.current ??= new PhotoLibraryCullingV1(selection);
	const culling = cullOwner.current;
	const targets = useRef(new Map<string, HTMLButtonElement>()), requestedFocus = useRef<string | null>(null);
	const lastFocused = useRef<string | null>(null), alive = useRef(false), autoAdvance = useRef(false);
	const [snapshot, setSnapshot] = useState(() => selection.snapshot());
	const [cullSnapshot, setCullSnapshot] = useState(() => culling.snapshot());
	const deliverFocus = useCallback(() => {
		const id = requestedFocus.current, button = id === null ? undefined : targets.current.get(id);
		if (!button) return;
		requestedFocus.current = null;
		if (button.ownerDocument.activeElement !== button) button.focus({ preventScroll: true });
		button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}, []);
	const ids = JSON.stringify(readPhotoLibrarySelectionIdsV1(options.photoIds));
	// Reset a replaced generation before its observer can deliver an old row's focus.
	useLayoutEffect(() => {
		selection.setPage(JSON.parse(ids) as string[], { generation: options.generation, pageIdentity: options.pageIdentity });
	}, [selection, ids, options.generation, options.pageIdentity]);
	useLayoutEffect(() => {
		alive.current = true;
		const unsubscribeSelection = selection.subscribe(next => {
			setSnapshot(next);
			if (next.focusedId !== lastFocused.current) {
				lastFocused.current = next.focusedId; requestedFocus.current = next.focusedId; deliverFocus();
			}
		});
		const unsubscribeCulling = culling.subscribe(setCullSnapshot);
		return () => {
			alive.current = false; unsubscribeSelection(); unsubscribeCulling();
			lastFocused.current = null; requestedFocus.current = null; void culling.pause();
		};
	}, [selection, culling, deliverFocus, options.generation]);
	useLayoutEffect(() => { autoAdvance.current = options.autoAdvance; }, [options.autoAdvance]);
	useLayoutEffect(() => () => { targets.current.clear(); }, []);
	const attach = useCallback((photoId: string, button: HTMLButtonElement | null) => {
		const id = readPhotoLibrarySelectionIdV1(photoId), target = targets.current;
		if (button === null) { target.delete(id); return; }
		if (!target.has(id) && target.size >= 64) throw new RangeError('Selection admits at most 64 button targets.');
		for (const [otherId, other] of target) if (other === button && otherId !== id) throw new RangeError('A button may represent only one photo.');
		target.set(id, button); deliverFocus();
	}, [deliverFocus]);
	const select = useCallback((id: string, modifiers?: PhotoLibrarySelectionModifiersV1) => { selection.select(id, modifiers); }, [selection]);
	const focus = useCallback((id: string) => { selection.focus(id); }, [selection]);
	const navigate = useCallback((id: string, key: string, modifiers?: PhotoLibrarySelectionModifiersV1) => selection.navigate(id, key, modifiers), [selection]);
	const selectAll = useCallback(() => { selection.selectAll(); }, [selection]);
	const clear = useCallback(() => { selection.clear(); }, [selection]);
	const cull = useCallback((id: string, save: PhotoLibraryCullSaveV1) => alive.current
		? culling.execute(id, save, { autoAdvance: autoAdvance.current })
		: Promise.resolve(Object.freeze({ outcome: 'cancelled' as const })), [culling]);
	return { snapshot, pendingPhotoId: cullSnapshot.pendingPhotoId, notice: cullSnapshot.notice,
		select, focus, navigate, selectAll, clear, cull, attach };
}
