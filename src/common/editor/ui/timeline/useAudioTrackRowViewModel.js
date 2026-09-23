/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useState } from 'react';

import {
	framesToSeconds,
	projectClipsToViewport,
	rightmostVisibleClip,
} from '../../design-system-adapters.js';
import { audacityWaveformMode } from '../../audacity-waveform-renderer.js';
import { waveformPeakLevelForResolution } from '../../design-system-adapters/waveform-internals.ts';
import { MAXIMUM_WAVEFORM_PEAK_WINDOW_BUCKETS } from '../../waveform-peak-contract.ts';
import { isFrequencyWaveformDisplayMode } from '../../track-display-mode.ts';
import { createAudioTrackRowClipViewModels } from './audio-track-row-view-model.js';
import { createCrossfadeOverlays } from './TrackOverlapOverlays.jsx';
import {
	pcmWindowCoversProjectedClip,
	MINIMUM_VISIBLE_CLIP_PIXELS,
	projectedClipVisibleSourceSamples,
	recordingPreviewId,
} from './preview.ts';
import { useAudioTrackEnvelope } from './useAudioTrackEnvelope.js';

const WAVEFORM_PCM_PREFETCH_BUCKET_PIXELS = 0.25;

function waveformPrefetchPixelWidth(pixelWidth) {
	const renderedWidth = Math.max(MINIMUM_VISIBLE_CLIP_PIXELS, pixelWidth);
	return Math.min(
		MAXIMUM_WAVEFORM_PEAK_WINDOW_BUCKETS,
		Math.max(
			renderedWidth,
			Math.min(
				renderedWidth / WAVEFORM_PCM_PREFETCH_BUCKET_PIXELS,
				MAXIMUM_WAVEFORM_PEAK_WINDOW_BUCKETS / 2,
			),
		),
	);
}

/** Choose a fourfold prefetch width, or PCM only when peaks cannot serve the view. */
export function timelineWaveformPcmWindowRequestPixelWidth({ visual, clip, project, pixelWidth, displayMode = 'waveform' }) {
	if (!visual?.available || visual.buffer || pcmWindowCoversProjectedClip(visual.pcmWindow, clip, project)) {
		return null;
	}
	const visibleSourceSamples = projectedClipVisibleSourceSamples(clip, project);
	if (!(visibleSourceSamples > 0) || !(pixelWidth > 0)) return null;
	if (displayMode === 'spectrogram') {
		return audacityWaveformMode(pixelWidth / visibleSourceSamples) === 'summary'
			? null
			: undefined;
	}
	const requestPixelWidth = waveformPrefetchPixelWidth(pixelWidth);
	if (clip.warpMap != null) return requestPixelWidth;
	if (!visual.peaks) return requestPixelWidth;
	try {
		return waveformPeakLevelForResolution(
			visual.peaks,
			visibleSourceSamples / requestPixelWidth,
		) === null
			? requestPixelWidth
			: null;
	} catch {
		// PCM can still draw a source whose persisted peak cache is stale or invalid.
		return requestPixelWidth;
	}
}

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
	halfWave = displayMode === 'half-wave',
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
	const [frequencyWaveformModule, setFrequencyWaveformModule] = useState(null);

	useEffect(() => {
		if (!isFrequencyWaveformDisplayMode(displayMode) || frequencyWaveformModule) return undefined;
		let active = true;
		void import('./frequency-waveform-projection.ts').then((module) => {
			if (active) setFrequencyWaveformModule(module);
		}).catch(() => {});
		return () => { active = false; };
	}, [displayMode, frequencyWaveformModule]);

	const waveformWindowRequests = useMemo(() => {
		const requests = new Map();
		for (const clip of projection.clips) {
			if (clip.isRecordingPreview) continue;
			const visual = controller.getClipVisualData(clip.id)
				|| controller.getProjectBinClipVisualData?.(clip.projectBinClipId || clip.id);
			const pixelWidth = (clip.waveformEndFrame - clip.waveformStartFrame) / sampleRate * pixelsPerSecond;
			const requestPixelWidth = timelineWaveformPcmWindowRequestPixelWidth({
				visual, clip, project, pixelWidth, displayMode,
			});
			if (requestPixelWidth === null) continue;
			requests.set(String(clip.id), { clip, pixelWidth: requestPixelWidth });
		}
		return requests;
	}, [controller, displayMode, pixelsPerSecond, project, projection.clips, sampleRate, viewModelRevision]);
	useEffect(() => {
		const requestWindow = controller.actions.timeline.requestWaveformPcmWindow;
		if (typeof requestWindow !== 'function') return;
		for (const { clip, pixelWidth } of waveformWindowRequests.values()) {
			run(() => requestWindow(clip.id, {
				startFrame: clip.waveformStartFrame,
				endFrame: clip.waveformEndFrame,
				...(pixelWidth === undefined ? {} : { pixelWidth }),
			}));
		}
	}, [controller, run, waveformWindowRequests]);

	useEffect(() => {
		if (!isFrequencyWaveformDisplayMode(displayMode) || !frequencyWaveformModule) return;
		frequencyWaveformModule.requestVisibleFrequencyWaveforms({
			controller, clips: projection.clips, project, pixelsPerSecond, sampleRate, run,
		});
	}, [
		controller,
		displayMode,
		frequencyWaveformModule,
		pixelsPerSecond,
		project,
		projection.clips,
		run,
		sampleRate,
		viewModelRevision,
	]);

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
			halfWave,
			trackColor: track.color,
			waveformCache,
			draggingClipIds,
			waveformPendingClipIds: displayMode === 'spectrogram' ? null : waveformWindowRequests,
			envelopePreviews: envelopePreviewRef.current,
			frequencyWaveformProjector: frequencyWaveformModule?.prepareFrequencyWaveformClipProjection,
			frequencyWaveformPreferences: viewModelRevision?.preferences?.waveformVisualization,
		});
	}, [
		controller,
		copy,
		displayMode,
		draggingClipIds,
		envelopePreviewRef,
		envelopePreviewRevision,
		frequencyWaveformModule,
		pixelsPerSecond,
		project,
		projection.clips,
		projection.overscanStartFrame,
		recordingPreview,
		sampleRate,
		selectedClipId,
		selectedClipIdSet,
		showRms,
		halfWave,
		sourceLookup,
		track.color,
		viewModelRevision,
		waveformWindowRequests,
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
