import { useMemo, useState } from 'react';

import { AudioTrackRow } from './AudioTrackRow.jsx';
import { EMPTY_TIMELINE_CLIPS } from './constants.ts';
import { normalizeWaveformRulerState } from './geometry.ts';
import { LabelTrackRow } from './LabelTrackRow.jsx';
import { TrackFolderRow } from './TrackFolderRow.jsx';
import {
	planTrackListRows,
	resolveTrackFolderMoveKey,
	resolveTrackFolderTreeKey,
	trackFolderRowDomId,
} from './track-folder-ui-model.ts';
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
	const [activeFolderId, setActiveFolderId] = useState(null);
	const [editingFolderId, setEditingFolderId] = useState(null);
	const plan = useMemo(
		() => planTrackListRows(snapshot.trackFolders, project.tracks, project.trackFolders || []),
		[snapshot.trackFolders, project.tracks, project.trackFolders],
	);
	const trackIndexById = useMemo(
		() => new Map(project.tracks.map((track, index) => [track.id, index])),
		[project.tracks],
	);
	const trackFolderActions = controller.actions.trackFolders;
	const selectFolder = (folderId) => {
		setActiveFolderId(folderId);
		run(() => trackFolderActions.select(folderId));
	};
	const toggleFolderCollapsed = (folderId) => !mutationsBlocked
		&& run(() => trackFolderActions.toggleCollapsed(folderId));
	const setFolderFlag = (folderId, flag, value) => !mutationsBlocked
		&& run(() => trackFolderActions.update(folderId, { [flag]: value }));
	const focusFolderRow = (folderId) => {
		setActiveFolderId(folderId);
		const row = document.getElementById(trackFolderRowDomId(folderId));
		if (row) row.focus();
	};
	const moveNode = (sequenceId, nodeId, parentFolderId, index) => !mutationsBlocked
		&& run(() => trackFolderActions.moveNode(sequenceId, nodeId, parentFolderId, index));
	const renameFolder = (folderId, name) => {
		setEditingFolderId(null);
		const trimmed = typeof name === 'string' ? name.trim() : '';
		const current = plan.folderRows.find((candidate) => candidate.id === folderId);
		if (!trimmed || trimmed === current?.name || mutationsBlocked) return;
		run(() => trackFolderActions.rename(folderId, trimmed));
	};
	const onFolderKeyDown = (event, folderId) => {
		if (editingFolderId !== null) return;
		if (event.altKey) {
			const move = resolveTrackFolderMoveKey(event.key, folderId, plan);
			if (move === null) return;
			event.preventDefault();
			event.stopPropagation();
			moveNode(move.sequenceId, move.nodeId, move.parentFolderId, move.index);
			return;
		}
		const intent = resolveTrackFolderTreeKey(event.key, folderId, plan);
		if (intent === null) return;
		event.preventDefault();
		event.stopPropagation();
		if (intent.kind === 'focus') focusFolderRow(intent.folderId);
		else if (intent.kind === 'expand' || intent.kind === 'collapse') toggleFolderCollapsed(intent.folderId);
		else if (intent.kind === 'activate') {
			selectFolder(intent.folderId);
			if (!mutationsBlocked) setEditingFolderId(intent.folderId);
		}
	};
	const renderTrack = (track, trackIndex) => track.type === 'label' ? (
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
					canonicalVideoTrim={snapshot.capabilities?.videoCompositing === true}
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
			);
	return (
		<div className="audio-editor-track-list" data-track-list>
			{plan.hasFolders && (
				<div
					className="audio-editor-track-folder-tree-anchor"
					role="tree"
					aria-label={copy.trackFolderTree}
					aria-owns={plan.treeOwnedIds}
				/>
			)}
			{plan.entries.map((entry) => {
				if (entry.kind === 'folder') {
					return entry.row.rowHidden ? null : (
						<TrackFolderRow
							key={`folder:${entry.row.id}`}
							row={entry.row}
							plan={plan}
							copy={copy}
							blocked={mutationsBlocked}
							selected={activeFolderId === entry.row.id}
							activeFolderId={activeFolderId}
							panelWidth={panelWidth}
							editing={editingFolderId === entry.row.id}
							onSelect={selectFolder}
							onKeyDown={onFolderKeyDown}
							onToggleCollapsed={toggleFolderCollapsed}
							onSetFlag={setFolderFlag}
							onMenu={(folderId, anchor) => setTrackMenu({ folderId, anchor })}
							onRename={renameFolder}
							onDropNode={(nodeId, target) => moveNode(
								target.sequenceId,
								nodeId,
								target.id,
								Number.MAX_SAFE_INTEGER,
							)}
						/>
					);
				}
				if (entry.rowHidden) return null;
				const trackIndex = trackIndexById.get(entry.trackId);
				const track = trackIndex === undefined ? undefined : project.tracks[trackIndex];
				return track === undefined ? null : renderTrack(track, trackIndex);
			})}
			{(clipDragPreview?.createTrack || projectBinDragPreview?.createTrack) && (
				<div className="audio-editor-new-track-drop-preview" aria-live="polite">
					<span>{projectBinDragPreview?.clip?.title || copy.audioTrack}</span>
				</div>
			)}
		</div>
	);
}
