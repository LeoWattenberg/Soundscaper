import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';
import {
	readTimelineContentScrollX,
	timelineDomScrollForElement,
} from '../timeline/timeline-scroll-space.ts';
import {
	accumulateTimelineZoomWheel,
	centeredTimelinePlayheadScroll,
	resolveTimelineViewportGeometry,
	timelineWheelZoomFactor,
} from './timeline-navigation-geometry.js';

export function useTimelineNavigation({ controller, editorRef, project, run, snapshot, workspaceRef }) {
	const zoomPrecision = snapshot.preferences?.editing?.zoomPrecision;
	const pendingZoomAnchorRef = useRef(null);
	const wheelZoomRef = useRef(null);
	const zoomProject = useCallback((direction, anchor = null, factor = undefined) => {
		const scroll = workspaceRef.current?.querySelector('.audio-editor-timeline-scroll');
		if (!scroll) return undefined;
		const rect = scroll.getBoundingClientRect();
		const { panelWidth, viewportWidth } = resolveTimelineViewportGeometry(scroll);
		const currentZoom = snapshot.timeline?.pixelsPerSecond || 120;
		let anchorSeconds;
		let anchorOffset;
		if (anchor === 'playhead') {
			const positionFrame = controller.getTelemetrySnapshot?.().positionFrame || 0;
			anchorSeconds = positionFrame / (project?.sampleRate || 48_000);
			anchorOffset = viewportWidth / 2;
		} else {
			const clientX = anchor?.clientX ?? rect.left + scroll.clientWidth / 2;
			anchorOffset = clientX - rect.left - panelWidth;
			anchorSeconds = (readTimelineContentScrollX(scroll) + anchorOffset - CLIP_CONTENT_OFFSET) / currentZoom;
		}
		const action = direction === 'in'
			? controller.actions.timeline.zoomIn
			: controller.actions.timeline.zoomOut;
		pendingZoomAnchorRef.current = { anchorSeconds, anchorOffset };
		const nextZoom = run(() => action(factor));
		if (!Number.isFinite(Number(nextZoom)) || Number(nextZoom) === currentZoom) {
			pendingZoomAnchorRef.current = null;
		}
		return nextZoom;
	}, [controller, project?.sampleRate, run, snapshot.timeline?.pixelsPerSecond, workspaceRef]);
	useLayoutEffect(() => {
		const pending = pendingZoomAnchorRef.current;
		if (!pending) return;
		pendingZoomAnchorRef.current = null;
		const element = workspaceRef.current?.querySelector('.audio-editor-timeline-scroll');
		if (!element) return;
		element.scrollLeft = timelineDomScrollForElement(
			element,
			CLIP_CONTENT_OFFSET
				+ pending.anchorSeconds * (snapshot.timeline?.pixelsPerSecond || 120)
				- pending.anchorOffset,
		);
		element.dispatchEvent(new Event('scroll', { bubbles: true }));
	}, [snapshot.timeline?.pixelsPerSecond, workspaceRef]);
	const jumpTransport = useCallback((action) => {
		const value = run(action);
		requestAnimationFrame(() => {
			const scroll = workspaceRef.current?.querySelector('.audio-editor-timeline-scroll');
			if (!scroll) return;
			const positionFrame = controller.getTelemetrySnapshot?.().positionFrame || 0;
			const pixelsPerSecond = snapshot.timeline?.pixelsPerSecond || 120;
			const sampleRate = project?.sampleRate || 48_000;
			scroll.scrollLeft = centeredTimelinePlayheadScroll(scroll, {
				positionFrame, sampleRate, pixelsPerSecond,
			});
		});
		return value;
	}, [controller, project?.sampleRate, run, snapshot.timeline?.pixelsPerSecond, workspaceRef]);
	const jumpToStart = useCallback(
		() => jumpTransport(() => controller.actions.transport.jumpStart()),
		[controller, jumpTransport],
	);
	const jumpToEnd = useCallback(
		() => jumpTransport(() => controller.actions.transport.jumpEnd()),
		[controller, jumpTransport],
	);

	useEffect(() => {
		const editor = editorRef.current;
		if (!editor) return undefined;
		wheelZoomRef.current = null;
		const onWheel = (event) => {
			if (event.altKey || (!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return;
			event.preventDefault();
			const accumulated = accumulateTimelineZoomWheel(
				wheelZoomRef.current, event, editor.clientHeight,
			);
			wheelZoomRef.current = accumulated.state;
			// Audacity's mouse zoom precision: the wheel moves a fraction of an
			// octave a notch, where the menu's Zoom In and Zoom Out move a whole one.
			if (accumulated.zoom) {
				zoomProject(accumulated.zoom, { clientX: event.clientX }, timelineWheelZoomFactor(zoomPrecision));
			}
		};
		editor.addEventListener('wheel', onWheel, { passive: false });
		return () => editor.removeEventListener('wheel', onWheel);
	}, [editorRef, zoomPrecision, zoomProject]);

	return { jumpToEnd, jumpToStart, zoomProject };
}
