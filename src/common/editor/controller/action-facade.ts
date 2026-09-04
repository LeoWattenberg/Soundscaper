/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorActions } from '../types.ts';
import type { EditorActionRuntime, RuntimeValue } from './action-facade-runtime.ts';
import {
	createRecordingActionFacade,
	createRecordingPreferenceActionFacade,
	type RecordingActionScope,
} from './recording-action-facade.ts';
import { createProjectOwnedFeatureActionFacades } from './project-owned-feature-action-facades.ts';
import { createTimelineAnnotationActionFacade } from './timeline-annotation-action-facade.ts';
import { createVideoActionGroup } from './video-action-group.ts';
import { snapshotProductActionExtensions } from './product-action-extensions.ts';
import { createExportActionGroup } from './export-action-group.ts';
import { createProjectMediaActionGroup } from './project-media-action-group.ts';
import {
	createPreferenceActionGroup,
	type PreferenceActionScope,
} from './preference-action-group.ts';
import { createStoredProjectOpenActions } from './stored-project-open-actions.ts';
import { createCrossProductHandoffActionFacade } from './cross-product-handoff-action-facade.ts';
import {
	createEffectMacroActions,
	createEffectPresetActions,
	type EffectLibraryActionScope,
} from './effect-library-action-groups.ts';

export type { EditorActionRuntime } from './action-facade-runtime.ts';

