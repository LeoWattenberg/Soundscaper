/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, type RefObject } from 'react';

interface DeletionKeyEvent {
	readonly currentTarget: SVGCircleElement;
	readonly shiftKey: boolean;
	preventDefault(): void;
	stopPropagation(): void;
}

interface PendingDeletion {
	readonly current: SVGCircleElement;
	readonly nextId: string | undefined;
}

/** Restore keyboard position after React publishes a lane with fewer points. */
export function useTrackAutomationKeyboardDeletion(
	svgRef: RefObject<SVGSVGElement | null>,
	lane: object | null,
	removePoint: (pointId: string, deleteLane: boolean) => void,
) {
	const pendingRef = useRef<PendingDeletion | null>(null);
	useLayoutEffect(() => {
		const pending = pendingRef.current;
		pendingRef.current = null;
		const svg = svgRef.current;
		if (!pending || !svg?.isConnected || pending.current.isConnected) return;
		const next = Array.from(svg.querySelectorAll<SVGCircleElement>('[data-automation-point-id]'))
			.find(point => point.getAttribute('data-automation-point-id') === pending.nextId);
		(next ?? svg.querySelector<SVGPathElement>('[data-automation-insert-point]'))?.focus({ preventScroll: true });
	}, [lane, svgRef]);
	return (event: DeletionKeyEvent, pointIds: readonly string[], pointId: string): void => {
		event.preventDefault();
		event.stopPropagation();
		if (pointIds.length === 1 && !event.shiftKey) return;
		const index = pointIds.indexOf(pointId);
		pendingRef.current = {
			current: event.currentTarget,
			nextId: pointIds[index + 1] ?? pointIds[index - 1],
		};
		try {
			removePoint(pointId, event.shiftKey);
		} catch (error) {
			pendingRef.current = null;
			throw error;
		}
	};
}
