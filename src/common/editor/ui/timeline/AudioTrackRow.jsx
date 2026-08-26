import { useRef } from 'react';
import { FrequencyRuler } from '@soundscaper/design-system/VerticalRuler';
import { TrackNew } from '@soundscaper/design-system/Track/TrackNew';

import { editorTimelineDurationFrames } from '../../project.js';
import { TrackControls } from './TrackControls.jsx';
import { AutomaticCrossfadeOverlays } from './TrackOverlapOverlays.jsx';
import { AudacityWaveformCanvases } from './TimelineCanvasRenderer.jsx';
import { SpectralBrushOverlay } from './SpectralBrushOverlay.jsx';
import { SpectralSelectionOverlay } from './SpectralSelectionOverlay.jsx';
import {
	normalizeSpectrogramScale,
} from './geometry.ts';
import { clipGroups, focusFirst } from './timeline-navigation.js';
import { renderAmplitudeRulers } from './track-row-helpers.jsx';
import { useAudioTrackRowNavigation } from './useAudioTrackRowNavigation.js';
import { useAudioTrackRowViewModel } from './useAudioTrackRowViewModel.js';
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
	renderViewportStartFrame,
	viewportDurationFrames,
	viewModelRevision,
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
	spectralBrushEnabled,
	blocked,
	canonicalVideoTrim,
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
	const {
		projection,
		projectedClips,
		projectedSelection,
		crossfadeOverlays,
		rulerChannelCount,
		windowLeft,
		windowWidth,
		updateEnvelope,
	} = useAudioTrackRowViewModel({
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
	});
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
		canonicalVideoTrim,
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
						onClipRename={blocked ? undefined : (clipId, title) => {
							const nextTitle = String(title).trim();
							if (!nextTitle) return;
							run(() => controller.actions.clip.update(String(clipId), { title: nextTitle }));
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
					{spectralBrushEnabled && selectedTrackId === track.id
						&& ['spectrogram', 'multiview'].includes(displayMode) && (
						<SpectralBrushOverlay
							track={track}
							displayMode={displayMode}
							trackHeight={trackHeight}
							windowWidth={windowWidth}
							overscanStartFrame={projection.overscanStartFrame}
							pixelsPerSecond={pixelsPerSecond}
							sampleRate={sampleRate}
							disabled={blocked}
							copy={copy}
							onCommit={(request) => run(() => controller.actions.spectral.brushSelect(request))}
						/>
					)}
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
