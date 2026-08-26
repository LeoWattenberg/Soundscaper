/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo } from 'react';

import {
	framesToSeconds,
	projectClipsToViewport,
	rightmostVisibleClip,
} from '../../design-system-adapters.js';
import { audacityWaveformMode } from '../../audacity-waveform-renderer.js';
import { createAudioTrackRowClipViewModels } from './audio-track-row-view-model.js';
import { createCrossfadeOverlays } from './TrackOverlapOverlays.jsx';
import {
	pcmWindowCoversProjectedClip,
	recordingPreviewId,
} from './preview.ts';
import { useAudioTrackEnvelope } from './useAudioTrackEnvelope.js';

/**
 * Retain the expensive audio-row projection while exact scrolling remains
 * inside the timeline render anchor. The parent can still render exact rulers,
 * hit testing, and annotations without recreating canvas effect inputs.
 */
export function useAudioTrackRowViewModel({
	controller,
	project,
	track,
	trackClips,
	clipLookup,
	sourceLookup,
	trackWindowRef,
	renderViewportStartFrame,
	viewportDurationFrames,
	viewModelRevision,
	pixelsPerSecond,
	sampleRate,
	selection,
	selectedClipId,
	selectedClipIdSet,
	displayMode,
	showRms,
	recordingPreview,
	clipDragPreview,
	projectBinDragPreview,
	waveformCache,
	draggingClipIds,
	copy,
	run,
	blocked,
	automationToolEnabled,
}) {
	const trackId = track.id;
	const trackType = track.type;
	const clips = useMemo(() => projectAudioTrackRowClips({
		trackId,
		trackType,
		trackClips,
		clipLookup,
		recordingPreview,
		clipDragPreview,
		projectBinDragPreview,
	}), [clipDragPreview, clipLookup, projectBinDragPreview, recordingPreview, trackClips, trackId, trackType]);
	const projection = useMemo(() => projectClipsToViewport(clips, {
		viewportStartFrame: renderViewportStartFrame,
		viewportDurationFrames,
		sampleRate,
	}), [clips, renderViewportStartFrame, sampleRate, viewportDurationFrames]);
	const { envelopePreviewRef, envelopePreviewRevision, updateEnvelope } = useAudioTrackEnvelope({
		controller,
		run,
		blocked,
		automationToolEnabled,
		clipLookup,
		projectionClips: projection.clips,
		sampleRate,
	});

	useEffect(() => {
		const requestWindow = controller.actions.timeline.requestWaveformPcmWindow;
		if (typeof requestWindow !== 'function') return;
		for (const clip of projection.clips) {
			if (clip.isRecordingPreview) continue;
			const visual = controller.getClipVisualData(clip.id)
				|| controller.getProjectBinClipVisualData?.(clip.projectBinClipId || clip.id);
			if (!visual?.available || visual.buffer || pcmWindowCoversProjectedClip(visual.pcmWindow, clip)) continue;
			const sourceDurationFrames = clip.sourceDurationFrames || clip.durationFrames;
			const visibleSourceSamples = (clip.waveformEndFrame - clip.waveformStartFrame)
				* sourceDurationFrames / clip.durationFrames;
			const pixelWidth = (clip.waveformEndFrame - clip.waveformStartFrame) / sampleRate * pixelsPerSecond;
			if (!(visibleSourceSamples > 0) || !(pixelWidth > 0)
				|| (clip.warpMap == null
					&& audacityWaveformMode(pixelWidth / visibleSourceSamples) === 'summary')) continue;
			run(() => requestWindow(clip.id, {
				startFrame: clip.waveformStartFrame,
				endFrame: clip.waveformEndFrame,
			}));
		}
	}, [controller, pixelsPerSecond, projection.clips, run, sampleRate]);

	const windowLeft = framesToSeconds(projection.overscanStartFrame, { sampleRate }) * pixelsPerSecond;
	const windowFrames = Math.max(1, projection.overscanEndFrame - projection.overscanStartFrame);
	const windowWidth = Math.max(1, framesToSeconds(windowFrames, { sampleRate }) * pixelsPerSecond);
	const projectedClips = useMemo(() => {
		// These revisions deliberately invalidate visual data held behind stable
		// controller and preview refs without making exact scroll a dependency.
		void envelopePreviewRevision;
		void viewModelRevision;
		return createAudioTrackRowClipViewModels({
			controller,
			sourceLookup,
			clips: projection.clips,
			recordingPreview,
			overscanStartFrame: projection.overscanStartFrame,
			pixelsPerSecond,
			sampleRate,
			copy,
			displayMode,
			project,
			selectedClipIds: selectedClipIdSet.size ? selectedClipIdSet : selectedClipId,
			showRms,
			trackColor: track.color,
			waveformCache,
			draggingClipIds,
			envelopePreviews: envelopePreviewRef.current,
		});
	}, [
		controller,
		copy,
		displayMode,
		draggingClipIds,
		envelopePreviewRef,
		envelopePreviewRevision,
		pixelsPerSecond,
		project,
		projection.clips,
		projection.overscanStartFrame,
		recordingPreview,
		sampleRate,
		selectedClipId,
		selectedClipIdSet,
		showRms,
		sourceLookup,
		track.color,
		viewModelRevision,
		waveformCache,
	]);

	useEffect(() => {
		const root = trackWindowRef.current;
		if (!root) return;
		const previews = new Map(projection.clips
			.filter((clip) => clip.sourceSlipPreview)
			.map((clip) => [String(clip.id), clip]));
		const rateStretchPreviews = new Map(projection.clips
			.filter((clip) => clip.rateStretchPreview)
			.map((clip) => [String(clip.id), clip]));
		for (const element of root.querySelectorAll('[data-clip-id]')) {
			const preview = previews.get(String(element.dataset.clipId));
			const rateStretchPreview = rateStretchPreviews.get(String(element.dataset.clipId));
			if (rateStretchPreview) {
				element.setAttribute('data-rate-stretch-preview', 'true');
				if (rateStretchPreview.waveformPreviewKind === 'rate-stretch') {
					element.setAttribute('data-rate-stretch-waveform-preview', 'true');
				} else element.removeAttribute('data-rate-stretch-waveform-preview');
			} else {
				element.removeAttribute('data-rate-stretch-preview');
				element.removeAttribute('data-rate-stretch-waveform-preview');
			}
			if (!preview) {
				element.removeAttribute('data-slip-slide-source-preview');
				element.removeAttribute('data-slip-slide-preview-source-start');
				element.removeAttribute('data-slip-slide-preview-source-end');
				continue;
			}
			element.setAttribute('data-slip-slide-source-preview', 'true');
			element.setAttribute('data-slip-slide-preview-source-start', String(preview.sourceStartFrame));
			element.setAttribute(
				'data-slip-slide-preview-source-end',
				String(preview.sourceStartFrame + preview.sourceDurationFrames),
			);
		}
	}, [projection.clips, trackWindowRef]);

	const crossfadeOverlays = useMemo(() => createCrossfadeOverlays(
		projection.clips,
		projection.overscanStartFrame,
		pixelsPerSecond,
		sampleRate,
	), [pixelsPerSecond, projection.clips, projection.overscanStartFrame, sampleRate]);
	const rulerChannelCount = useMemo(() => audioTrackRulerChannelCount({
		projectionClips: projection.clips,
		projectedClips,
		sourceLookup,
	}), [projectedClips, projection.clips, sourceLookup]);
	const selectionStartTime = selection?.startTime ?? null;
	const selectionEndTime = selection?.endTime ?? null;
	const projectedSelection = useMemo(() => selectionStartTime === null || selectionEndTime === null
		? null
		: {
			startTime: selectionStartTime
				- framesToSeconds(projection.overscanStartFrame, { sampleRate }),
			endTime: selectionEndTime
				- framesToSeconds(projection.overscanStartFrame, { sampleRate }),
		}, [projection.overscanStartFrame, sampleRate, selectionEndTime, selectionStartTime]);

	return {
		projection,
		projectedClips,
		projectedSelection,
		crossfadeOverlays,
		rulerChannelCount,
		windowLeft,
		windowWidth,
		updateEnvelope,
	};
}

