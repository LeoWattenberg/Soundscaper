/* SPDX-License-Identifier: AGPL-3.0-only */

import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';

const TIMELINE_ZOOM_WHEEL_THRESHOLD = 48;
const TIMELINE_ZOOM_WHEEL_IDLE_MILLISECONDS = 250;

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

/** Convert high-resolution wheel input into at most one discrete zoom notch. */
export function accumulateTimelineZoomWheel(stateValue, event, viewportHeight) {
	const state = stateValue ?? { delta: 0, direction: 0, timeStamp: null };
	const rawDelta = Number(event?.deltaY);
	const mode = Number(event?.deltaMode);
	const delta = !Number.isFinite(rawDelta) ? 0
		: mode === 1 ? rawDelta * 16
			: mode === 2 ? rawDelta * Math.max(1, Number(viewportHeight) || 1)
				: rawDelta;
	const direction = Math.sign(delta);
	const timeStamp = Number.isFinite(Number(event?.timeStamp)) ? Number(event.timeStamp) : 0;
	const reset = direction !== 0 && state.direction !== 0 && direction !== state.direction
		|| state.timeStamp !== null && timeStamp - state.timeStamp > TIMELINE_ZOOM_WHEEL_IDLE_MILLISECONDS;
	const accumulated = (reset ? 0 : state.delta) + delta;
	const zoom = Math.abs(accumulated) >= TIMELINE_ZOOM_WHEEL_THRESHOLD
		? accumulated < 0 ? 'in' : 'out'
		: null;
	return Object.freeze({
		state: Object.freeze({
			delta: zoom === null ? accumulated : 0,
			direction,
			timeStamp,
		}),
		zoom,
	});
}
