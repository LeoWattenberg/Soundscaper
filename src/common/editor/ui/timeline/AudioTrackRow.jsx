import { useEffect, useRef, useState } from 'react';
import { TrackNew } from '@soundscaper/design-system/Track/TrackNew';

import { resolveTrackWaveformOptions } from '../../track-display-mode.ts';
import { editorTimelineDurationFrames } from '../../project.js';
import { TrackControls } from './TrackControls.jsx';
import { TrackAutomationOverlay } from '../soundscaper-workflow-product-runtime.tsx';
import { AutomaticCrossfadeOverlays } from './TrackOverlapOverlays.jsx';
import { ClipFadeOverlays } from './ClipFadeOverlays.tsx';
import { AudacityWaveformCanvases } from './TimelineCanvasRenderer.jsx';
import { SpectralBrushOverlay } from './SpectralBrushOverlay.jsx';
import { SpectralSelectionOverlay } from './SpectralSelectionOverlay.jsx';
import { AudioTrackRuler } from './AudioTrackRuler.jsx';
import { selectedTrackSpectralPeaks } from './spectral-center-gesture.ts';
import { StereoChannelDivider } from './StereoChannelDivider.tsx';
import { audioEditorClipBodyGeometry } from './geometry.ts';
import { createSpectrogramCanvasOptions } from './spectrogram-canvas-options.ts';
import {
	audioEditorStereoChannelDividerRegions,
	audioEditorStereoChannelHeightRatioForDisplay,
} from './stereo-channel-height-runtime.ts';
import { timelineContentLeft } from './timeline-scroll-space.ts';
import { clipGroups, focusFirst } from './timeline-navigation.js';
import { useAudioTrackRowNavigation } from './useAudioTrackRowNavigation.js';
import { useAudioTrackRowViewModel } from './useAudioTrackRowViewModel.js';
import { resolveAudioEditorColor, TimeSelectionOverlay } from './TimelineOverlayComponents.jsx';

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
	trackHeaderWidth = panelWidth,
	renderViewportStartFrame,
	viewportDurationFrames,
	viewModelRevision,
	pixelsPerSecond,
	sampleRate,
	timelineWidth,
	verticalRulerWidth,
	selection,
	rangeSelected,
	spectralSelection,
	selectedTrackId,
	selectedClipId,
	selectedClipIdSet,
	timelineView,
	asymmetricStereoHeightsAvailable,
	channelHeightRatio,
	showRms: globalShowRms,
	waveformRulerFormat,
	waveformZoom,
	onWaveformZoom,
	clipStyle,
	recordingPreview,
	draggingClipIds,
	clipDragPreview,
	projectBinDragPreview,
	waveformCache,
	automationToolEnabled,
	automationRuntime,
	automationTargets,
	automationTarget,
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
	onAutomationTarget,
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
	const [channelHeightRatioPreview, setChannelHeightRatioPreview] = useState(null);
	const trackHeight = visualHeight;
	const {
		top: channelBodyTop,
		height: channelBodyHeight,
	} = audioEditorClipBodyGeometry(trackHeight);
	const { displayMode, halfWave, showRms } = resolveTrackWaveformOptions(track, timelineView, globalShowRms);
	const storedChannelHeightRatio = channelHeightRatio ?? 0.5;
	const displayChannelHeightRatio = audioEditorStereoChannelHeightRatioForDisplay(
		channelHeightRatioPreview ?? storedChannelHeightRatio,
		asymmetricStereoHeightsAvailable,
		displayMode,
	);
	const spectrogramOptions = createSpectrogramCanvasOptions(track.spectrogram, sampleRate);
	const spectrogramScale = spectrogramOptions.scale;
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
		halfWave,
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
	const stereoDividerEnabled = rulerChannelCount === 2
		&& asymmetricStereoHeightsAvailable
		&& !blocked;
	useEffect(() => {
		setChannelHeightRatioPreview(null);
	}, [asymmetricStereoHeightsAvailable, displayMode, track.id]);
	useEffect(() => {
		if (asymmetricStereoHeightsAvailable
			|| channelHeightRatio === undefined
			|| storedChannelHeightRatio === 0.5) return;
		run(() => controller.actions.timeline.setChannelHeightRatio(track.id, 0.5));
	}, [asymmetricStereoHeightsAvailable, channelHeightRatio, controller, run, storedChannelHeightRatio, track.id]);
	const activeSpectralSelection = spectralSelection?.frequencyRange && selectedTrackId === track.id
		? spectralSelection
		: null;
	const {
		tabIndexFor,
		focusBeforeTrack,
		focusAfterPanel,
		focusBeforeRuler,
		focusAfterRuler,
		focusCurrentPanel,
		focusCurrentRuler,
		focusCurrentTrack,
		focusPanelVertical,
		focusRulerVertical,
		focusTrackVertical,
		handleClipFocusCapture,
		handleClipKeyDownCapture,
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
				panelWidth={trackHeaderWidth}
				selected={selectedTrackId === track.id}
				blocked={blocked}
				showArmControls={showArmControls}
				displayAudioSupported={displayAudioSupported}
				recordingInputs={recordingInputs}
				automationTargets={automationTargets}
				automationTarget={automationTarget}
				automationRuntime={automationRuntime}
				isFlatNavigation={isFlatNavigation}
				copy={copy}
				run={run}
				onMenu={onMenu}
				onOpenEffects={onOpenEffects}
				onAutomationTarget={onAutomationTarget}
				onTabOut={focusAfterPanel}
				onShiftTabOut={focusCurrentTrack}
				onNavigateVertical={focusPanelVertical}
			/>
			<div
				className="audio-editor-track-lane"
				data-track-lane
				data-track-id={track.id}
				data-spectrogram-scale={track.spectrogram?.scale || 'mel'}
				data-spectrogram-minimum-frequency={track.spectrogram?.minimumFrequency ?? 0}
				data-spectrogram-maximum-frequency={track.spectrogram?.maximumFrequency ?? sampleRate / 2}
				data-spectrogram-window-size={track.spectrogram?.windowSize ?? 2048}
				data-spectrogram-window-type={track.spectrogram?.windowType ?? 'hann'}
				data-spectrogram-gain={track.spectrogram?.gain ?? 20}
				data-spectrogram-range={track.spectrogram?.range ?? 80}
				data-channel-body-top={channelBodyTop}
				data-channel-height-ratio={displayChannelHeightRatio}
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
					style={{ left: timelineContentLeft(windowLeft), width: windowWidth }}
					onFocusCapture={handleClipFocusCapture}
					onKeyDownCapture={handleClipKeyDownCapture}
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
						channelSplitRatio={displayChannelHeightRatio}
						spectrogramScale={spectrogramScale}
						timeSelection={projectedSelection}
						clipStyle={clipStyle === 'classic' ? 'classic' : 'colourful'}
						color={resolveAudioEditorColor(track.color)}
						draggingClipIds={draggingClipIds || undefined}
						tabIndex={tabIndexFor(2)}
						trackTabIndex={tabIndexFor(0)}
						onTrackNavigateVertical={focusTrackVertical}
						onContainerFocusChange={(hasFocus) => {
							if (hasFocus && selectedTrackId !== track.id) {
								run(() => controller.actions.timeline.selectTrack(track.id));
							}
						}}
						onEnterPanel={focusCurrentPanel}
						onShiftTabOut={focusBeforeTrack}
						onContainerEnter={() => run(() => controller.actions.timeline.selectTrack(track.id))}
						onTabFromLastClip={focusCurrentRuler}
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
						halfWave={halfWave}
						verticalZoom={waveformZoom}
						channelHeightRatio={displayChannelHeightRatio}
						spectrogramOptions={spectrogramOptions}
					/>
					{audioEditorStereoChannelDividerRegions(
						channelBodyTop, channelBodyHeight, displayMode,
					).map((region, index) => <StereoChannelDivider
						key={index}
						enabled={stereoDividerEnabled}
						top={region.top}
						height={region.height}
						ratio={displayChannelHeightRatio}
						label={`${copy.trackChannels}: ${track.name}`}
						onPreview={setChannelHeightRatioPreview}
						onCommit={(ratio) => run(() => (
							controller.actions.timeline.setChannelHeightRatio(track.id, ratio)
						))}
					/>)}
					<AutomaticCrossfadeOverlays overlays={crossfadeOverlays} />
					<ClipFadeOverlays rootRef={trackWindowRef} clips={projection.clips}
						selectedIds={selectedClipIdSet.size ? selectedClipIdSet : new Set([selectedClipId])}
						startFrame={projection.overscanStartFrame} endFrame={projection.overscanEndFrame}
						pixelsPerSecond={pixelsPerSecond} sampleRate={sampleRate} blocked={blocked} copy={copy}
						onTabOut={(id) => {
							const clips = clipGroups(trackWindowRef.current);
							const index = clips.findIndex(clip => clip.dataset.clipId === id);
							if (clips[index + 1]) focusFirst(clips[index + 1]);
							else onFocusTrackRuler(trackIndex);
						}}
						onChange={(id, changes) => run(() => controller.actions.clip.update(id, changes))} />
					{automationTarget && <TrackAutomationOverlay
						controller={controller}
						target={automationTarget}
						clips={trackClips}
						renderViewportStartFrame={renderViewportStartFrame}
						viewportDurationFrames={viewportDurationFrames}
						overscanStartFrame={projection.overscanStartFrame}
						overscanEndFrame={projection.overscanEndFrame}
						pixelsPerSecond={pixelsPerSecond}
						sampleRate={sampleRate}
						width={windowWidth}
						height={trackHeight}
						tempoMap={project.tempoMap}
						runtime={automationRuntime}
						clipGainToolEnabled={automationToolEnabled}
						disabled={blocked}
						copy={copy}
						run={run}
					/>}
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
							onFindPeaks={() => selectedTrackSpectralPeaks(controller, trackClips, activeSpectralSelection, sampleRate, track.spectrogram?.windowSize || 2_048)}
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
				{verticalRulerWidth > 0 && <AudioTrackRuler
					track={track}
					displayMode={displayMode}
					halfWave={halfWave}
					bodyTop={channelBodyTop}
					bodyHeight={channelBodyHeight}
					width={verticalRulerWidth}
					channelCount={rulerChannelCount}
					channelHeightRatio={displayChannelHeightRatio}
					sampleRate={sampleRate}
					spectrogramScale={spectrogramScale}
					waveformRulerFormat={waveformRulerFormat}
					waveformZoom={waveformZoom}
					disabled={blocked}
					copy={copy}
					tabIndex={tabIndexFor(3)}
					onOpenRulerFlyout={onOpenRulerFlyout}
					onWaveformZoom={onWaveformZoom}
					onFrequencyRange={(range) => run(() => controller.actions.track.update(track.id, {
						spectrogram: { ...track.spectrogram, ...range },
					}))}
					onKeyDown={(event) => {
						if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
							onOpenRulerFlyout(displayMode, event);
						} else if (event.key === 'Tab') {
							event.preventDefault();
							if (event.shiftKey) focusBeforeRuler();
							else focusAfterRuler();
						} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
							event.preventDefault();
							focusRulerVertical(event.key === 'ArrowDown' ? 'down' : 'up');
						} else if (event.key === 'Escape') {
							event.preventDefault();
							focusCurrentTrack();
						}
					}}
				/>}
				{rangeSelected && <TimeSelectionOverlay
					selection={selection}
					pixelsPerSecond={pixelsPerSecond}
				/>}
			</div>
		</div>
	);
}