export function createGroupedEditorActions(scope: EditorActionRuntime): EditorActions;
export function createGroupedEditorActions(scope: EditorActionRuntime): RuntimeValue {
	const {
	addEffect, addLabel, addLabelTrack, addTrack, addVideoTrackPair, adjustAllTrackHeights, adjustTrackHeight,
	analysisService, applyAudacityEffectFromController, applyProjectBinReplacement, applySamplePencil,
	applySpectralSelection, beginParametricEqGesture, beginRackEffectGesture, cancelAudacityEffectPreview,
	cancelNyquistEvaluation, cancelParametricEqGesture, cancelPlaybackCachePreparation,
	cancelProjectBinReplacement, cancelRackEffectGesture, cancelSampleEdit, capabilities,
	captureRackNoiseProfileFromController, captureSelectedNoiseProfile, claimProjectLock, clearLocalData,
	clearLoopRegion, clearRecentProjects, closeProjectTab, commit, commitParametricEqGesture,
	commitRackEffectGesture, configureDisplayInput, continueLoudnessMeasurement, copy, copyEffectStack,
	createStableId, deleteProject, disjoinSelectedClip, dismissAup4CompatibilitySummary, duplicateProject,
	duplicateTrack, engine, framescaperCaptureActions, framescaperWebVcrActions, exportLabels, ffmpeg,
	fileService, findTrack, persistSetting, publishDocumentSnapshot, flushProject, generateSelectionSilence,
	generateSignal, repeatLastGenerator, getClipVisualData, getProjectBinClipVisualData, getVisibleClips,
	handleClipAction, handleEdit, handleExportAction, handlePlayAtSpeed, handleTransport,
	hasMissingTimelineSources, importFiles, importLabelFile, inspectScape, listProjects, makeStereoTrack,
	mixAndRenderTracks, moveClips, moveClipsToNewTrack, moveClipsToProjectBin, moveTrack, newProject,
	normalizePlaybackFrame, openAudacityProject, openAup4, openProject, openScape, openScapeFile, overwriteClips,
	openDawproject, saveDawproject, pasteEffectStack, pauseLoudnessMeasurement, placeProjectBinClip,
	playPauseProjectBinClip, prepareProjectBinReplacement, prepareProjectHandoff,
	previewAudacityEffectFromController, previewParametricEq, previewRackEffect, product, getProject,
	projectBinInstanceCount, refreshAudioDevices, refreshStorageUsage, canRelinkLinkedAudio,
	classifyLinkedAudioRelink, relinkLinkedAudio, canRelinkLinkedVideo, classifyLinkedVideoRelink,
	relinkLinkedVideo, removeProjectBinClip, removeProjectBinSource, renameProject, renameProjectBinClip,
	renderClipPitchSpeed, reorderTrack, repeatLastAudacityEffect, requestInputAccess, requestStoragePersistence,
	requestWaveformPcmWindow, resampleClip, resampleTrack, resetClipPitchSpeed, resetLoudnessMeasurement,
	resizeTrackHeight, runNyquistEvaluation, saveAup4, saveNow, saveScape, selectAllTracks, selectAtZeroCrossings,
	selectClip, selectCursorToTrackEnd, selectLeftOfPlaybackPosition, selectProjectBinInstances,
	selectRightOfPlaybackPosition, selectTrack, selectTrackStartToCursor, selectTrackStartToEnd, sessionTab,
	setAllTracksView, setAudacityControlTrack, setAudacityEffectParamsFromController, setAudacityEffectType,
	setAudioOutputDevice, setAutoFitTrackHeight, setClipTimePitch, setLoopRegion, setLoopRegionInOut, setStatus,
	setLoopRegionToSelection, setPlayAtSpeedRate, setExactSelection, setPreferredInputChannelCount,
	setPreferredInputDevice, setProjectBinClipColor, setSampleEditMode, setSelection, setSelectionToLoopRegion,
	setSnapSettings, effectSelectionService, setTimelineView, setTimelineViewportWidth, setTrackDisplayMode,
	setTrackRate, setVisibleTrackHeights, setZoom, smoothSelectedSamples, snapTimelineFrame, splitAtFrame,
	splitStereoTrack, state, stopProjectBinPreview, cleanupDisposableStorage, cleanupDerivativeCache, store,
	stretchClip, swapTrackChannels, switchProject, toggleMetronome, togglePinnedPlayhead, toggleRmsWaveform,
	toggleRulerPlayback, toggleSelectionFollowsLoop, toggleStretchToTempo, toggleUpdateWhilePlaying,
	toggleVerticalRulers, trimClips, updateRackEffect, updateZoom, selectionViewService, sequenceTimingService,
	timelineAnnotationService, regularIntervalAnnotationController, trackFolderService, trackStructuralOperations,
	audioWarpService, takeCompService, videoNavigationService,
	} = scope;
	const restricted = (capability: RuntimeValue, action: RuntimeValue) => (...args: RuntimeValue) => {
		if (!capabilities[capability]) {
			throw new RangeError(`${product.name} does not support ${capability}.`);
		}
		return action(...args);
	};
	const effectLibraryScope = scope as EffectLibraryActionScope;
	const storedProjectOpenActions = createStoredProjectOpenActions({
		copy, state, store, sessionTab, switchProject, openProject,
	});
	const yieldProgramPlayhead = (operation: RuntimeValue) => (...args: RuntimeValue) => {
		if (capabilities.videoCompositing) videoNavigationService.shuttleStop();
		return operation(...args);
	};
	const recordingPreferences = createRecordingPreferenceActionFacade(
		scope as RecordingActionScope,
		restricted,
	);
	const sequenceExtensions = snapshotProductActionExtensions<RuntimeValue>(scope, 'productSequenceActions', [
		'label', 'setActive', 'stepFrame', 'seekLabel',
	]);
	const crossProductHandoffActions = createCrossProductHandoffActionFacade(scope as never);
	const macros = createEffectMacroActions(effectLibraryScope, restricted);
	const actions = Object.freeze({
		project: Object.freeze({
			create: (projectOptions: RuntimeValue) => newProject(projectOptions),
			open: (value: RuntimeValue) => openProject(value),
			openRecent: storedProjectOpenActions.openRecent,
			clearRecent: clearRecentProjects,
			openAudacityProject,
			openAup4, openDawproject, saveDawproject,
			openScape,
			openScapeFile,
			inspectScape,
			saveAup4,
			saveScape,
			saveAs: saveScape,
			dismissAup4CompatibilitySummary,
			close: closeProjectTab,
			openById: storedProjectOpenActions.openById,
			list: listProjects,
			save: saveNow,
			flush: flushProject,
			prepareHandoff: prepareProjectHandoff,
			...crossProductHandoffActions,
			claimLock: claimProjectLock,
			rename: (title: RuntimeValue) => renameProject(title),
			duplicate: (title: RuntimeValue) => duplicateProject(title),
			remove: deleteProject,
			clear: clearLocalData,
			importFiles,
			setTempo: (bpm: RuntimeValue) => commit({ type: 'tempo/set', bpm }),
			setTimeSignature: (numerator: RuntimeValue, denominator: RuntimeValue) => commit({ type: 'tempo/set', numerator, denominator }),
			setTempoMapMode: (mode: RuntimeValue) => commit({ type: 'tempo-map/mode-set', mode }),
			addTempoEvent: (event: RuntimeValue) => commit({
				type: 'tempo-event/add',
				event: { ...structuredClone(event), id: event?.id || createStableId('tempo') },
			}),
			updateTempoEvent: (eventId: RuntimeValue, changes: RuntimeValue) => commit({
				type: 'tempo-event/update', eventId, changes: structuredClone(changes),
			}),
			removeTempoEvent: (eventId: RuntimeValue) => commit({ type: 'tempo-event/remove', eventId }),
			addSignatureEvent: (event: RuntimeValue) => commit({
				type: 'signature-event/add',
				event: { ...structuredClone(event), id: event?.id || createStableId('signature') },
			}),
			updateSignatureEvent: (eventId: RuntimeValue, changes: RuntimeValue) => commit({
				type: 'signature-event/update', eventId, changes: structuredClone(changes),
			}),
			removeSignatureEvent: (eventId: RuntimeValue) => commit({ type: 'signature-event/remove', eventId }),
			setTimeDisplay: (format: RuntimeValue) => commit({ type: 'time-display/set', format }),
		}),
		projectBin: Object.freeze({
			moveFromTimeline: moveClipsToProjectBin,
			place: placeProjectBinClip,
			rename: renameProjectBinClip,
			setColor: setProjectBinClipColor,
			remove: removeProjectBinClip,
			removeFromBin: removeProjectBinClip,
			removeFromProject: removeProjectBinSource,
			selectInstances: selectProjectBinInstances,
			instanceCount: projectBinInstanceCount,
			prepareReplacement: prepareProjectBinReplacement,
			applyReplacement: applyProjectBinReplacement,
			cancelReplacement: cancelProjectBinReplacement,
			canRelinkLinkedAudio,
			classifyLinkedAudioRelink,
			relinkLinkedAudio,
			canRelinkLinkedVideo,
			classifyLinkedVideoRelink,
			relinkLinkedVideo,
			playPause: playPauseProjectBinClip,
			stopPreview: stopProjectBinPreview,
			getVisualData: getProjectBinClipVisualData,
		}),
		video: createVideoActionGroup(scope, restricted),
		edit: Object.freeze({
			execute: handleEdit,
			commit,
			undo: () => handleEdit('undo'),
			redo: () => handleEdit('redo'),
			copy: () => handleEdit('copy'),
			cut: () => handleEdit('cut'),
			paste: () => handleEdit('paste'),
			pasteOverlap: () => handleEdit('paste-overlap'),
			pasteInsert: () => handleEdit('paste-insert'),
			pasteAllTracksRipple: () => handleEdit('paste-all-tracks-ripple'),
			split: () => handleEdit('split'),
			splitAt: splitAtFrame,
			splitIntoNewTrack: () => handleEdit('split-new-track'),
			join: () => handleEdit('join'),
			disjoin: () => disjoinSelectedClip(),
			group: () => handleEdit('group'),
			ungroup: () => handleEdit('ungroup'),
			duplicate: () => handleEdit('duplicate'),
			delete: () => handleEdit('delete'),
			rippleDelete: () => handleEdit('ripple-delete'),
			cutLeaveGap: () => handleEdit('cut-leave-gap'),
			cutPerClipRipple: () => handleEdit('cut-per-clip-ripple'),
			cutPerTrackRipple: () => handleEdit('cut-per-track-ripple'),
			cutAllTracksRipple: () => handleEdit('cut-all-tracks-ripple'),
			deleteLeaveGap: () => handleEdit('delete-leave-gap'),
			deletePerClipRipple: () => handleEdit('delete-per-clip-ripple'),
			deletePerTrackRipple: () => handleEdit('delete-per-track-ripple'),
			deleteAllTracksRipple: () => handleEdit('delete-all-tracks-ripple'),
			trimOutsideSelection: () => handleEdit('trim-outside-selection'),
			silenceSelection: restricted('audioGenerators', () => generateSelectionSilence()),
		}),
		transport: Object.freeze({
			playPause: yieldProgramPlayhead(() => handleTransport('play')),
			playAtSpeed: yieldProgramPlayhead((rate: RuntimeValue = state.playAtSpeedRate) => handlePlayAtSpeed(rate)),
			setPlayAtSpeedRate,
			stop: yieldProgramPlayhead(() => handleTransport('stop')),
			seek: yieldProgramPlayhead((frame: RuntimeValue) => engine.seek(normalizePlaybackFrame(frame))),
			scrub: yieldProgramPlayhead((frame: RuntimeValue) => {
				if (state.recordingStarting || state.timedRecordingPreparing || state.timedRecording || state.recorder) {
					return engine.getPositionFrames();
				}
				if (hasMissingTimelineSources()) throw new Error(copy.localSourcesMissing);
				cancelPlaybackCachePreparation();
				const nextFrame = normalizePlaybackFrame(frame);
				return typeof engine.scrub === 'function' ? engine.scrub(nextFrame) : engine.seek(nextFrame);
			}),
			endScrub: yieldProgramPlayhead(() => engine.endScrub?.()),
			jumpStart: yieldProgramPlayhead(() => handleTransport('jump-start')),
			jumpEnd: yieldProgramPlayhead(() => handleTransport('jump-end')),
			rewind: yieldProgramPlayhead(() => handleTransport('rewind')),
			forward: yieldProgramPlayhead(() => handleTransport('forward')),
			toggleLoop: () => handleTransport('loop'),
			clearLoop: clearLoopRegion,
			setLoopRegion,
			loopToSelection: setLoopRegionToSelection,
			selectionToLoop: setSelectionToLoopRegion,
			setLoopInOut: setLoopRegionInOut,
			toggleSelectionFollowsLoop: toggleSelectionFollowsLoop,
			toggleMetronome,
		}),
		recording: createRecordingActionFacade(scope as RecordingActionScope, restricted),
		capture: Object.freeze({ ...framescaperCaptureActions }), webVcr: Object.freeze({ ...framescaperWebVcrActions }),
		metering: Object.freeze({
			pause: pauseLoudnessMeasurement,
			continue: continueLoudnessMeasurement,
			reset: resetLoudnessMeasurement,
		}),
		audioDevices: Object.freeze({
			requestAccess: requestInputAccess,
			refresh: () => refreshAudioDevices({ probe: true }),
			setPreferredInput: setPreferredInputDevice,
			setPreferredInputChannelCount,
			configureDisplayInput,
			setOutput: setAudioOutputDevice,
			setPlaybackGain: (gain: RuntimeValue) => {
				const value = engine.setPlaybackGain(Number(gain));
				publishDocumentSnapshot();
				return value;
			},
		}),
		storage: Object.freeze({
			refresh: refreshStorageUsage,
			requestPersistence: requestStoragePersistence,
			cleanupDisposable: cleanupDisposableStorage,
			cleanupDerivatives: cleanupDerivativeCache,
		}),
		timeline: Object.freeze({
			...selectionViewService.clipNavigation,
			selectTrack,
			selectClip,
			setSelection,
			setExactSelection,
			clearSelection: () => setSelection(0, 0, { trackIds: [], frequencyRange: null }),
			selectAllTracks,
			selectLeftOfPlayback: selectLeftOfPlaybackPosition,
			selectRightOfPlayback: selectRightOfPlaybackPosition,
			selectTrackStartToCursor,
			selectCursorToTrackEnd,
			selectTrackStartToEnd,
			setSnap: setSnapSettings,
			snapFrame: (frame: RuntimeValue, overrides: RuntimeValue) => snapTimelineFrame(frame, overrides),
			zeroCross: selectAtZeroCrossings,
			setView: setTimelineView,
			setAllTracksView: setAllTracksView,
			toggleRms: toggleRmsWaveform,
			toggleVerticalRulers,
			toggleUpdateWhilePlaying,
			togglePinnedPlayhead,
			toggleRulerPlayback,
			setViewportWidth: setTimelineViewportWidth,
			setZoom,
			zoomIn: (factor: RuntimeValue) => updateZoom('in', undefined, factor),
			zoomOut: (factor: RuntimeValue) => updateZoom('out', undefined, factor),
			zoomFit: (viewportWidth: RuntimeValue) => updateZoom('fit', viewportWidth),
			fitHeight: () => setAutoFitTrackHeight(true),
			resizeTrackHeight,
			setVisibleTrackHeights,
			getClipVisualData,
			getVisibleClips,
			requestWaveformPcmWindow,
		}),
		timelineAnnotations: createTimelineAnnotationActionFacade({
			service: timelineAnnotationService, regularInterval: regularIntervalAnnotationController.create,
			restricted, createId: createStableId,
		}),
		sequences: Object.freeze({
			view: (sequenceId: RuntimeValue) => sequenceTimingService.view(sequenceId),
			update: restricted('sequenceTiming', yieldProgramPlayhead((sequenceId: RuntimeValue, changes: RuntimeValue) => (
				sequenceTimingService.update(sequenceId, structuredClone(changes))
			))),
			label: (sample: RuntimeValue, sequenceId: RuntimeValue) => sequenceTimingService.label(sample, sequenceId),
			playheadLabel: (sequenceId: RuntimeValue) => sequenceTimingService.playheadLabel(sequenceId),
			snapSample: (sample: RuntimeValue, mode: RuntimeValue, sequenceId: RuntimeValue) => (
				sequenceTimingService.snapSample(sample, mode, sequenceId)
			),
			stepPlayhead: yieldProgramPlayhead((frameDelta: RuntimeValue, sequenceId: RuntimeValue) => (
				sequenceTimingService.stepPlayhead(frameDelta, sequenceId)
			)),
			seekLabel: yieldProgramPlayhead((label: RuntimeValue, sequenceId: RuntimeValue) => sequenceTimingService.seekLabel(label, sequenceId)),
			...sequenceExtensions,
		}),
		trackFolders: Object.freeze({
			create: restricted('trackFolders', (...args: RuntimeValue) => trackFolderService.createFolder(...args)),
			rename: restricted('trackFolders', (...args: RuntimeValue) => trackFolderService.renameFolder(...args)),
			update: restricted('trackFolders', (...args: RuntimeValue) => trackFolderService.updateFolder(...args)),
			toggleCollapsed: restricted('trackFolders', (...args: RuntimeValue) => trackFolderService.toggleCollapsed(...args)),
			remove: restricted('trackFolders', (...args: RuntimeValue) => trackFolderService.removeFolder(...args)),
			moveNode: restricted('trackFolders', (...args: RuntimeValue) => trackFolderService.moveNode(...args)),
			wrapSelection: restricted('trackFolders', (...args: RuntimeValue) => trackFolderService.wrapTracksIntoFolder(...args)),
			select: restricted('trackFolders', (...args: RuntimeValue) => trackFolderService.selectFolder(...args)),
			selectedFolderId: (...args: RuntimeValue) => trackFolderService.selectedFolderId(...args),
		}),
		...createProjectOwnedFeatureActionFacades({ capabilities, product, audioWarpService, takeCompService }),
		sampleEdit: Object.freeze({
			setMode: restricted('audioSampleEditing', setSampleEditMode),
			pencil: restricted('audioSampleEditing', applySamplePencil),
			smooth: restricted('audioSampleEditing', smoothSelectedSamples),
			cancel: cancelSampleEdit,
		}),
		spectral: Object.freeze({
			boxSelect: restricted('audioSpectralEditing', (...args: RuntimeValue) => effectSelectionService.setSpectralBoxSelection(...args)),
			brushSelect: restricted('audioSpectralEditing', (...args: RuntimeValue) => effectSelectionService.setSpectralBrushSelection(...args)),
			delete: restricted('audioSpectralEditing', () => applySpectralSelection(-Infinity)),
			amplify: restricted('audioSpectralEditing', (gainDb: RuntimeValue = 6) => applySpectralSelection(gainDb)),
		}),
		track: Object.freeze({
			add: addTrack,
			addVideo: addVideoTrackPair,
			// Compatibility aliases for Audacity's two add-track commands. The
			// resulting browser track has no media layout until it contains clips.
			addMono: addTrack,
			addStereo: addTrack,
			addLabel: addLabelTrack, ...trackStructuralOperations,
			update: (trackId: RuntimeValue, changes: RuntimeValue) => commit({ type: 'track/update', trackId, changes }, { selectTrackId: trackId }),
			reorder: reorderTrack,
			moveUp: (trackId: RuntimeValue = state.selectedTrackId) => moveTrack(trackId, 'up'),
			moveDown: (trackId: RuntimeValue = state.selectedTrackId) => moveTrack(trackId, 'down'),
			moveTop: (trackId: RuntimeValue = state.selectedTrackId) => moveTrack(trackId, 'top'),
			moveBottom: (trackId: RuntimeValue = state.selectedTrackId) => moveTrack(trackId, 'bottom'),
			makeStereo: restricted('audioEffects', makeStereoTrack),
			swapChannels: restricted('audioEffects', swapTrackChannels),
			splitStereoLR: restricted('audioEffects', (trackId: RuntimeValue = state.selectedTrackId) => splitStereoTrack(trackId, true)),
			splitStereoCenter: restricted('audioEffects', (trackId: RuntimeValue = state.selectedTrackId) => splitStereoTrack(trackId, false)),
			decreaseHeight: (trackId: RuntimeValue = state.selectedTrackId) => adjustTrackHeight(trackId, -16),
			increaseHeight: (trackId: RuntimeValue = state.selectedTrackId) => adjustTrackHeight(trackId, 16),
			decreaseAllHeights: () => adjustAllTrackHeights(-16),
			increaseAllHeights: () => adjustAllTrackHeights(16),
			setDisplayMode: setTrackDisplayMode,
			setRate: restricted('audioEffects', setTrackRate),
			setWaveformView: (trackId: RuntimeValue = state.selectedTrackId) => setTrackDisplayMode(trackId, 'waveform'),
			setSpectrogramView: restricted('audioSpectralEditing', (trackId: RuntimeValue = state.selectedTrackId) => setTrackDisplayMode(trackId, 'spectrogram')),
			setMultiView: restricted('audioSpectralEditing', (trackId: RuntimeValue = state.selectedTrackId) => setTrackDisplayMode(trackId, 'multiview')),
			mixAndRender: restricted('audioEffects', mixAndRenderTracks),
			resample: restricted('audioEffects', resampleTrack),
			duplicate: (trackId: RuntimeValue) => duplicateTrack(findTrack(getProject(), trackId)),
			remove: (trackId: RuntimeValue) => commit({ type: 'track/remove', trackId }),
		}),
		mixer: Object.freeze({
			addBus: (busType: RuntimeValue, options: RuntimeValue = {}) => {
				const id = options.id || createStableId(`${busType}-bus`);
				commit({ type: 'mixer/bus-add', busType, bus: { ...options, id } });
				return id;
			},
			updateBus: (busType: RuntimeValue, busId: RuntimeValue, changes: RuntimeValue) => commit({ type: 'mixer/bus-update', busType, busId, changes }),
			removeBus: (busType: RuntimeValue, busId: RuntimeValue) => commit({ type: 'mixer/bus-remove', busType, busId }),
			setRoute: (trackId: RuntimeValue, changes: RuntimeValue) => commit({ type: 'mixer/route-update', trackId, changes }),
			setSend: (trackId: RuntimeValue, sendId: RuntimeValue, gain: RuntimeValue) => commit({
				type: 'mixer/route-update', trackId, changes: { sends: { [sendId]: gain } },
			}),
			updateMaster: (changes: RuntimeValue) => commit({ type: 'master/update', changes }),
		}),
		generators: Object.freeze({
			generate: restricted('audioGenerators', generateSignal), repeatLast: restricted('audioGenerators', repeatLastGenerator),
		}),
		nyquist: Object.freeze({
			evaluate: restricted('audioEffects', (request: RuntimeValue) => runNyquistEvaluation(request)),
			preview: restricted('audioEffects', (request: RuntimeValue) => runNyquistEvaluation({ ...request, preview: true })),
			cancel: cancelNyquistEvaluation,
		}),
		labels: Object.freeze({
			add: addLabel,
			update: (trackId: RuntimeValue, labelId: RuntimeValue, changes: RuntimeValue) => commit({ type: 'label/update', trackId, labelId, changes }),
			remove: (trackId: RuntimeValue, labelId: RuntimeValue) => commit({ type: 'label/remove', trackId, labelId }),
			importFile: importLabelFile,
			export: exportLabels,
		}),
		metadata: Object.freeze({
			update: (changes: RuntimeValue) => commit({ type: 'metadata/update', changes }),
		}),
		preferences: createPreferenceActionGroup(scope as PreferenceActionScope, recordingPreferences),
		clip: Object.freeze({
			update: (clipId: RuntimeValue, changes: RuntimeValue) => commit({ type: 'clip/update', clipId, changes }, { selectClipId: clipId }),
			setTimePitch: restricted('audioEffects', setClipTimePitch),
			stretch: restricted('audioEffects', stretchClip),
			toggleStretchToTempo: restricted('audioEffects', toggleStretchToTempo),
			resetPitchSpeed: restricted('audioEffects', resetClipPitchSpeed),
			renderPitchSpeed: restricted('audioEffects', renderClipPitchSpeed),
			resample: restricted('audioEffects', resampleClip),
			move: moveClips,
			moveToNewTrack: moveClipsToNewTrack,
			trim: trimClips,
			overwrite: overwriteClips,
			remove: (clipId: RuntimeValue) => commit({ type: 'clip/remove', clipId }),
			reverse: restricted('audioEffects', (clipId: RuntimeValue) => handleClipAction('reverse', clipId)),
			invert: restricted('audioEffects', (clipId: RuntimeValue) => handleClipAction('invert', clipId)),
			normalizePeak: restricted('audioEffects', (clipId: RuntimeValue) => handleClipAction('normalize-peak', clipId)),
			normalizeLoudness: restricted('audioEffects', (clipId: RuntimeValue) => handleClipAction('normalize-lufs', clipId)),
		}),
		effects: Object.freeze({
			add: restricted('audioEffects', addEffect),
			update: restricted('audioEffects', updateRackEffect),
			beginRackEffectGesture: restricted('audioEffects', beginRackEffectGesture),
			previewRackEffect: restricted('audioEffects', previewRackEffect),
			commitRackEffectGesture: restricted('audioEffects', commitRackEffectGesture),
			cancelRackEffectGesture: restricted('audioEffects', cancelRackEffectGesture),
			beginParametricEqGesture: restricted('audioEffects', beginParametricEqGesture),
			previewParametricEq: restricted('audioEffects', previewParametricEq),
			commitParametricEqGesture: restricted('audioEffects', commitParametricEqGesture),
			cancelParametricEqGesture: restricted('audioEffects', cancelParametricEqGesture),
			auditionParametricEq: (scope: RuntimeValue, trackId: RuntimeValue, effectId: RuntimeValue, bandId: RuntimeValue) => engine.auditionParametricEq?.(scope, trackId, effectId, bandId) ?? false,
			readParametricEqSpectrum: (scope: RuntimeValue, trackId: RuntimeValue, effectId: RuntimeValue, which: RuntimeValue, target: RuntimeValue) => engine.readParametricEqSpectrum?.(scope, trackId, effectId, which, target) ?? null,
			readDynamicsAnalysis: (scope: RuntimeValue, trackId: RuntimeValue, effectId: RuntimeValue) => engine.readDynamicsAnalysis?.(scope, trackId, effectId) ?? null,
			readSelectionParametricEqSpectrum: (which: RuntimeValue, target: RuntimeValue) => state.audacityPreviewSource?.readSpectrum?.(which, target) ?? null,
			auditionSelectionParametricEq: (bandId: RuntimeValue) => {
				state.audacityPreviewAuditionBandId = bandId == null ? null : String(bandId);
				return state.audacityPreviewSource?.audition?.(state.audacityPreviewAuditionBandId) ?? false;
			},
			remove: restricted('audioEffects', (scope: RuntimeValue, trackId: RuntimeValue, effectId: RuntimeValue) => commit({ type: 'effect/remove', scope, trackId, busId: trackId, effectId })),
			reorder: restricted('audioEffects', (scope: RuntimeValue, trackId: RuntimeValue, effectId: RuntimeValue, toIndex: RuntimeValue) => commit({ type: 'effect/reorder', scope, trackId, busId: trackId, effectId, toIndex })),
			copyStack: restricted('audioEffects', copyEffectStack),
			pasteStack: restricted('audioEffects', pasteEffectStack),
			setMasterGain: (gain: RuntimeValue) => commit({ type: 'master/update', changes: { gain: Math.max(0, Math.min(4, Number(gain))) } }),
			setSelectionType: restricted('audioEffects', setAudacityEffectType),
			setSelectionParams: restricted('audioEffects', setAudacityEffectParamsFromController),
			setControlTrack: restricted('audioEffects', setAudacityControlTrack),
			captureNoiseProfile: restricted('audioEffects', captureSelectedNoiseProfile),
			captureRackNoiseProfile: restricted('audioEffects', captureRackNoiseProfileFromController),
			applySelection: restricted('audioEffects', applyAudacityEffectFromController),
			previewSelection: restricted('audioEffects', previewAudacityEffectFromController),
			cancelPreview: () => cancelAudacityEffectPreview(),
			repeatLast: restricted('audioEffects', repeatLastAudacityEffect),
			presets: createEffectPresetActions(effectLibraryScope, restricted),
		}),
		macros,
		analysis: Object.freeze({
			run: restricted('audioAnalysis', analysisService.run),
			plotSpectrum: restricted('audioAnalysis', analysisService.plotSpectrum),
			findClipping: restricted('audioAnalysis', analysisService.findClipping),
			contrast: restricted('audioAnalysis', analysisService.captureContrast), repeatLast: restricted('audioAnalysis', analysisService.repeatLast),
			measureLoudness: restricted('audioAnalysis', analysisService.measureLoudness),
		}),
		export: createExportActionGroup({ handleExportAction, state, productName: product.name, getProjectTitle: () => getProject()?.title ?? null, getProject, fileService, persistSetting, publishDocumentSnapshot, createId: createStableId }),
		media: createProjectMediaActionGroup({
			state, getProject, store, publishDocumentSnapshot, setStatus, copy, fileService, ffmpeg, commit,
		}),
	});
	// A macro's bare commands walk this tree, and it does not exist until the
	// groups that make it up have all been built.
	macros.bindEditorActions(actions as unknown as Readonly<Record<string, unknown>>);
	return actions;
}
