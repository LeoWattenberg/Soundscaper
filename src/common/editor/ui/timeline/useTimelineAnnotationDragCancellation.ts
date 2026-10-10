/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useLayoutEffect, type RefObject } from 'react';

interface CapturedAnnotationDrag {
	readonly pointerId: number;
	readonly target: HTMLElement;
	readonly idSet: ReadonlySet<string>;
}

/** Annotation moves and edge resizes publish only after their own pointer session finishes. */
export function useTimelineAnnotationDragCancellation(
	layerRef: RefObject<HTMLElement | null>,
	dragRef: RefObject<CapturedAnnotationDrag | null>,
	clearPreview: () => void,
	annotations: readonly Readonly<{ readonly id: string }>[],
) {
	const cancelDrag = useCallback(() => {
		const drag = dragRef.current;
		if (!drag) return;
		dragRef.current = null;
		clearPreview();
		if (drag.target.hasPointerCapture?.(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
	}, [clearPreview, dragRef]);
	useLayoutEffect(() => {
		const drag = dragRef.current;
		if (!drag) return;
		const liveIds = new Set(annotations.map(annotation => annotation.id));
		if ([...drag.idSet].some(id => !liveIds.has(id))) cancelDrag();
	}, [annotations, cancelDrag, dragRef]);
	useEffect(() => {
		const owner = layerRef.current?.ownerDocument.defaultView;
		if (!owner) return;
		const cancel = (event: KeyboardEvent) => {
			const drag = dragRef.current;
			if (event.key !== 'Escape' || !drag) return;
			cancelDrag();
			event.preventDefault();
			event.stopPropagation();
		};
		owner.addEventListener('keydown', cancel, true);
		return () => owner.removeEventListener('keydown', cancel, true);
	}, [cancelDrag, dragRef, layerRef]);
}
