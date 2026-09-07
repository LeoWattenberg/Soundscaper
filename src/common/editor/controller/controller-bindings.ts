/* SPDX-License-Identifier: AGPL-3.0-only */

import type { createClipVideoComposition } from './clip-video-composition.ts';
import type { DocumentProject, DocumentHistory } from './document-composition-types.ts';
import type { createDocumentComposition } from './document-composition.ts';
import type { createSnapshotComposition } from './snapshot-composition.ts';
import type { createEditComposition } from './edit-composition.ts';
import type { createEffectsComposition } from './effects-composition.ts';
import type { createImportComposition } from './import-composition.ts';
import type { createMicrophoneMeterService } from './microphone-meter-service.ts';
import type { createNativeProjectComposition } from './native-project-composition.ts';
import type { createPreferencesComposition } from './preferences-composition.ts';
import type { createControllerPresentationState } from './presentation-state.ts';
import type { createProjectAdminService } from './project-admin-service.ts';
import type { createProjectBootstrapComposition } from './project-bootstrap-composition.ts';
import type { createProjectLockService } from './project-lock-service.ts';
import type { createProjectSwitchService } from './project-switch-service.ts';
import type { createRecordingComposition } from './recording-composition.ts';
import type { createSourceRuntimeComposition } from './source-runtime-composition.ts';
import type { ClipTimePitchRenderEngine } from './clip-time-pitch-service.ts';
import type { createControllerStorageCapacityService } from './storage-capacity-runtime.ts';
import type { createTrackAudioComposition } from './track-audio-composition.ts';
import type { createTransportComposition } from './transport-composition.ts';
import { deferControllerMethods, deferAsyncControllerMethods } from './deferred-controller-methods.ts';

export interface ControllerBindingServices<RenderEngine extends ClipTimePitchRenderEngine = ClipTimePitchRenderEngine> {
	readonly clips: () => ReturnType<typeof createClipVideoComposition>;
	readonly doc: () => ReturnType<typeof createDocumentComposition>;
	readonly documentChannel: () => ReturnType<typeof createSnapshotComposition>['document'];
	readonly edits: () => ReturnType<typeof createEditComposition>;
	readonly effects: () => ReturnType<typeof createEffectsComposition>;
	readonly imports: () => ReturnType<typeof createImportComposition>;
	readonly microphoneMeterService: () => ReturnType<typeof createMicrophoneMeterService>;
	readonly nativeProjectService: () => ReturnType<typeof createNativeProjectComposition>;
	readonly preferences: () => ReturnType<typeof createPreferencesComposition>;
	readonly preferencesService: () => ReturnType<typeof createPreferencesComposition>['service'];
	readonly presentationState: () => ReturnType<typeof createControllerPresentationState>;
	readonly projectAdminService: () => ReturnType<typeof createProjectAdminService>;
	readonly projectBootstrapService: () => ReturnType<typeof createProjectBootstrapComposition>;
	readonly projectLockService: () => ReturnType<typeof createProjectLockService>;
	readonly projectSwitchService: () => ReturnType<typeof createProjectSwitchService<DocumentProject, DocumentHistory, unknown, unknown>>;
	readonly recording: () => ReturnType<typeof createRecordingComposition>;
	readonly sources: () => ReturnType<typeof createSourceRuntimeComposition<RenderEngine>>;
	readonly storageCapacityService: () => ReturnType<typeof createControllerStorageCapacityService>;
	readonly telemetryChannel: () => ReturnType<typeof createSnapshotComposition>['telemetry'];
	readonly tracks: () => ReturnType<typeof createTrackAudioComposition>;
	readonly viewStateService: () => ReturnType<typeof createTransportComposition>['view'];
}

