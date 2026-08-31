/* SPDX-License-Identifier: AGPL-3.0-only */

import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';

/** Resolve the unobscured timeline content width beside its sticky track panel. */
export function resolveTimelineViewportGeometry(scroll) {
	const timeline = scroll?.closest?.('.audio-editor-timeline-panel');
	const timelineStyle = timeline && typeof globalThis.getComputedStyle === 'function'
		? globalThis.getComputedStyle(timeline)
		: null;
	const panelWidth = Number.parseFloat(
		timelineStyle?.getPropertyValue('--track-panel-width') || '',
	) || 0;
	const viewportWidth = Number.parseFloat(
		timelineStyle?.getPropertyValue('--timeline-viewport-width') || '',
	) || Math.max(0, Number(scroll?.clientWidth) - panelWidth);
	return Object.freeze({ panelWidth, viewportWidth });
}

/** Center one playhead in the visible clip-content viewport and clamp it to the scroll range. */
export function centeredTimelinePlayheadScroll(scroll, {
	positionFrame,
	sampleRate,
	pixelsPerSecond,
}) {
	const { viewportWidth } = resolveTimelineViewportGeometry(scroll);
	const nextScroll = CLIP_CONTENT_OFFSET
		+ positionFrame / sampleRate * pixelsPerSecond
		- viewportWidth / 2;
	const maximumScroll = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
	return Math.max(0, Math.min(maximumScroll, nextScroll));
}
