/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, type RefObject } from 'react';

export function useEnvelopeDragLifecycle<Point extends object, Drag>(
	dragRef: RefObject<Drag | null>,
	points: Point[],
	publishPoints: (points: Point[]) => void,
	setHidden: (indices: number[]) => void,
	publishHidden: ((indices: number[]) => void) | undefined,
	publishHovered: ((indices: number[]) => void) | undefined,
	setTooltip: (tooltip: null) => void,
	setDragging: (dragging: boolean) => void,
) {
	const originalPoints = useRef<Point[] | null>(null);
	const rememberBeforeDrag = () => { originalPoints.current = points.slice(); };
	const finishDrag = useCallback(() => {
		setHidden([]);
		publishHidden?.([]);
		publishHovered?.([]);
		setTooltip(null);
		setDragging(false);
		dragRef.current = null;
		originalPoints.current = null;
	}, [dragRef, publishHidden, publishHovered, setDragging, setHidden, setTooltip]);
	useEffect(() => {
		const cancelOnEscape = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || !dragRef.current) return;
			event.preventDefault();
			event.stopPropagation();
			const original = originalPoints.current;
			finishDrag();
			if (original) publishPoints(original);
		};
		document.addEventListener('keydown', cancelOnEscape);
		return () => document.removeEventListener('keydown', cancelOnEscape);
	}, [dragRef, finishDrag, publishPoints]);
	return { rememberBeforeDrag, finishDrag };
}
