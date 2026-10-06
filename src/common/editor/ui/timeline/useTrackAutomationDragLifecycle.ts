/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, type RefObject } from 'react';

interface DragEvent {
	preventDefault(): void;
	stopPropagation(): void;
}

export function useTrackAutomationDragLifecycle<
	Lane,
	Drag extends { readonly expected: Lane | null },
>(
	svgRef: RefObject<SVGSVGElement | null>,
	dragRef: RefObject<Drag | null>,
	draftLaneRef: RefObject<Lane | null>,
	updateDraftLane: (lane: Lane | null) => void,
	commitLane: (lane: Lane, expected: Lane | null) => void,
) {
	const finishDrag = useCallback((event: DragEvent, cancel = false) => {
		const drag = dragRef.current;
		if (!drag) return;
		event.preventDefault();
		event.stopPropagation();
		dragRef.current = null;
		const replacement = draftLaneRef.current;
		updateDraftLane(null);
		if (!cancel && replacement) commitLane(replacement, drag.expected);
	}, [commitLane, dragRef, draftLaneRef, updateDraftLane]);
	useEffect(() => {
		const document = svgRef.current?.ownerDocument;
		if (!document) return;
		const cancelOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') finishDrag(event, true);
		};
		document.addEventListener('keydown', cancelOnEscape);
		return () => document.removeEventListener('keydown', cancelOnEscape);
	}, [finishDrag, svgRef]);
	return finishDrag;
}
