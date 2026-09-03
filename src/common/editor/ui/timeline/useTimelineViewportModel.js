import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { useAccessibilityProfile } from '@soundscaper/design-system/contexts/AccessibilityProfileContext';
import { useTabOrder } from '@soundscaper/design-system/hooks/useTabOrder';

import {
	createTimelineProjectIndex,
	framesToSeconds,
	secondsToFrames,
} from '../../design-system-adapters.js';
import { editorTimelineDurationFrames } from '../../project.js';
import { resolveRuntimeProjectProjection } from '../../runtime-clip-projection.ts';
import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import {
	DEFAULT_TRACK_HEIGHT as TRACK_HEIGHT,
	AUTOMATION_CONTROLS_HEIGHT,
	RECORDING_INPUT_CONTROLS_HEIGHT,
	trackVisualHeight,
} from './geometry.ts';
import {
	AUTO_FIT_TRACK_HEIGHT,
	COLLAPSED_TRACK_HEIGHT,
	SPECTROGRAM_RULER_WIDTH,
	TIMELINE_RULER_ROW_HEIGHT,
	TIMELINE_RULER_ROW_HEIGHT_WITH_ANNOTATIONS,
	VERTICAL_RULER_WIDTH,
	resolveTrackPanelGeometry,
} from './constants.ts';
import { timelineAnnotationsAvailable } from './timeline-annotation-ui-model.ts';
import { useAnchoredTimelineRenderScrollX } from './timeline-render-window.ts';
import {
	createTimelineScrollSpace,
	timelineContentScrollX,
	timelineDomScrollX,
	timelineRenderOriginX,
} from './timeline-scroll-space.ts';

