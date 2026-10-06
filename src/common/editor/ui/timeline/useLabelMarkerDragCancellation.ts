/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, type MouseEvent, type RefObject } from 'react';

/** The label renderer owns a mouse draft separately from timeline pointer gestures. */
export function useLabelMarkerDragCancellation(
	markerRef: RefObject<HTMLElement | null>,
	pendingRef: RefObject<unknown | null>,
	clearPreview: () => void,
) {
	const activeRef = useRef(false);
	const cancelledRef = useRef(false);
	useEffect(() => {
		const owner = markerRef.current?.ownerDocument.defaultView;
		if (!owner) return;
		const finish = () => { activeRef.current = false; };
		const cancel = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || !activeRef.current) return;
			activeRef.current = false;
			cancelledRef.current = true;
			pendingRef.current = null;
			clearPreview();
			event.preventDefault();
			event.stopPropagation();
		};
		owner.addEventListener('keydown', cancel, true);
		owner.addEventListener('mouseup', finish, true);
		return () => {
			owner.removeEventListener('keydown', cancel, true);
			owner.removeEventListener('mouseup', finish, true);
		};
	}, [clearPreview, markerRef, pendingRef]);
	return {
		cancelledRef,
		onMouseDownCapture: (event: MouseEvent<HTMLElement>) => {
			if (event.button !== 0 || !(event.target as Element).closest('.label-marker')) return;
			activeRef.current = true;
			cancelledRef.current = false;
		},
	};
}
