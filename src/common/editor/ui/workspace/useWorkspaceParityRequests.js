import { useEffect, useRef } from 'react';
import { centeredTimelinePlayheadScroll } from './timeline-navigation-geometry.js';

export function useWorkspaceParityRequests({
	controller,
	importInputRef,
	openExternal,
	openRecordingOffset,
	openSurface,
	openTimedRecording,
	openTrackRate,
	openWorkspacePanel,
	parityUi,
	project,
	run,
	selectedTrack,
	setDialog,
	setDialogValue,
	setGeneratorType,
	setNyquistTarget,
	snapshot,
	toggleFullscreen,
	workspaceRef,
}) {
	const handledRequestRef = useRef(null);
	useEffect(() => {
		const request = parityUi.request;
		if (!request) return;
		// Handler dependencies may change while a one-shot request remains in
		// the UI snapshot. Never replay that request on the resulting effect run.
		if (handledRequestRef.current === request) return;
		handledRequestRef.current = request;
		const payload = request.payload || {};
		if (request.type === 'open-surface') {
			if (payload.surface === 'selection-effect' && payload.type
				&& snapshot.effects?.selectionTypes
					.find((candidate) => candidate.type === payload.type)?.hasSettings === false) {
				run(() => controller.actions.effects.applySelection({ type: payload.type }));
				return;
			}
			if (payload.surface === 'generator') setGeneratorType(payload.type || 'tone');
			if (payload.surface === 'nyquist') setNyquistTarget({
				prompt: !payload.pluginId,
				pluginId: payload.pluginId || null,
			});
			if (payload.surface === 'selection-effect' && payload.type) {
				run(() => controller.actions.effects.setSelectionType(payload.type));
			}
			openSurface(payload.surface || null, payload);
		} else if (request.type === 'open-external') openExternal(payload.url);
		else if (request.type === 'toggle-fullscreen') toggleFullscreen();
		else if (request.type === 'choose-audio-files') importInputRef.current?.click();
		else if (request.type === 'open-about') setDialog('about');
		else if (request.type === 'revert-factory') setDialog('revert-factory');
		else if (request.type === 'open-timed-recording') openTimedRecording();
		else if (request.type === 'close-project') run(() => controller.actions.project.close(payload.projectId, payload));
		else if (request.type === 'set-custom-track-rate') {
			openTrackRate(selectedTrack);
		} else if (request.type === 'rename-track') {
			setDialogValue(selectedTrack?.name || '');
			setDialog('track-rename');
		} else if (request.type === 'focus-panel') {
			if (payload.panel) openWorkspacePanel(payload.panel);
			else requestAnimationFrame(() => {
				const regions = [...(workspaceRef.current?.querySelectorAll(
					'[data-workspace-panel], [data-editor-tool-toolbar], .audio-editor-timeline-panel, [data-selection-toolbar]',
				) || [])].filter((element) => element.getClientRects().length > 0);
				if (!regions.length) return;
				const current = regions.findIndex((element) => element === document.activeElement || element.contains(document.activeElement));
				const direction = payload.direction === 'previous' ? -1 : 1;
				const next = regions[(Math.max(0, current) + direction + regions.length) % regions.length];
				next.tabIndex = -1;
				next.focus({ preventScroll: false });
			});
		} else if (request.type === 'center-playhead') {
			const scroll = workspaceRef.current?.querySelector('.audio-editor-timeline-scroll');
			const positionFrame = controller.getTelemetrySnapshot?.().positionFrame || 0;
			const pixelsPerSecond = snapshot.timeline?.pixelsPerSecond || 120;
			const sampleRate = project?.sampleRate || 48_000;
			if (scroll) scroll.scrollLeft = centeredTimelinePlayheadScroll(scroll, {
				positionFrame, sampleRate, pixelsPerSecond,
			});
		} else if (request.type === 'open-context-menu') {
			const selectedId = payload.clipId || payload.trackId;
			const attribute = payload.clipId ? 'data-clip-id' : 'data-track-id';
			const target = [...(workspaceRef.current?.querySelectorAll(`[${attribute}]`) || [])]
				.find((element) => String(element.getAttribute(attribute)) === String(selectedId));
			const rect = target?.getBoundingClientRect?.();
			if (target && rect) target.dispatchEvent(new MouseEvent('contextmenu', {
				bubbles: true,
				cancelable: true,
				clientX: rect.left + Math.min(24, rect.width / 2),
				clientY: rect.top + Math.min(24, rect.height / 2),
			}));
		} else if (request.type === 'focus-recording-level') {
			requestAnimationFrame(() => workspaceRef.current
				?.closest('#kw-audio-editor-design-system')
				?.querySelector('[data-recording-level] input')
				?.focus());
		}
	}, [
		controller,
		openExternal,
		openSurface,
		openRecordingOffset,
		openTimedRecording,
		openTrackRate,
		openWorkspacePanel,
		parityUi.request,
		parityUi.request?.revision,
		project?.sampleRate,
		run,
		selectedTrack?.id,
		selectedTrack?.name,
		snapshot.timeline?.pixelsPerSecond,
		toggleFullscreen,
	]);
}