export function useTimelineViewportModel({
	controller,
	snapshot,
	runtimeProject,
	mobile,
	trackHeaderDrawer = null,
	showArmControls,
	automationVisibleTrackIds,
	state,
}) {
	const {
		timelineSize,
		timelineScrollSize,
		pendingPinchAnchorRef,
		scrollRef,
		waveformCacheRef,
		scrollX,
		selectionPreview,
		trackResizePreview,
	} = state;
	const persistedProject = snapshot.project;
	const project = useMemo(
		() => runtimeProject ?? (persistedProject ? resolveRuntimeProjectProjection(persistedProject) : null),
		[persistedProject, runtimeProject],
	);
	const transportState = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.transportState);
	const { activeProfile } = useAccessibilityProfile();
	const isFlatNavigation = activeProfile.config.tabNavigation === 'sequential';
	const timelineRulerTabIndex = useTabOrder('timeline-ruler');
	const trackBaseTabIndex = useTabOrder('tracks');
	const addTrackTabIndex = useTabOrder('add-track');
	const { panelWidth, trackHeaderWidth } = resolveTrackPanelGeometry({ drawer: Boolean(trackHeaderDrawer), mobile });
	const showMasterTrack = Boolean(snapshot.preferences?.view?.showMasterTrack);
	const outputTracks = useMemo(() => [
		...(project?.mixer?.groups || []).map((bus) => ({ key: `group:${bus.id}`, scope: 'group', bus })),
		...(project?.mixer?.sends || []).map((bus) => ({ key: `send:${bus.id}`, scope: 'send', bus })),
		...(showMasterTrack && project?.master
			? [{ key: 'master', scope: 'master', bus: project.master }]
			: []),
	], [project?.master, project?.mixer?.groups, project?.mixer?.sends, showMasterTrack]);
	const outputDockContentHeight = outputTracks.reduce(
		(total, { bus }) => total + (bus.collapsed === false ? TRACK_HEIGHT : COLLAPSED_TRACK_HEIGHT),
		0,
	);
	const outputDockMaximumHeight = Math.max(
		COLLAPSED_TRACK_HEIGHT,
		Math.floor((timelineSize.height || COLLAPSED_TRACK_HEIGHT * 3) / 3),
	);
	const outputDockHeight = Math.min(outputDockContentHeight, outputDockMaximumHeight);
	const showTimelineAnnotations = timelineAnnotationsAvailable({
		capabilities: snapshot.capabilities,
		project,
	});
	const showMarkers = Boolean(snapshot.preferences?.view?.showMarkers);
	const markerLaneVisible = showTimelineAnnotations && showMarkers;
	const rulerRowHeight = markerLaneVisible
		? TIMELINE_RULER_ROW_HEIGHT_WITH_ANNOTATIONS
		: TIMELINE_RULER_ROW_HEIGHT;
	const autoFitTrackHeightEnabled = snapshot.timeline?.autoFitTrackHeight !== false;
	const expandedTrackCount = project?.tracks.length || 0;
	// Armed audio tracks carry a recording input row on top of their lane, so the
	// fitted lane height has to reserve it or the row overlaps the track controls.
	const armedTrackCount = showArmControls
		? (project?.tracks.filter((track) => track.type === 'audio').length || 0)
		: 0;
	const automationControlsTrackCount = project?.tracks.filter((track) => (
		track.type === 'audio' && automationVisibleTrackIds?.has(track.id)
	)).length || 0;
	// The scroll viewport already excludes the output dock and the annotation
	// panel, so only the sticky ruler row has to come off the top.
	const availableTrackHeight = Math.max(
		TRACK_HEIGHT,
		Math.floor((timelineScrollSize.height || AUTO_FIT_TRACK_HEIGHT + rulerRowHeight) - rulerRowHeight)
		- armedTrackCount * RECORDING_INPUT_CONTROLS_HEIGHT
		- automationControlsTrackCount * AUTOMATION_CONTROLS_HEIGHT,
	);
	const fittedTrackHeight = expandedTrackCount > 0
		? Math.max(TRACK_HEIGHT, Math.min(
			AUTO_FIT_TRACK_HEIGHT,
			Math.floor(availableTrackHeight / expandedTrackCount),
		))
		: AUTO_FIT_TRACK_HEIGHT;
	const timelineView = snapshot.timeline?.view;
	const hasFrequencyRuler = snapshot.timeline?.showVerticalRulers !== false
		&& project?.tracks.some((track) => {
			if (track.type !== 'audio') return false;
			const mode = track.displayMode && track.displayMode !== 'waveform' ? track.displayMode : timelineView;
			return mode === 'spectrogram' || mode === 'multiview';
		});
	const verticalRulerWidth = snapshot.timeline?.showVerticalRulers === false
		? 0
		: (hasFrequencyRuler ? SPECTROGRAM_RULER_WIDTH : VERTICAL_RULER_WIDTH);
	const viewportWidth = Math.max(1, timelineSize.width - panelWidth - verticalRulerWidth);
	const pixelsPerSecond = snapshot.timeline?.pixelsPerSecond || 120;
	const sampleRate = project?.sampleRate || 48_000;
	const recordingPreviews = snapshot.recordingPreviews?.length
		? snapshot.recordingPreviews
		: snapshot.recordingPreview ? [snapshot.recordingPreview] : [];
	const durationFrames = Math.max(
		project ? editorTimelineDurationFrames(project, sampleRate) : sampleRate * 30,
		...recordingPreviews.map((preview) => preview.startFrame + preview.durationFrames),
	);
	const durationSeconds = framesToSeconds(durationFrames, { sampleRate });
	// Sample-depth zoom asks for a surface far wider than a browser will lay
	// out, so the scroll box is capped and the reported offset is scaled back
	// onto the content space the timeline draws in.
	const contentWidth = Math.max(viewportWidth, Math.ceil(durationSeconds * pixelsPerSecond));
	const scrollSpace = useMemo(
		() => createTimelineScrollSpace({ contentWidth, viewportWidth }),
		[contentWidth, viewportWidth],
	);
	const timelineWidth = scrollSpace.scrollWidth;
	const contentScrollX = timelineContentScrollX(scrollSpace, scrollX);
	const renderOriginX = timelineRenderOriginX(scrollSpace, scrollX);
	useLayoutEffect(() => {
		const pending = pendingPinchAnchorRef.current;
		if (!pending) return;
		pendingPinchAnchorRef.current = null;
		if (!scrollRef.current) return;
		scrollRef.current.scrollLeft = timelineDomScrollX(
			scrollSpace,
			Math.max(0, pending.anchorSeconds * pixelsPerSecond - pending.anchorOffset),
		);
		scrollRef.current.dispatchEvent(new Event('scroll', { bubbles: true }));
	}, [pendingPinchAnchorRef, pixelsPerSecond, scrollRef, scrollSpace]);
	const viewportStartFrame = Math.max(0, secondsToFrames(contentScrollX / pixelsPerSecond, { sampleRate }));
	const viewportDurationFrames = Math.max(1, secondsToFrames(viewportWidth / pixelsPerSecond, { sampleRate }));
	const renderScrollX = useAnchoredTimelineRenderScrollX({
		scrollX: contentScrollX,
		viewportWidth,
		pixelsPerSecond,
		sampleRate,
		resetToken: project,
	});
	const renderViewportStartFrame = Math.max(
		0,
		secondsToFrames(renderScrollX / pixelsPerSecond, { sampleRate }),
	);
	const projectIndex = useMemo(
		() => createTimelineProjectIndex(project),
		[project?.clips, project?.sources, project?.tracks],
	);
	const projectClipIds = useMemo(
		() => new Set([...projectIndex.clipById.keys()].map(String)),
		[projectIndex],
	);
	const selectedClipIdSet = useMemo(
		() => new Set(project?.selection?.clipIds || []),
		[project?.selection?.clipIds],
	);
	for (const clipId of waveformCacheRef.current.keys()) {
		if (!projectClipIds.has(clipId)) waveformCacheRef.current.delete(clipId);
	}

	useEffect(() => {
		controller.actions.timeline.setViewportWidth(viewportWidth);
	}, [controller, viewportWidth]);

	const documentSelection = selectionPreview || snapshot.selection;
	const timeSelection = documentSelection && documentSelection.endFrame > documentSelection.startFrame
		? {
			startTime: framesToSeconds(documentSelection.startFrame, { sampleRate }),
			endTime: framesToSeconds(documentSelection.endFrame, { sampleRate }),
		}
		: null;
	const visualTrackHeight = useCallback((track) => {
		const showAutomationControls = automationVisibleTrackIds?.has(track.id) === true;
		if (trackResizePreview?.trackId === track.id) {
			return trackVisualHeight(track, showArmControls, trackResizePreview.height, showAutomationControls);
		}
		if (autoFitTrackHeightEnabled) return trackVisualHeight(
			track, showArmControls, fittedTrackHeight, showAutomationControls,
		);
		return trackVisualHeight(track, showArmControls, undefined, showAutomationControls);
	}, [automationVisibleTrackIds, autoFitTrackHeightEnabled, fittedTrackHeight, showArmControls, trackResizePreview]);
	const totalTrackHeight = project?.tracks.reduce((total, track) => total + visualTrackHeight(track), 0) || TRACK_HEIGHT;

	return {
		project,
		transportState,
		isFlatNavigation,
		timelineRulerTabIndex,
		trackBaseTabIndex,
		addTrackTabIndex,
		panelWidth,
		trackHeaderWidth,
		showMasterTrack,
		outputTracks,
		outputDockHeight,
		timelineView,
		verticalRulerWidth,
		viewportWidth,
		pixelsPerSecond,
		sampleRate,
		recordingPreviews,
		durationFrames,
		durationSeconds,
		contentWidth,
		timelineWidth,
		scrollSpace,
		contentScrollX,
		renderOriginX,
		viewportStartFrame,
		renderScrollX,
		renderViewportStartFrame,
		viewportDurationFrames,
		projectIndex,
		selectedClipIdSet,
		documentSelection,
		timeSelection,
		visualTrackHeight,
		totalTrackHeight,
		showTimelineAnnotations,
		showMarkers,
		markerLaneVisible,
		rulerRowHeight,
		scrollViewportHeight: timelineScrollSize.height,
	};
}
