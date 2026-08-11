import { useEffect, useMemo, useRef } from 'react';
import { FrequencyRuler, TrackNew } from '@dilsonspickles/components';

import {
	framesToSeconds,
	projectClipsToViewport,
	rightmostVisibleClip,
} from '../../design-system-adapters.js';
import { audacityWaveformMode } from '../../audacity-waveform-renderer.js';
import { editorTimelineDurationFrames } from '../../project.js';
import { TrackControls } from './TrackControls.jsx';
import { AutomaticCrossfadeOverlays, createCrossfadeOverlays } from './TrackOverlapOverlays.jsx';
import { AudacityWaveformCanvases } from './TimelineCanvasRenderer.jsx';
import { SpectralSelectionOverlay } from './SpectralSelectionOverlay.jsx';
import {
	normalizeSpectrogramScale,
} from './geometry.ts';
import {
	pcmWindowCoversProjectedClip,
	recordingPreviewId,
	toDesignRecordingPreview,
} from './preview.ts';
import { clipGroups, focusFirst } from './timeline-navigation.js';
import { renderAmplitudeRulers } from './track-row-helpers.jsx';
import { useAudioTrackEnvelope } from './useAudioTrackEnvelope.js';
import { useAudioTrackRowNavigation } from './useAudioTrackRowNavigation.js';
import { createTimelineClipViewModel } from './waveform-view-model.ts';
import { resolveAudioEditorColor } from './TimelineOverlayComponents.jsx';

const CLIP_HEADER_HEIGHT = 20;

