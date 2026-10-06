/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, type RefObject } from 'react';

interface CapturedAnnotationDrag {
	readonly pointerId: number;
	readonly target: HTMLElement;
}

/** Annotation moves and edge resizes publish only after their own pointer session finishes. */
export function useTimelineAnnotationDragCancellation(
	layerRef: RefObject<HTMLElement | null>,
	dragRef: RefObject<CapturedAnnotationDrag | null>,
	clearPreview: () => void,
) {
	useEffect(() => {
		const owner = layerRef.current?.ownerDocument.defaultView;
		if (!owner) return;
		const cancel = (event: KeyboardEvent) => {
			const drag = dragRef.current;
			if (event.key !== 'Escape' || !drag) return;
			dragRef.current = null;
			clearPreview();
			if (drag.target.hasPointerCapture?.(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
			event.preventDefault();
			event.stopPropagation();
		};
		owner.addEventListener('keydown', cancel, true);
		return () => owner.removeEventListener('keydown', cancel, true);
	}, [clearPreview, dragRef, layerRef]);
}