function projectAudioTrackRowClips({
	trackId,
	trackType,
	trackClips,
	clipLookup,
	recordingPreview,
	clipDragPreview,
	projectBinDragPreview,
}) {
	const withRecordingPreview = recordingPreview?.durationFrames > 0 ? [...trackClips, {
		id: recordingPreviewId(trackId),
		timelineStartFrame: recordingPreview.startFrame,
		durationFrames: recordingPreview.durationFrames,
		sourceDurationFrames: recordingPreview.durationFrames,
		isRecordingPreview: true,
	}] : trackClips;
	const projected = [...withRecordingPreview];
	if (clipDragPreview) {
		const previews = clipDragPreview.previews || [clipDragPreview];
		const previewIds = new Set(previews.map((preview) => preview.clipId));
		projected.splice(0, projected.length, ...withRecordingPreview.filter((clip) => !previewIds.has(clip.id)));
		for (const preview of previews) {
			if (trackId !== preview.trackId) continue;
			const draggedClip = clipLookup.get(preview.clipId);
			if (draggedClip) projected.push({ ...draggedClip, ...preview });
		}
	}
	for (const preview of projectBinDragPreview?.previews || (projectBinDragPreview ? [projectBinDragPreview] : [])) {
		if (preview.trackId !== trackId || preview.clip?.kind !== trackType) continue;
		projected.push({
			...preview.clip,
			timelineStartFrame: preview.timelineStartFrame,
			groupId: null,
			projectBinClipId: preview.clip.id,
		});
	}
	return projected;
}

function audioTrackRulerChannelCount({ projectionClips, projectedClips, sourceLookup }) {
	const measuredProjectionClip = rightmostVisibleClip(projectionClips);
	const measuredClip = measuredProjectionClip
		? projectedClips.find((clip) => String(clip.id) === String(measuredProjectionClip.id))
		: null;
	const measuredSource = measuredProjectionClip?.sourceId
		? sourceLookup.get(measuredProjectionClip.sourceId)
		: null;
	return Math.max(1, Math.min(2,
		measuredClip?.audacityWaveform?.channels?.length
			|| measuredClip?.channelCount
			|| measuredSource?.channelCount
			|| 1,
	));
}