export function AudioTrackRow({
	controller,
	project,
	track,
	visualHeight,
	trackClips,
	clipLookup,
	sourceLookup,
	trackIndex,
	trackCount,
	isFlatNavigation,
	trackBaseTabIndex,
	panelWidth,
	viewportStartFrame,
	viewportDurationFrames,
	pixelsPerSecond,
	sampleRate,
	timelineWidth,
	verticalRulerWidth,
	selection,
	spectralSelection,
	selectedTrackId,
	selectedClipId,
	selectedClipIdSet,
	timelineView,
	showRms,
	waveformRulerFormat,
	waveformZoom,
	clipStyle,
	recordingPreview,
	draggingClipIds,
	clipDragPreview,
	projectBinDragPreview,
	waveformCache,
	automationToolEnabled,
	blocked,
	showArmControls,
	displayAudioSupported,
	recordingInputs,
	copy,
	run,
	onMenu,
	onOpenEffects,
	onOpenClipMenu,
	onOpenRulerFlyout,
	onFocusTimelineRuler,
	onFocusTrackContainer,
	onFocusTrackPanelControl,
	onFocusTrackClip,
	onFocusTrackRuler,
	onFocusSelectionToolbar,
}) {
	const trackWindowRef = useRef(null);
	const trackHeight = visualHeight;
	const displayMode = track.displayMode && track.displayMode !== 'waveform' ? track.displayMode : timelineView;
	const spectrogramScale = normalizeSpectrogramScale(track.spectrogram?.scale);
	const clips = useMemo(() => {
		const withRecordingPreview = recordingPreview?.durationFrames > 0 ? [...trackClips, {
			id: recordingPreviewId(track.id),
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
				if (track.id !== preview.trackId) continue;
				const draggedClip = clipLookup.get(preview.clipId);
				if (draggedClip) projected.push({ ...draggedClip, ...preview });
			}
		}
		for (const preview of projectBinDragPreview?.previews || (projectBinDragPreview ? [projectBinDragPreview] : [])) {
			if (preview.trackId !== track.id || preview.clip?.kind !== track.type) continue;
			projected.push({
				...preview.clip,
				timelineStartFrame: preview.timelineStartFrame,
				groupId: null,
				projectBinClipId: preview.clip.id,
			});
		}
		return projected;
	}, [clipDragPreview, clipLookup, projectBinDragPreview, recordingPreview, track.id, track.type, trackClips]);
	const projection = useMemo(() => projectClipsToViewport(clips, {
		viewportStartFrame,
		viewportDurationFrames,
		sampleRate,
	}), [clips, sampleRate, viewportDurationFrames, viewportStartFrame]);
	const { envelopePreviewRef, updateEnvelope } = useAudioTrackEnvelope({
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
				|| audacityWaveformMode(pixelWidth / visibleSourceSamples) === 'summary') continue;
			run(() => requestWindow(clip.id, {
				startFrame: clip.waveformStartFrame,
				endFrame: clip.waveformEndFrame,
			}));
		}
	}, [controller, pixelsPerSecond, projection.clips, run, sampleRate]);
	const windowLeft = framesToSeconds(projection.overscanStartFrame, { sampleRate }) * pixelsPerSecond;
	const windowFrames = Math.max(1, projection.overscanEndFrame - projection.overscanStartFrame);
	const windowWidth = Math.max(1, framesToSeconds(windowFrames, { sampleRate }) * pixelsPerSecond);
	const projectedClips = projection.clips.map((clip) => clip.isRecordingPreview
		? toDesignRecordingPreview(
			clip,
			recordingPreview,
			projection.overscanStartFrame,
			pixelsPerSecond,
			sampleRate,
			copy,
			displayMode === 'multiview',
		)
		: createTimelineClipViewModel({
			controller,
			sourceLookup,
			clip,
			geometry: {
				overscanStartFrame: projection.overscanStartFrame,
				pixelsPerSecond,
				sampleRate,
			},
			selection: {
				selectedClipIds: selectedClipIdSet.size ? selectedClipIdSet : selectedClipId,
			},
			copy,
			rendering: {
				showRms,
				halfWave: displayMode === 'half-wave',
				color: resolveAudioEditorColor(clip.color, resolveAudioEditorColor(track.color)),
				reuseSummaryForCompatibility: displayMode === 'waveform' || displayMode === 'half-wave',
				allowPeakPyramid: displayMode !== 'spectrogram',
				provideAudacitySpectrogram: displayMode === 'spectrogram' || displayMode === 'multiview',
			},
			cache: waveformCache,
			reuseCachedWaveform: Boolean(
				draggingClipIds?.has(clip.id)
					&& clip.waveformPreviewKind !== 'trim'
					&& clip.waveformPreviewKind !== 'rate-stretch',
			),
		})).map((clip) => {
			const preview = envelopePreviewRef.current.get(String(clip.id));
			return preview ? {
				...clip,
				envelopePoints: preview.designPoints,
				audacityWaveform: clip.audacityWaveform
					? { ...clip.audacityWaveform, envelope: preview.envelope }
					: undefined,
			} : clip;
		});
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
			element.setAttribute(
				'data-slip-slide-preview-source-start',
				String(preview.sourceStartFrame),
			);
			element.setAttribute(
				'data-slip-slide-preview-source-end',
				String(preview.sourceStartFrame + preview.sourceDurationFrames),
			);
		}
	}, [projection.clips]);
	const crossfadeOverlays = useMemo(() => createCrossfadeOverlays(
		projection.clips,
		projection.overscanStartFrame,
		pixelsPerSecond,
		sampleRate,
	), [pixelsPerSecond, projection.clips, projection.overscanStartFrame, sampleRate]);
	const measuredProjectionClip = rightmostVisibleClip(projection.clips);
	const measuredClip = measuredProjectionClip
		? projectedClips.find((clip) => String(clip.id) === String(measuredProjectionClip.id))
		: null;
	const measuredSource = measuredProjectionClip?.sourceId
		? sourceLookup.get(measuredProjectionClip.sourceId)
		: null;
	const rulerChannelCount = Math.max(1, Math.min(2,
		measuredClip?.audacityWaveform?.channels?.length
			|| measuredClip?.channelCount
			|| measuredSource?.channelCount
			|| 1,
	));
	const projectedSelection = selection ? {
		startTime: selection.startTime - framesToSeconds(projection.overscanStartFrame, { sampleRate }),
		endTime: selection.endTime - framesToSeconds(projection.overscanStartFrame, { sampleRate }),
	} : null;
	const activeSpectralSelection = spectralSelection?.frequencyRange && selectedTrackId === track.id
		? spectralSelection
		: null;
	const {
		tabIndexFor,
		focusBeforeTrack,
		focusAfterPanel,
		focusBeforeRuler,
		focusAfterRuler,
		moveClipBySeconds,
		moveClipToTrack,
		navigateClipVertical,
		trimClipBySeconds,
		stretchClipBySeconds,
	} = useAudioTrackRowNavigation({
		controller,
		project,
		track,
		trackWindowRef,
		projectedClips,
		clipLookup,
		sourceLookup,
		trackIndex,
		trackCount,
		isFlatNavigation,
		trackBaseTabIndex,
		sampleRate,
		blocked,
		run,
		onFocusTimelineRuler,
		onFocusTrackContainer,
		onFocusTrackPanelControl,
		onFocusTrackClip,
		onFocusTrackRuler,
		onFocusSelectionToolbar,
	});

	return (
		<div
			className="audio-editor-track-row"
			data-track-row
			data-track-id={track.id}
			data-track-index={trackIndex}
			data-track-color={resolveAudioEditorColor(track.color)}
			data-collapsed="false"
			data-display-mode={displayMode || 'waveform'}
			style={{ height: trackHeight }}
		>
			<TrackControls
				controller={controller}
				track={track}
				trackHeight={trackHeight}
				panelWidth={panelWidth}
				selected={selectedTrackId === track.id}
				blocked={blocked}
				showArmControls={showArmControls}
				displayAudioSupported={displayAudioSupported}
				recordingInputs={recordingInputs}
				isFlatNavigation={isFlatNavigation}
				copy={copy}
				run={run}
				onMenu={onMenu}
				onOpenEffects={onOpenEffects}
				onTabOut={focusAfterPanel}
				onShiftTabOut={() => onFocusTrackContainer(trackIndex)}
				onNavigateVertical={(direction) => {
					const targetIndex = trackIndex + (direction === 'down' ? 1 : -1);
					if (targetIndex >= 0 && targetIndex < trackCount) {
						onFocusTrackPanelControl(targetIndex);
					}
				}}
			/>
			<div
				className="audio-editor-track-lane"
				data-track-lane
				data-track-id={track.id}
				data-spectrogram-scale={track.spectrogram?.scale || 'mel'}
				data-spectrogram-minimum-frequency={track.spectrogram?.minimumFrequency ?? 0}
				data-spectrogram-maximum-frequency={track.spectrogram?.maximumFrequency ?? sampleRate / 2}
				data-spectrogram-window-size={track.spectrogram?.windowSize ?? 2048}
				data-spectrogram-range={track.spectrogram?.range ?? 80}
				aria-label={track.name}
				data-selected={selectedTrackId === track.id}
				style={{ marginLeft: panelWidth, width: timelineWidth + verticalRulerWidth, height: trackHeight }}
				onClick={(event) => {
					if (event.target.closest('[data-clip-id]')) return;
					run(() => controller.actions.timeline.selectTrack(track.id));
				}}
			>
				<div
					ref={trackWindowRef}
					className="audio-editor-track-window"
					style={{ left: windowLeft, width: windowWidth }}
					onFocusCapture={(event) => {
						if (isFlatNavigation || !event.target.matches?.('[data-clip-id][role="group"]')) return;
						for (const clip of clipGroups(trackWindowRef.current)) clip.tabIndex = -1;
						event.target.tabIndex = tabIndexFor(2);
					}}
					onKeyDownCapture={(event) => {
						if (!event.target.matches?.('[data-clip-id][role="group"]')) return;
						if (event.key === 'Enter') {
							event.preventDefault();
							event.stopPropagation();
							run(() => controller.actions.timeline.selectClip(String(event.target.dataset.clipId), {
								additive: event.shiftKey,
								toggle: event.metaKey || event.ctrlKey,
							}));
							return;
						}
						if (
							event.altKey
							|| event.ctrlKey
							|| event.metaKey
							|| event.shiftKey
							|| (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
						) return;
						const clips = clipGroups(trackWindowRef.current);
						const currentIndex = clips.indexOf(event.target);
						if (currentIndex < 0 || clips.length < 2) return;
						event.preventDefault();
						event.stopPropagation();
						const direction = event.key === 'ArrowRight' ? 1 : -1;
						const next = clips[(currentIndex + direction + clips.length) % clips.length];
						if (!isFlatNavigation) {
							for (const clip of clips) clip.tabIndex = clip === next ? tabIndexFor(2) : -1;
						}
						focusFirst(next);
					}}
				>
					<TrackNew
						clips={projectedClips}
						height={trackHeight}
						trackIndex={trackIndex}
						isSelected={selectedTrackId === track.id}
						isMuted={track.mute}
						envelopeMode={automationToolEnabled && !blocked}
						onEnvelopePointsChange={updateEnvelope}
						pixelsPerSecond={pixelsPerSecond}
						width={windowWidth}
						spectrogramMode={displayMode === 'spectrogram' && !recordingPreview}
						splitView={displayMode === 'multiview'}
						spectrogramScale={spectrogramScale}
						timeSelection={projectedSelection}
						clipStyle={clipStyle === 'classic' ? 'classic' : 'colourful'}
						color={resolveAudioEditorColor(track.color)}
						draggingClipIds={draggingClipIds || undefined}
						tabIndex={tabIndexFor(2)}
						trackTabIndex={tabIndexFor(0)}
						onTrackNavigateVertical={(direction) => {
							const targetIndex = trackIndex + direction;
							if (targetIndex >= 0 && targetIndex < trackCount) onFocusTrackContainer(targetIndex);
						}}
						onContainerFocusChange={(hasFocus) => {
							if (hasFocus && selectedTrackId !== track.id) {
								run(() => controller.actions.timeline.selectTrack(track.id));
							}
						}}
						onEnterPanel={() => onFocusTrackPanelControl(trackIndex)}
						onShiftTabOut={focusBeforeTrack}
						onContainerEnter={() => run(() => controller.actions.timeline.selectTrack(track.id))}
						onTabFromLastClip={() => onFocusTrackRuler(trackIndex)}
						onClipClick={(clipId, shiftKey, metaKey) => {
							if (!shiftKey && !metaKey) return;
							run(() => controller.actions.timeline.selectClip(String(clipId), {
								additive: Boolean(shiftKey),
								toggle: Boolean(metaKey),
							}));
						}}
						onClipHeaderClick={(clipId, _clipStartTime, shiftKey, metaKey) => {
							if (!shiftKey && !metaKey) return;
							run(() => controller.actions.timeline.selectClip(String(clipId), {
								additive: Boolean(shiftKey),
								toggle: Boolean(metaKey),
							}));
						}}
						onClipMenuClick={onOpenClipMenu}
						onClipTrimEdge={() => {
							// Pointer geometry is committed by the frame-canonical adapter on pointer-up.
						}}
						onClipMove={moveClipBySeconds}
						onClipMoveToTrack={moveClipToTrack}
						onClipNavigateVertical={navigateClipVertical}
						onClipTrim={trimClipBySeconds}
						onClipStretch={stretchClipBySeconds}
					/>
					<AudacityWaveformCanvases
						rootRef={trackWindowRef}
						clips={projectedClips}
						displayMode={displayMode === 'spectrogram' && recordingPreview?.durationFrames > 0 ? 'waveform' : displayMode}
						pixelsPerSecond={pixelsPerSecond}
						timeSelection={selectedTrackId === track.id ? projectedSelection : null}
						showRms={showRms}
						halfWave={displayMode === 'half-wave'}
						verticalZoom={waveformZoom}
						spectrogramScale={spectrogramScale}
					/>
					<AutomaticCrossfadeOverlays overlays={crossfadeOverlays} />
					{activeSpectralSelection && ['spectrogram', 'multiview'].includes(displayMode) && (
						<SpectralSelectionOverlay
							selection={activeSpectralSelection}
							track={track}
							displayMode={displayMode}
							trackHeight={trackHeight}
							windowWidth={windowWidth}
							overscanStartFrame={projection.overscanStartFrame}
							pixelsPerSecond={pixelsPerSecond}
							sampleRate={sampleRate}
							maximumFrame={Math.max(editorTimelineDurationFrames(project, sampleRate), activeSpectralSelection.endFrame)}
							disabled={blocked}
							copy={copy}
							onCommit={(next) => run(() => {
								controller.actions.timeline.setSelection(next.startFrame, next.endFrame);
								controller.actions.spectral.boxSelect({
									minimumFrequency: next.minimumFrequency,
									maximumFrequency: next.maximumFrequency,
								});
							})}
						/>
					)}
				</div>
				{verticalRulerWidth > 0 && <div
					className="audio-editor-vertical-ruler"
					data-track-ruler
					data-ruler-format={waveformRulerFormat}
					data-ruler-zoom={waveformZoom}
					role="region"
					aria-label={`${track.name}: ${displayMode === 'spectrogram' ? copy.spectrogramView : displayMode === 'multiview' ? copy.multiview : copy.waveformView}`}
					tabIndex={tabIndexFor(3)}
					style={{ paddingTop: CLIP_HEADER_HEIGHT }}
					onContextMenu={(event) => onOpenRulerFlyout(displayMode, event)}
					onKeyDown={(event) => {
						if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
							onOpenRulerFlyout(displayMode, event);
						} else if (event.key === 'Tab') {
							event.preventDefault();
							if (event.shiftKey) focusBeforeRuler();
							else focusAfterRuler();
						} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
							event.preventDefault();
							const targetIndex = trackIndex + (event.key === 'ArrowDown' ? 1 : -1);
							if (targetIndex >= 0 && targetIndex < trackCount) onFocusTrackRuler(targetIndex);
						} else if (event.key === 'Escape') {
							event.preventDefault();
							onFocusTrackContainer(trackIndex);
						}
					}}
				>
					{displayMode === 'spectrogram' ? (
						<FrequencyRuler
							height={Math.max(0, trackHeight - CLIP_HEADER_HEIGHT)}
							minFreq={track.spectrogram?.minimumFrequency || 0}
							maxFreq={track.spectrogram?.maximumFrequency || sampleRate / 2}
							scale={spectrogramScale}
							width={verticalRulerWidth}
						/>
					) : displayMode === 'multiview' ? (
						<>
							<FrequencyRuler
								height={Math.floor((trackHeight - CLIP_HEADER_HEIGHT) / 2)}
								minFreq={track.spectrogram?.minimumFrequency || 0}
								maxFreq={track.spectrogram?.maximumFrequency || sampleRate / 2}
								scale={spectrogramScale}
								width={verticalRulerWidth}
							/>
							{renderAmplitudeRulers(
								rulerChannelCount,
								trackHeight - CLIP_HEADER_HEIGHT - Math.floor((trackHeight - CLIP_HEADER_HEIGHT) / 2),
								verticalRulerWidth,
								displayMode,
								waveformRulerFormat,
								waveformZoom,
							)}
						</>
					) : (
						renderAmplitudeRulers(
							rulerChannelCount,
							Math.max(0, trackHeight - CLIP_HEADER_HEIGHT),
							verticalRulerWidth,
							displayMode,
							waveformRulerFormat,
							waveformZoom,
						)
					)}
				</div>}
			</div>
		</div>
	);
}
