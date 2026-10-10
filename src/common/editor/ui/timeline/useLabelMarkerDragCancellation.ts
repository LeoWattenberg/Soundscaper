/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useLayoutEffect, useRef, type MouseEvent, type RefObject } from 'react';

/** The label renderer owns a mouse draft separately from timeline pointer gestures. */
export function useLabelMarkerDragCancellation(
	markerRef: RefObject<HTMLElement | null>,
	pendingRef: RefObject<unknown | null>,
	clearPreview: () => void,
	range: Readonly<{ startFrame: number; endFrame: number }>,
) {
	const activeRef = useRef(false);
	const cancelledRef = useRef(false);
	const expectedRangeRef = useRef(range);
	const cancelDrag = useCallback(() => {
		activeRef.current = false;
		cancelledRef.current = true;
		pendingRef.current = null;
		clearPreview();
	}, [clearPreview, pendingRef]);
	useLayoutEffect(() => {
		if (activeRef.current && (range.startFrame !== expectedRangeRef.current.startFrame
			|| range.endFrame !== expectedRangeRef.current.endFrame)) cancelDrag();
	}, [cancelDrag, range.startFrame, range.endFrame]);
	useEffect(() => {
		const owner = markerRef.current?.ownerDocument.defaultView;
		if (!owner) return;
		const finish = (event: globalThis.MouseEvent) => { if (event.button === 0) activeRef.current = false; };
		const cancel = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || !activeRef.current) return;
			cancelDrag();
			event.preventDefault();
			event.stopPropagation();
		};
		owner.addEventListener('keydown', cancel, true);
		owner.addEventListener('mouseup', finish, true);
		return () => {
			owner.removeEventListener('keydown', cancel, true);
			owner.removeEventListener('mouseup', finish, true);
		};
	}, [cancelDrag, markerRef]);
	return {
		activeRef,
		cancelledRef,
		onMouseDownCapture: (event: MouseEvent<HTMLElement>) => {
			if (event.button !== 0 || !(event.target as Element).closest('.label-marker')) return;
			expectedRangeRef.current = range;
			activeRef.current = true;
			cancelledRef.current = false;
		},
	};
}
