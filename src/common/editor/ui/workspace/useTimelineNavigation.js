import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';

export function useTimelineNavigation({ controller, editorRef, project, run, snapshot, workspaceRef }) {
	const pendingZoomAnchorRef = useRef(null);
	const zoomProject = useCallback((direction, anchor = null) => {
		const scroll = workspaceRef.current?.querySelector('.audio-editor-timeline-scroll');
		const timeline = scroll?.closest('.audio-editor-timeline-panel');
		if (!scroll || !timeline) return undefined;
		const rect = scroll.getBoundingClientRect();
		const timelineStyle = getComputedStyle(timeline);
		const panelWidth = Number.parseFloat(timelineStyle.getPropertyValue('--track-panel-width')) || 0;
		const viewportWidth = Number.parseFloat(timelineStyle.getPropertyValue('--timeline-viewport-width'))
			|| Math.max(0, scroll.clientWidth - panelWidth);
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
			anchorSeconds = (scroll.scrollLeft + anchorOffset - CLIP_CONTENT_OFFSET) / currentZoom;
		}
		const action = direction === 'in'
			? controller.actions.timeline.zoomIn
			: controller.actions.timeline.zoomOut;
		pendingZoomAnchorRef.current = { anchorSeconds, anchorOffset };
		const nextZoom = run(() => action());
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
		const maximumScroll = Math.max(0, element.scrollWidth - element.clientWidth);
		element.scrollLeft = Math.max(0, Math.min(
			maximumScroll,
			CLIP_CONTENT_OFFSET
				+ pending.anchorSeconds * (snapshot.timeline?.pixelsPerSecond || 120)
				- pending.anchorOffset,
		));
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
			const nextScroll = positionFrame / sampleRate * pixelsPerSecond - scroll.clientWidth / 2;
			const maximumScroll = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
			scroll.scrollLeft = Math.max(0, Math.min(maximumScroll, nextScroll));
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
		const onWheel = (event) => {
			if (event.altKey || (!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return;
			event.preventDefault();
			zoomProject(event.deltaY < 0 ? 'in' : 'out', { clientX: event.clientX });
		};
		editor.addEventListener('wheel', onWheel, { passive: false });
		return () => editor.removeEventListener('wheel', onWheel);
	}, [editorRef, zoomProject]);

	return { jumpToEnd, jumpToStart, zoomProject };
}
