import { AudioTrackRow } from './AudioTrackRow.jsx';
import { EMPTY_TIMELINE_CLIPS } from './constants.ts';
import { normalizeWaveformRulerState } from './geometry.ts';
import { LabelTrackRow } from './LabelTrackRow.jsx';
import { VideoTrackRow } from './VideoTrackRow.jsx';

/**
 * The timeline's track rows, extracted verbatim from the workspace view so the
 * folder tree has a home with headroom. Rendering, DOM attributes, and row
 * ordering are unchanged: rows follow `project.tracks`, which is the hierarchy
 * preorder on foldered documents.
 */
export function TrackListView({
	project,
	controller,
	projectIndex,
	visualTrackHeight,
	documentSelection,
	timeSelection,
	snapshot,
	selectedClipIdSet,
	draggingClipIds,
	clipDragPreview,
	projectBinDragPreview,
	mutationsBlocked,
	copy,
	run,
	setTrackMenu,
	openClipMenu,
	openTrackRulerFlyout,
	onOpenEffects,
	focusTimelineRuler,
	focusTrackContainer,
	focusTrackPanelControl,
	focusTrackClip,
	focusTrackRuler,
	focusSelectionToolbar,
	isFlatNavigation,
	trackBaseTabIndex,
	panelWidth,
	timelineWidth,
	verticalRulerWidth,
	pixelsPerSecond,
	sampleRate,
	viewportStartFrame,
	viewportDurationFrames,
	waveformRulerState,
	recordingPreviews,
	waveformCache,
	automationToolEnabled,
	showArmControls,
	displayAudioSupported,
}) {
	return (
		<div className="audio-editor-track-list" data-track-list>
			{project.tracks.map((track, trackIndex) => track.type === 'label' ? (
				<LabelTrackRow
					key={track.id}
					controller={controller}
					track={track}
					visualHeight={visualTrackHeight(track)}
					trackIndex={trackIndex}
					panelWidth={panelWidth}
					timelineWidth={timelineWidth}
					verticalRulerWidth={verticalRulerWidth}
					pixelsPerSecond={pixelsPerSecond}
					sampleRate={sampleRate}
					selection={documentSelection}
					selected={snapshot.selectedTrackId === track.id}
					blocked={mutationsBlocked}
					copy={copy}
					run={run}
					onMenu={(anchor) => setTrackMenu({ trackId: track.id, anchor })}
				/>
			) : track.type === 'video' ? (
				<VideoTrackRow
					key={track.id}
					controller={controller}
					track={track}
					visualHeight={visualTrackHeight(track)}
					trackClips={projectIndex.clipsByTrackId.get(track.id) || EMPTY_TIMELINE_CLIPS}
					clipLookup={projectIndex.clipById}
					sourceLookup={projectIndex.sourceById}
					trackIndex={trackIndex}
					trackCount={project.tracks.length}
					isFlatNavigation={isFlatNavigation}
					trackBaseTabIndex={trackBaseTabIndex}
					panelWidth={panelWidth}
					viewportStartFrame={viewportStartFrame}
					viewportDurationFrames={viewportDurationFrames}
					pixelsPerSecond={pixelsPerSecond}
					sampleRate={sampleRate}
					timelineWidth={timelineWidth}
					verticalRulerWidth={verticalRulerWidth}
					selectedTrackId={snapshot.selectedTrackId}
					selectedClipId={snapshot.selectedClipId}
					selectedClipIdSet={selectedClipIdSet}
					draggingClipIds={draggingClipIds}
					clipDragPreview={clipDragPreview}
					projectBinDragPreview={projectBinDragPreview}
					blocked={mutationsBlocked}
					copy={copy}
					run={run}
					onMenu={(anchor) => setTrackMenu({ trackId: track.id, anchor })}
					onOpenClipMenu={openClipMenu}
					onFocusTimelineRuler={focusTimelineRuler}
					onFocusTrackContainer={focusTrackContainer}
					onFocusTrackPanelControl={focusTrackPanelControl}
					onFocusTrackClip={focusTrackClip}
					onFocusSelectionToolbar={focusSelectionToolbar}
				/>
			) : (
				<AudioTrackRow
					key={track.id}
					controller={controller}
					project={project}
					track={track}
					visualHeight={visualTrackHeight(track)}
					trackClips={projectIndex.clipsByTrackId.get(track.id) || EMPTY_TIMELINE_CLIPS}
					clipLookup={projectIndex.clipById}
					sourceLookup={projectIndex.sourceById}
					trackIndex={trackIndex}
					trackCount={project.tracks.length}
					isFlatNavigation={isFlatNavigation}
					trackBaseTabIndex={trackBaseTabIndex}
					panelWidth={panelWidth}
					viewportStartFrame={viewportStartFrame}
					viewportDurationFrames={viewportDurationFrames}
					pixelsPerSecond={pixelsPerSecond}
					sampleRate={sampleRate}
					timelineWidth={timelineWidth}
					verticalRulerWidth={verticalRulerWidth}
					selection={timeSelection}
					spectralSelection={documentSelection?.frequencyRange ? documentSelection : null}
					selectedTrackId={snapshot.selectedTrackId}
					selectedClipId={snapshot.selectedClipId}
					selectedClipIdSet={selectedClipIdSet}
					timelineView={snapshot.timeline?.view}
					showRms={Boolean(snapshot.timeline?.showRms)}
					waveformRulerFormat={normalizeWaveformRulerState(waveformRulerState[track.id]).format}
					waveformZoom={normalizeWaveformRulerState(waveformRulerState[track.id]).zoom}
					clipStyle={snapshot.preferences?.appearance?.clipStyle}
					recordingPreview={recordingPreviews.find((preview) => preview.trackId === track.id) || null}
					draggingClipIds={draggingClipIds}
					clipDragPreview={clipDragPreview}
					projectBinDragPreview={projectBinDragPreview}
					waveformCache={waveformCache}
					automationToolEnabled={automationToolEnabled}
					blocked={mutationsBlocked}
					showArmControls={showArmControls}
					displayAudioSupported={displayAudioSupported}
					recordingInputs={snapshot.recordingInputs}
					copy={copy}
					run={run}
					onMenu={(anchor) => setTrackMenu({ trackId: track.id, anchor })}
					onOpenEffects={onOpenEffects}
					onOpenClipMenu={openClipMenu}
					onOpenRulerFlyout={(displayMode, event) => openTrackRulerFlyout(track, displayMode, event)}
					onFocusTimelineRuler={focusTimelineRuler}
					onFocusTrackContainer={focusTrackContainer}
					onFocusTrackPanelControl={focusTrackPanelControl}
					onFocusTrackClip={focusTrackClip}
					onFocusTrackRuler={focusTrackRuler}
					onFocusSelectionToolbar={focusSelectionToolbar}
				/>
			))}
			{(clipDragPreview?.createTrack || projectBinDragPreview?.createTrack) && (
				<div className="audio-editor-new-track-drop-preview" aria-live="polite">
					<span>{projectBinDragPreview?.clip?.title || copy.audioTrack}</span>
				</div>
			)}
		</div>
	);
}
