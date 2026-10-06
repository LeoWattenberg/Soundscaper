/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, type RefObject } from 'react';

export function useSpectralBrushCancellation(
	surfaceRef: RefObject<HTMLElement | null>,
	dragRef: RefObject<{ readonly pointerId: number } | null>,
	clearPreview: () => void,
) {
	useEffect(() => {
		const surface = surfaceRef.current;
		const owner = surface?.ownerDocument.defaultView;
		if (!surface || !owner) return;
		const cancel = (event: KeyboardEvent) => {
			const drag = dragRef.current;
			if (event.key !== 'Escape' || !drag) return;
			event.preventDefault();
			event.stopPropagation();
			dragRef.current = null;
			clearPreview();
			if (surface.hasPointerCapture?.(drag.pointerId)) surface.releasePointerCapture(drag.pointerId);
		};
		owner.addEventListener('keydown', cancel, true);
		return () => owner.removeEventListener('keydown', cancel, true);
	}, [clearPreview, dragRef, surfaceRef]);
}