/** Resolve each service at invocation; construction never reads an uninitialized owner. */
export function createControllerBindings<RenderEngine extends ClipTimePitchRenderEngine>(services: ControllerBindingServices<RenderEngine>) {
	const { load: loadPreferences } = deferControllerMethods(() => services.preferences(), ['load']);
	const { switchProject } = deferControllerMethods(() => services.projectSwitchService(), ['switchProject']);
	const { moveClipsToProjectBin, placeProjectBinClip, applyProjectBinReplacement } = deferControllerMethods(() => services.imports().projectBin, ['moveClipsToProjectBin', 'placeProjectBinClip', 'applyProjectBinReplacement']);
	const { addLabel } = deferControllerMethods(() => services.tracks().track, ['addLabel']);
	const { selectClip, setSelection, selectLeftOfPlaybackPosition, selectRightOfPlaybackPosition, setSnapSettings, snapTimelineFrame } = deferControllerMethods(() => services.tracks().selectionView, ['selectClip', 'setSelection', 'selectLeftOfPlaybackPosition', 'selectRightOfPlaybackPosition', 'setSnapSettings', 'snapTimelineFrame']);
	const { sampleEditingAvailable, setSampleEditMode } = deferControllerMethods(() => services.clips().sampleEdit, ['sampleEditingAvailable', 'setSampleEditMode']);
	const { applySamplePencil, smoothSelectedSamples } = deferControllerMethods(() => services.clips(), ['applySamplePencil', 'smoothSelectedSamples']);
	const { updateRecordingDeviceRows } = deferControllerMethods(() => services.recording().routing, ['updateRecordingDeviceRows']);
	const { addVideoClipEffect, updateVideoClipEffect, toggleVideoClipEffect, bypassVideoClipEffect, previewVideoEffectGesture, commitVideoEffectGesture } = deferControllerMethods(() => services.clips().videoEffect, ['addVideoClipEffect', 'updateVideoClipEffect', 'toggleVideoClipEffect', 'bypassVideoClipEffect', 'previewVideoEffectGesture', 'commitVideoEffectGesture']);
	const { cancelTimedRecording } = deferControllerMethods(() => services.recording().timed, ['cancelTimedRecording']);
	const { startRecording } = deferControllerMethods(() => services.recording().session, ['startRecording']);
	const { setVisibleTrackHeights, resizeTrackHeight } = deferControllerMethods(() => services.viewStateService(), ['setVisibleTrackHeights', 'resizeTrackHeight']);
	const { newProject } = deferAsyncControllerMethods(() => services.projectSwitchService(), ['newProject']);
	const { releaseProjectLock } = deferAsyncControllerMethods(() => services.projectLockService(), ['releaseProjectLock']);
	const { requestWaveformPcmWindow, activateStoredSource } = deferAsyncControllerMethods(() => services.sources().sourceLifecycle, ['requestWaveformPcmWindow', 'activateStoredSource']);
	const { loadRecordingRouting, refreshRecordingInputs, refreshAudioDevices } = deferAsyncControllerMethods(() => services.recording().routing, ['loadRecordingRouting', 'refreshRecordingInputs', 'refreshAudioDevices']);
	const { startRecordingOnNewTrack } = deferAsyncControllerMethods(() => services.recording().session, ['startRecordingOnNewTrack']);
	const { scheduleTimedRecording } = deferAsyncControllerMethods(() => services.recording().timed, ['scheduleTimedRecording']);
	const { stopProjectBinPreview } = deferAsyncControllerMethods(() => services.imports().projectBin, ['stopProjectBinPreview']);
	const { bootstrap } = deferAsyncControllerMethods(() => services.projectBootstrapService(), ['bootstrap']);
	const { openProject } = deferAsyncControllerMethods(() => services.projectSwitchService(), ['openProject']);
	const { claimProjectLock } = deferAsyncControllerMethods(() => services.projectLockService(), ['claimProjectLock']);
	const { loadProjectSources } = deferAsyncControllerMethods(() => services.sources().sourceLifecycle, ['loadProjectSources']);
	const { listProjects, clearRecentProjects, renameProject, duplicateProject, garbageCollectSources } = deferAsyncControllerMethods(() => services.projectAdminService(), ['listProjects', 'clearRecentProjects', 'renameProject', 'duplicateProject', 'garbageCollectSources']);
	const { prepareProjectBinReplacement, cancelProjectBinReplacement, playPauseProjectBinClip } = deferAsyncControllerMethods(() => services.imports().projectBin, ['prepareProjectBinReplacement', 'cancelProjectBinReplacement', 'playPauseProjectBinClip']);
	const { importLabelFile, exportLabels } = deferAsyncControllerMethods(() => services.edits().labels, ['importLabelFile', 'exportLabels']);
	const { disjoinSelectedClip } = deferAsyncControllerMethods(() => services.edits().clipboard, ['disjoinSelectedClip']);
	const { generateSelectionSilence, generateSignal, repeatLastGenerator } = deferAsyncControllerMethods(() => services.edits(), ['generateSelectionSilence', 'generateSignal', 'repeatLastGenerator']);
	const { requestInputAccess, setPreferredInputDevice, configureDisplayInput, setPreferredInputChannelCount, setAudioOutputDevice, setRecordingSourceLatency, setRetainInputs } = deferAsyncControllerMethods(() => services.recording().routing, ['requestInputAccess', 'setPreferredInputDevice', 'configureDisplayInput', 'setPreferredInputChannelCount', 'setAudioOutputDevice', 'setRecordingSourceLatency', 'setRetainInputs']);
	const { setRecordingTrackInput } = deferAsyncControllerMethods(() => services.recording().inputs, ['setRecordingTrackInput']);
	const { setMicrophoneMetering } = deferAsyncControllerMethods(() => services.microphoneMeterService(), ['setMicrophoneMetering']);
	const { apply: applyProjectToPlaybackEngine } = deferAsyncControllerMethods(() => services.sources().playbackApply, ['apply']);
	const { stopRecording } = deferAsyncControllerMethods(() => services.recording().session, ['stopRecording']);
	const { get: getSnapshot } = deferControllerMethods(() => services.documentChannel(), ['get']);
	const { get: getTelemetrySnapshot } = deferControllerMethods(() => services.telemetryChannel(), ['get']);
	const { getClipVisualData, getProjectBinClipVisualData, revokeVideoVisuals, revokeVideoVisual, activateVideoSource, hasMissingTimelineSources, getVisibleClips } = deferControllerMethods(() => services.sources().projectVisual, ['getClipVisualData', 'getProjectBinClipVisualData', 'revokeVideoVisuals', 'revokeVideoVisual', 'activateVideoSource', 'hasMissingTimelineSources', 'getVisibleClips']);
	const { update: updatePreferences, revertFactorySettings } = deferControllerMethods(() => services.preferencesService(), ['update', 'revertFactorySettings']);
	const { sessionTab, persistActiveSessionUiState } = deferControllerMethods(() => services.doc().session, ['sessionTab', 'persistActiveSessionUiState']);
	const { dismissAup4CompatibilitySummary } = deferControllerMethods(() => services.nativeProjectService(), ['dismissAup4CompatibilitySummary']);
	const { cacheSourceBuffer, clearWaveformPcmWindows } = deferControllerMethods(() => services.sources().sourceLifecycle, ['cacheSourceBuffer', 'clearWaveformPcmWindows']);
	const { renameProjectBinClip, removeProjectBinClip, setProjectBinClipColor, projectBinInstanceCount, selectProjectBinInstances, removeProjectBinSource } = deferControllerMethods(() => services.imports().projectBin, ['renameProjectBinClip', 'removeProjectBinClip', 'setProjectBinClipColor', 'projectBinInstanceCount', 'selectProjectBinInstances', 'removeProjectBinSource']);
	const { mixAndRenderTracks, resampleTrack, resampleClip, swapTrackChannels, splitStereoTrack, makeStereoTrack } = deferControllerMethods(() => services.tracks(), ['mixAndRenderTracks', 'resampleTrack', 'resampleClip', 'swapTrackChannels', 'splitStereoTrack', 'makeStereoTrack']);
	const { splitAtFrame } = deferControllerMethods(() => services.edits().clipboard, ['splitAtFrame']);
	const { selectTrack, selectAllTracks, selectTrackStartToCursor, selectCursorToTrackEnd, selectTrackStartToEnd, selectedTracksTimeRange, toggleRmsWaveform, toggleVerticalRulers, toggleUpdateWhilePlaying, togglePinnedPlayhead, toggleRulerPlayback, selectAtZeroCrossings, setZoom } = deferControllerMethods(() => services.tracks().selectionView, ['selectTrack', 'selectAllTracks', 'selectTrackStartToCursor', 'selectCursorToTrackEnd', 'selectTrackStartToEnd', 'selectedTracksTimeRange', 'toggleRmsWaveform', 'toggleVerticalRulers', 'toggleUpdateWhilePlaying', 'togglePinnedPlayhead', 'toggleRulerPlayback', 'selectAtZeroCrossings', 'setZoom']);
	const { synchronizeAutomaticSampleEditMode, cancelSampleEdit } = deferControllerMethods(() => services.clips().sampleEdit, ['synchronizeAutomaticSampleEditMode', 'cancelSampleEdit']);
	const { persistRecordingRouting, releaseInputs } = deferControllerMethods(() => services.recording().routing, ['persistRecordingRouting', 'releaseInputs']);
	const { syncRecordingPoolSnapshot, setMonitoring, setRecordingInputGain, setLatencyOffset, invalidateTakeCycleRecording } = deferControllerMethods(() => services.recording(), ['syncRecordingPoolSnapshot', 'setMonitoring', 'setRecordingInputGain', 'setLatencyOffset', 'invalidateTakeCycleRecording']);
	const { handleRecordingPoolChange } = deferControllerMethods(() => services.recording().inputs, ['handleRecordingPoolChange']);
	const { synchronizeTarget: synchronizeMicrophoneMeterTarget } = deferControllerMethods(() => services.microphoneMeterService(), ['synchronizeTarget']);
	const { commit, updateSelection, projectChanged, saveNow, flushProject } = deferControllerMethods(() => services.doc().mutation, ['commit', 'updateSelection', 'projectChanged', 'saveNow', 'flushProject']);
	const { compactLiveSourceState, liveSessionSourceIds, liveSessionClipIds } = deferControllerMethods(() => services.doc().retention, ['compactLiveSourceState', 'liveSessionSourceIds', 'liveSessionClipIds']);
	const { publishProjectState, setTimelineView, setAllTracksView } = deferControllerMethods(() => services.doc().view, ['publishProjectState', 'setTimelineView', 'setAllTracksView']);
	const { duplicateTrack } = deferControllerMethods(() => services.doc().trackDuplication, ['duplicateTrack']);
	const { handleClipAction, setClipTimePitch, stretchClip, resetClipPitchSpeed } = deferControllerMethods(() => services.clips().clipProperty, ['handleClipAction', 'setClipTimePitch', 'stretchClip', 'resetClipPitchSpeed']);
	const { moveClips, moveClipsToNewTrack, trimClips, overwriteClips } = deferControllerMethods(() => services.clips().clipTransform, ['moveClips', 'moveClipsToNewTrack', 'trimClips', 'overwriteClips']);
	const { renderClipPitchSpeed } = deferControllerMethods(() => services.clips(), ['renderClipPitchSpeed']);
	const { createCacheAwareRenderEngine, prepareCommittedTimePitchCaches, beginPlaybackCachePreparation, cancelPlaybackCachePreparation } = deferControllerMethods(() => services.sources().timePitchCaches, ['createCacheAwareRenderEngine', 'prepareCommittedTimePitchCaches', 'beginPlaybackCachePreparation', 'cancelPlaybackCachePreparation']);
	const { videoEffectGestureKey, reorderVideoClipEffect, removeVideoClipEffect, beginVideoEffectGesture, cancelVideoEffectGesture } = deferControllerMethods(() => services.clips().videoEffect, ['videoEffectGestureKey', 'reorderVideoClipEffect', 'removeVideoClipEffect', 'beginVideoEffectGesture', 'cancelVideoEffectGesture']);
	const { addEffect, updateRackEffect, beginRackEffectGesture, previewRackEffect, commitRackEffectGesture, cancelRackEffectGesture, beginParametricEqGesture, previewParametricEq, commitParametricEqGesture, cancelParametricEqGesture, copyEffectStack, pasteEffectStack } = deferControllerMethods(() => services.effects().rack, ['addEffect', 'updateRackEffect', 'beginRackEffectGesture', 'previewRackEffect', 'commitRackEffectGesture', 'cancelRackEffectGesture', 'beginParametricEqGesture', 'previewParametricEq', 'commitParametricEqGesture', 'cancelParametricEqGesture', 'copyEffectStack', 'pasteEffectStack']);
	const { runEffectMacro, applyAudacityEffectFromController, repeatLastAudacityEffect, applySpectralSelection, captureSelectedNoiseProfile, runNyquistEvaluation } = deferControllerMethods(() => services.effects(), ['runEffectMacro', 'applyAudacityEffectFromController', 'repeatLastAudacityEffect', 'applySpectralSelection', 'captureSelectedNoiseProfile', 'runNyquistEvaluation']);
	const { currentAudacityEffectParams, setAudacityEffectType, setAudacityEffectParamsFromController, setAudacityControlTrack, applyEffectPreset, saveEffectPreset, deleteEffectPreset, importEffectPresets, exportEffectPreset, cancelAudacityEffectPreview, captureRackNoiseProfileFromController } = deferControllerMethods(() => services.effects().controls, ['currentAudacityEffectParams', 'setAudacityEffectType', 'setAudacityEffectParamsFromController', 'setAudacityControlTrack', 'applyEffectPreset', 'saveEffectPreset', 'deleteEffectPreset', 'importEffectPresets', 'exportEffectPreset', 'cancelAudacityEffectPreview', 'captureRackNoiseProfileFromController']);
	const { renderDryTrackRange } = deferControllerMethods(() => services.effects().audio, ['renderDryTrackRange']);
	const { cancelNyquistEvaluation } = deferControllerMethods(() => services.effects().nyquistHost, ['cancelNyquistEvaluation']);
	const { toggleRecordingPause, toggleLeadInRecording, cancelRecordingStart } = deferControllerMethods(() => services.recording().session, ['toggleRecordingPause', 'toggleLeadInRecording', 'cancelRecordingStart']);
	const { updateTransportState, updateMeters, updateZoom, setTimelineViewportWidth, setAutoFitTrackHeight, adjustTrackHeight } = deferControllerMethods(() => services.viewStateService(), ['updateTransportState', 'updateMeters', 'updateZoom', 'setTimelineViewportWidth', 'setAutoFitTrackHeight', 'adjustTrackHeight']);
	const { toggleExport, updateExportProgress, showAnalysis, setStatus, handleError } = deferControllerMethods(() => services.presentationState(), ['toggleExport', 'updateExportProgress', 'showAnalysis', 'setStatus', 'handleError']);
	const { refreshStorageUsage, estimateStorageForPreflight, preflightStorage } = deferControllerMethods(() => services.storageCapacityService(), ['refreshStorageUsage', 'estimateStorageForPreflight', 'preflightStorage']);
	const { openScape, saveScape, openAup4, openAudacityProject, saveAup4 } = deferAsyncControllerMethods(() => services.nativeProjectService(), ['openScape', 'saveScape', 'openAup4', 'openAudacityProject', 'saveAup4']);
	return Object.freeze({
		openScape, saveScape, openAup4, openAudacityProject, saveAup4,
		loadPreferences, switchProject, moveClipsToProjectBin, placeProjectBinClip,
		applyProjectBinReplacement, addLabel, selectClip, setSelection,
		selectLeftOfPlaybackPosition, selectRightOfPlaybackPosition, setSnapSettings, snapTimelineFrame,
		sampleEditingAvailable, setSampleEditMode, applySamplePencil, smoothSelectedSamples,
		updateRecordingDeviceRows, addVideoClipEffect, updateVideoClipEffect, toggleVideoClipEffect,
		bypassVideoClipEffect, previewVideoEffectGesture, commitVideoEffectGesture, cancelTimedRecording,
		startRecording, setVisibleTrackHeights, resizeTrackHeight, newProject,
		releaseProjectLock, requestWaveformPcmWindow, activateStoredSource, loadRecordingRouting,
		refreshRecordingInputs, refreshAudioDevices, startRecordingOnNewTrack, scheduleTimedRecording,
		stopProjectBinPreview, bootstrap, openProject, claimProjectLock,
		loadProjectSources, listProjects, clearRecentProjects, renameProject,
		duplicateProject, garbageCollectSources, prepareProjectBinReplacement, cancelProjectBinReplacement,
		playPauseProjectBinClip, importLabelFile, exportLabels, disjoinSelectedClip,
		generateSelectionSilence, generateSignal, repeatLastGenerator, requestInputAccess,
		setPreferredInputDevice, configureDisplayInput, setPreferredInputChannelCount, setAudioOutputDevice,
		setRecordingSourceLatency, setRetainInputs, setRecordingTrackInput, setMicrophoneMetering,
		applyProjectToPlaybackEngine, stopRecording, getSnapshot, getTelemetrySnapshot,
		getClipVisualData, getProjectBinClipVisualData, revokeVideoVisuals, revokeVideoVisual,
		activateVideoSource, hasMissingTimelineSources, getVisibleClips, updatePreferences,
		revertFactorySettings, sessionTab, persistActiveSessionUiState, dismissAup4CompatibilitySummary,
		cacheSourceBuffer, clearWaveformPcmWindows, renameProjectBinClip, removeProjectBinClip,
		setProjectBinClipColor, projectBinInstanceCount, selectProjectBinInstances, removeProjectBinSource,
		mixAndRenderTracks, resampleTrack, resampleClip, swapTrackChannels,
		splitStereoTrack, makeStereoTrack, splitAtFrame, selectTrack,
		selectAllTracks, selectTrackStartToCursor, selectCursorToTrackEnd, selectTrackStartToEnd,
		selectedTracksTimeRange, toggleRmsWaveform, toggleVerticalRulers, toggleUpdateWhilePlaying,
		togglePinnedPlayhead, toggleRulerPlayback, selectAtZeroCrossings, setZoom,
		synchronizeAutomaticSampleEditMode, cancelSampleEdit, persistRecordingRouting, releaseInputs,
		syncRecordingPoolSnapshot, setMonitoring, setRecordingInputGain, setLatencyOffset,
		invalidateTakeCycleRecording, handleRecordingPoolChange, synchronizeMicrophoneMeterTarget, commit,
		updateSelection, projectChanged, saveNow, flushProject,
		compactLiveSourceState, liveSessionSourceIds, liveSessionClipIds, publishProjectState,
		setTimelineView, setAllTracksView, duplicateTrack, handleClipAction,
		setClipTimePitch, stretchClip, resetClipPitchSpeed, moveClips,
		moveClipsToNewTrack, trimClips, overwriteClips, renderClipPitchSpeed,
		createCacheAwareRenderEngine, prepareCommittedTimePitchCaches, beginPlaybackCachePreparation, cancelPlaybackCachePreparation,
		videoEffectGestureKey, reorderVideoClipEffect, removeVideoClipEffect, beginVideoEffectGesture,
		cancelVideoEffectGesture, addEffect, updateRackEffect, beginRackEffectGesture,
		previewRackEffect, commitRackEffectGesture, cancelRackEffectGesture, beginParametricEqGesture,
		previewParametricEq, commitParametricEqGesture, cancelParametricEqGesture, copyEffectStack,
		pasteEffectStack, runEffectMacro, applyAudacityEffectFromController, repeatLastAudacityEffect,
		applySpectralSelection, captureSelectedNoiseProfile, runNyquistEvaluation, currentAudacityEffectParams,
		setAudacityEffectType, setAudacityEffectParamsFromController, setAudacityControlTrack, applyEffectPreset,
		saveEffectPreset, deleteEffectPreset, importEffectPresets, exportEffectPreset,
		cancelAudacityEffectPreview, captureRackNoiseProfileFromController, renderDryTrackRange, cancelNyquistEvaluation,
		toggleRecordingPause, toggleLeadInRecording, cancelRecordingStart, updateTransportState,
		updateMeters, updateZoom, setTimelineViewportWidth, setAutoFitTrackHeight,
		adjustTrackHeight, toggleExport, updateExportProgress, showAnalysis,
		setStatus, handleError, refreshStorageUsage, estimateStorageForPreflight,
		preflightStorage,
	});
}
