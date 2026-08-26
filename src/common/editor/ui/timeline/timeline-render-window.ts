/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef } from 'react';

export interface AnchoredTimelineScrollOptions {
	readonly scrollX: number;
	readonly renderScrollX: number;
	readonly viewportWidth: number;
}

export interface TimelineRenderWindowOptions {
	readonly scrollX: number;
	readonly viewportWidth: number;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
	readonly resetToken: unknown;
}

interface TimelineRenderWindowAnchor {
	readonly renderScrollX: number;
	readonly viewportWidth: number;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
	readonly resetToken: unknown;
}

/**
 * Retain an expensive clip render window until the live viewport has travelled
 * half its width. The clip projector already renders a full viewport of
 * overscan on each side, so the retained window continues to cover the screen.
 */
export function resolveAnchoredTimelineScrollX({
	scrollX,
	renderScrollX,
	viewportWidth,
}: AnchoredTimelineScrollOptions): number {
	if (!Number.isFinite(scrollX) || !Number.isFinite(renderScrollX)) {
		throw new TypeError('Timeline scroll positions must be finite.');
	}
	if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
		throw new RangeError('Timeline viewport width must be positive.');
	}
	return Math.abs(scrollX - renderScrollX) < viewportWidth / 2
		? renderScrollX
		: scrollX;
}

/** Keep the render anchor stable across exact scroll-driven React renders. */
export function useAnchoredTimelineRenderScrollX({
	scrollX,
	viewportWidth,
	pixelsPerSecond,
	sampleRate,
	resetToken,
}: TimelineRenderWindowOptions): number {
	const anchorRef = useRef<TimelineRenderWindowAnchor | null>(null);
	const previous = anchorRef.current;
	const reset = previous === null
		|| previous.resetToken !== resetToken
		|| previous.viewportWidth !== viewportWidth
		|| previous.pixelsPerSecond !== pixelsPerSecond
		|| previous.sampleRate !== sampleRate;
	const renderScrollX = reset
		? scrollX
		: resolveAnchoredTimelineScrollX({
			scrollX,
			renderScrollX: previous.renderScrollX,
			viewportWidth,
		});
	anchorRef.current = {
		renderScrollX,
		viewportWidth,
		pixelsPerSecond,
		sampleRate,
		resetToken,
	};
	return renderScrollX;
}
