/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, type RefObject } from 'react';

interface DragEvent {
	readonly pointerId?: number;
	preventDefault(): void;
	stopPropagation(): void;
}

export function useTrackAutomationDragLifecycle<
	Lane,
	Drag extends { readonly expected: Lane | null; readonly pointerId: number },
>(
	svgRef: RefObject<SVGSVGElement | null>,
	dragRef: RefObject<Drag | null>,
	draftLaneRef: RefObject<Lane | null>,
	updateDraftLane: (lane: Lane | null) => void,
	commitLane: (lane: Lane, expected: Lane | null) => void,
	flushDraft?: RefObject<((cancel?: boolean) => void) | null>,
) {
	const finishDrag = useCallback((event: DragEvent, cancel = false) => {
		const drag = dragRef.current;
		if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
		flushDraft?.current?.(cancel);
		event.preventDefault();
		event.stopPropagation();
		dragRef.current = null;
		const replacement = draftLaneRef.current;
		updateDraftLane(null);
		if (!cancel && replacement) commitLane(replacement, drag.expected);
	}, [commitLane, dragRef, draftLaneRef, flushDraft, updateDraftLane]);
	useEffect(() => {
		const document = svgRef.current?.ownerDocument;
		if (!document) return;
		const cancelOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') finishDrag(event, true);
		};
		const finishOnPrimaryRelease = (event: PointerEvent) => {
			if (event.pointerType === 'mouse' && event.button === 0 && (event.buttons & 1) === 0) finishDrag(event);
		};
		document.addEventListener('keydown', cancelOnEscape);
		document.addEventListener('pointermove', finishOnPrimaryRelease, true);
		return () => {
			document.removeEventListener('keydown', cancelOnEscape);
			document.removeEventListener('pointermove', finishOnPrimaryRelease, true);
		};
	}, [finishDrag, svgRef]);
	return finishDrag;
}
