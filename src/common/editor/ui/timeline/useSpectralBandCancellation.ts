/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, type RefObject } from 'react';
import type { spectralSelectionState } from './geometry.ts';

type Band = ReturnType<typeof spectralSelectionState>;
interface Gesture {
	readonly pointerId: number;
	readonly target: HTMLElement;
	readonly band: Band;
}

/** Existing band handles capture independently from the brush that creates a band. */
export function useSpectralBandCancellation(
	surfaceRef: RefObject<HTMLElement | null>,
	dragRef: RefObject<Gesture | null>,
	restore: (band: Band) => void,
) {
	useEffect(() => {
		const owner = surfaceRef.current?.ownerDocument.defaultView;
		if (!owner) return;
		const cancel = (event: KeyboardEvent) => {
			const drag = dragRef.current;
			if (event.key !== 'Escape' || !drag) return;
			event.preventDefault();
			event.stopPropagation();
			dragRef.current = null;
			restore(drag.band);
			if (drag.target.hasPointerCapture?.(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
		};
		owner.addEventListener('keydown', cancel, true);
		return () => owner.removeEventListener('keydown', cancel, true);
	}, [dragRef, restore, surfaceRef]);
}
