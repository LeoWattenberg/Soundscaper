/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EngineParametricEqPreview } from '../../engine/public-api.ts';
import type { EditorActionRuntime } from './action-facade-runtime.ts';
import type { AudioEditorCommandPayloads } from '../../commands/protocol.ts';
import { assertEditorActionFunctions } from './action-facade-runtime.ts';
import {
	createRecordingActionFacade,
	createRecordingPreferenceActionFacade,
} from '../recording/recording-action-facade.ts';
import { createProjectOwnedFeatureActionFacades } from './internal/project-owned-feature-action-facades.ts';
import { createTimelineAnnotationActionFacade } from '../document/timeline-annotation-action-facade.ts';
import { createVideoActionGroup } from '../clip-video/video-action-group.ts';
import { snapshotProductActionExtensions } from './internal/product-action-extensions.ts';
import { createExportActionGroup } from '../export/export-action-group.ts';
import { createProjectMediaActionGroup } from '../document/project-media-action-group.ts';
import {
	createPreferenceActionGroup,
} from '../preferences/preference-action-group.ts';
import { createStoredProjectOpenActions } from '../document/stored-project-open-actions.ts';
import { createCrossProductHandoffActionFacade } from '../document/cross-product-handoff-action-facade.ts';
import {
	createEffectMacroActions,
	createEffectPresetActions,
} from '../effects/effect-library-action-groups.ts';

export type { EditorActionRuntime } from './action-facade-runtime.ts';

export function createGroupedEditorActions(scope: EditorActionRuntime) {
	assertEditorActionFunctions(scope);
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
	toggleRulerPlayback, toggleSelectionFollowsLoop, toggleStretchToTempo, toggleScrollViewToPlayhead,
	toggleVerticalRulers, trimClips, updateRackEffect, updateZoom, selectionViewService, sequenceTimingService,
	timelineAnnotationService, regularIntervalAnnotationController, trackFolderService, trackStructuralOperations,
	audioWarpService, takeCompService, videoNavigationService,
	} = scope;
	const restricted = <Args extends unknown[], Result>(capability: string, action: (...args: Args) => Result) => (...args: Args): Result => {
		if (!capabilities[capability]) {
			throw new RangeError(`${product.name} does not support ${capability}.`);
		}
		return action(...args);
	};
	const effectLibraryScope = scope;
	const storedProjectOpenActions = createStoredProjectOpenActions({
		copy, state, store, sessionTab, switchProject, openProject,
	});
	const yieldProgramPlayhead = <Args extends unknown[], Result>(operation: (...args: Args) => Result) => (...args: Args): Result => {
		if (capabilities.videoCompositing) videoNavigationService.shuttleStop();
		return operation(...args);
	};
	const recordingPreferences = createRecordingPreferenceActionFacade(
		scope,
		restricted,
	);
	const sequenceExtensions = snapshotProductActionExtensions<(...args: unknown[]) => unknown>(scope, 'productSequenceActions', [
		'label', 'setActive', 'stepFrame', 'seekLabel',
	]);
	const crossProductHandoffActions = createCrossProductHandoffActionFacade({ ...scope, copy: { projectSaved: copy.projectSaved, projectSaving: copy.projectSaving } });
	const macros = createEffectMacroActions(effectLibraryScope, restricted);
	const actions = Object.freeze({
		project: Object.freeze({
			create: (...args: Parameters<typeof newProject>) => newProject(...args),
			open: (...args: Parameters<typeof openProject>) => openProject(...args),
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
			rename: (...args: Parameters<typeof renameProject>) => renameProject(...args),
			duplicate: (...args: Parameters<typeof duplicateProject>) => duplicateProject(...args),
			remove: deleteProject,
			clear: clearLocalData,
			importFiles,
			setTempo: (bpm: number) => commit({ type: 'tempo/set', bpm }),
			setTimeSignature: (numerator: number, denominator: number) => commit({ type: 'tempo/set', numerator, denominator }),
			setTempoMapMode: (mode: AudioEditorCommandPayloads['tempo-map/mode-set']['mode']) => commit({ type: 'tempo-map/mode-set', mode }),
			addTempoEvent: (event: Omit<AudioEditorCommandPayloads['tempo-event/add']['event'], 'id'> & { readonly id?: string }) => commit({
				type: 'tempo-event/add',
				event: { ...structuredClone(event), id: event?.id || createStableId('tempo') },
			}),
			updateTempoEvent: (eventId: string, changes: AudioEditorCommandPayloads['tempo-event/update']['changes']) => commit({
				type: 'tempo-event/update', eventId, changes: structuredClone(changes),
			}),
			removeTempoEvent: (eventId: string) => commit({ type: 'tempo-event/remove', eventId }),
			addSignatureEvent: (event: Omit<AudioEditorCommandPayloads['signature-event/add']['event'], 'id'> & { readonly id?: string }) => commit({
				type: 'signature-event/add',
				event: { ...structuredClone(event), id: event?.id || createStableId('signature') },
			}),
			updateSignatureEvent: (eventId: string, changes: AudioEditorCommandPayloads['signature-event/update']['changes']) => commit({
				type: 'signature-event/update', eventId, changes: structuredClone(changes),
			}),
			removeSignatureEvent: (eventId: string) => commit({ type: 'signature-event/remove', eventId }),
			setTimeDisplay: (format: AudioEditorCommandPayloads['time-display/set']['format']) => commit({ type: 'time-display/set', format }),
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
			labeledCut: () => handleEdit('labeled-cut'),
			labeledDelete: () => handleEdit('labeled-delete'),
			labeledCutLeaveGap: () => handleEdit('labeled-split-cut'),
			labeledDeleteLeaveGap: () => handleEdit('labeled-split-delete'),
			labeledSilence: restricted('audioGenerators', () => handleEdit('labeled-silence')),
			labeledCopy: () => handleEdit('labeled-copy'),
			labeledSplit: () => handleEdit('labeled-split'),
			labeledJoin: () => handleEdit('labeled-join'),
			labeledDisjoin: () => handleEdit('labeled-disjoin'),
		}),
		transport: Object.freeze({
			playPause: yieldProgramPlayhead(() => handleTransport('play')),
			playSelection: yieldProgramPlayhead(() => handleTransport('play-selection')),
			playAtSpeed: yieldProgramPlayhead((rate: number = state.playAtSpeedRate) => handlePlayAtSpeed(rate)),
			setPlayAtSpeedRate,
			stop: yieldProgramPlayhead(() => handleTransport('stop')),
			seek: yieldProgramPlayhead((frame: number) => engine.seek(normalizePlaybackFrame(frame))),
			scrub: yieldProgramPlayhead((frame: number) => {
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
		recording: createRecordingActionFacade(scope, restricted),
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
			setPlaybackGain: (gain: number) => {
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
			selectAll: () => selectionViewService.selectAll(),
			selectAllTracks,
			selectLeftOfPlayback: selectLeftOfPlaybackPosition,
			selectRightOfPlayback: selectRightOfPlaybackPosition,
			selectTrackStartToCursor,
			selectCursorToTrackEnd,
			selectTrackStartToEnd,
			setSnap: setSnapSettings,
			snapFrame: (...args: Parameters<typeof snapTimelineFrame>) => snapTimelineFrame(...args),
			zeroCross: selectAtZeroCrossings,
			setView: setTimelineView,
			setAllTracksView: setAllTracksView,
			toggleRms: toggleRmsWaveform,
			toggleVerticalRulers,
			toggleScrollViewToPlayhead,
			togglePinnedPlayhead,
			toggleRulerPlayback,
			setViewportWidth: setTimelineViewportWidth,
			setZoom,
			zoomIn: (factor?: number) => updateZoom('in', undefined, factor),
			zoomOut: (factor?: number) => updateZoom('out', undefined, factor),
			zoomFit: (viewportWidth: number) => updateZoom('fit', viewportWidth),
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
			view: (...args: Parameters<typeof sequenceTimingService.view>) => sequenceTimingService.view(...args),
			update: restricted('sequenceTiming', yieldProgramPlayhead((sequenceId: string, changes: Readonly<Record<string, unknown>>) => (
				sequenceTimingService.update(sequenceId, structuredClone(changes))
			))),
			label: (...args: Parameters<typeof sequenceTimingService.label>) => sequenceTimingService.label(...args),
			playheadLabel: (...args: Parameters<typeof sequenceTimingService.playheadLabel>) => sequenceTimingService.playheadLabel(...args),
			snapSample: (...args: Parameters<typeof sequenceTimingService.snapSample>) => sequenceTimingService.snapSample(...args),
			stepPlayhead: yieldProgramPlayhead((...args: Parameters<typeof sequenceTimingService.stepPlayhead>) => sequenceTimingService.stepPlayhead(...args)),
			seekLabel: yieldProgramPlayhead((...args: Parameters<typeof sequenceTimingService.seekLabel>) => sequenceTimingService.seekLabel(...args)),
			...sequenceExtensions,
		}),
		trackFolders: Object.freeze({
			create: restricted('trackFolders', (...args: Parameters<typeof trackFolderService.createFolder>) => trackFolderService.createFolder(...args)),
			rename: restricted('trackFolders', (...args: Parameters<typeof trackFolderService.renameFolder>) => trackFolderService.renameFolder(...args)),
			update: restricted('trackFolders', (...args: Parameters<typeof trackFolderService.updateFolder>) => trackFolderService.updateFolder(...args)),
			toggleCollapsed: restricted('trackFolders', (...args: Parameters<typeof trackFolderService.toggleCollapsed>) => trackFolderService.toggleCollapsed(...args)),
			remove: restricted('trackFolders', (...args: Parameters<typeof trackFolderService.removeFolder>) => trackFolderService.removeFolder(...args)),
			moveNode: restricted('trackFolders', (...args: Parameters<typeof trackFolderService.moveNode>) => trackFolderService.moveNode(...args)),
			wrapSelection: restricted('trackFolders', (...args: Parameters<typeof trackFolderService.wrapTracksIntoFolder>) => trackFolderService.wrapTracksIntoFolder(...args)),
			select: restricted('trackFolders', (...args: Parameters<typeof trackFolderService.selectFolder>) => trackFolderService.selectFolder(...args)),
			selectedFolderId: (...args: Parameters<typeof trackFolderService.selectedFolderId>) => trackFolderService.selectedFolderId(...args),
		}),
		...createProjectOwnedFeatureActionFacades({ capabilities, product, audioWarpService, takeCompService }),
		sampleEdit: Object.freeze({
			setMode: restricted('audioSampleEditing', setSampleEditMode),
			pencil: restricted('audioSampleEditing', applySamplePencil),
			smooth: restricted('audioSampleEditing', smoothSelectedSamples),
			cancel: cancelSampleEdit,
		}),
		spectral: Object.freeze({
			boxSelect: restricted('audioSpectralEditing', (...args: Parameters<typeof effectSelectionService.setSpectralBoxSelection>) => effectSelectionService.setSpectralBoxSelection(...args)),
			brushSelect: restricted('audioSpectralEditing', (...args: Parameters<typeof effectSelectionService.setSpectralBrushSelection>) => effectSelectionService.setSpectralBrushSelection(...args)),
			delete: restricted('audioSpectralEditing', () => applySpectralSelection(-Infinity)),
			amplify: restricted('audioSpectralEditing', (gainDb: number = 6) => applySpectralSelection(gainDb)),
		}),
		track: Object.freeze({
			add: addTrack,
			addVideo: addVideoTrackPair,
			// Compatibility aliases for Audacity's two add-track commands. The
			// resulting browser track has no media layout until it contains clips.
			addMono: addTrack,
			addStereo: addTrack,
			addLabel: addLabelTrack, ...trackStructuralOperations,
			update: (trackId: string | null, changes: Readonly<Record<string, unknown>>) => commit({ type: 'track/update', trackId, changes }, { selectTrackId: trackId }),
			reorder: reorderTrack,
			moveUp: (trackId: string | null = state.selectedTrackId) => moveTrack(trackId, 'up'),
			moveDown: (trackId: string | null = state.selectedTrackId) => moveTrack(trackId, 'down'),
			moveTop: (trackId: string | null = state.selectedTrackId) => moveTrack(trackId, 'top'),
			moveBottom: (trackId: string | null = state.selectedTrackId) => moveTrack(trackId, 'bottom'),
			makeStereo: restricted('audioEffects', makeStereoTrack),
			swapChannels: restricted('audioEffects', swapTrackChannels),
			splitStereoLR: restricted('audioEffects', (trackId: string | null = state.selectedTrackId) => splitStereoTrack(trackId, true)),
			splitStereoCenter: restricted('audioEffects', (trackId: string | null = state.selectedTrackId) => splitStereoTrack(trackId, false)),
			decreaseHeight: (trackId: string | null = state.selectedTrackId) => adjustTrackHeight(trackId, -16),
			increaseHeight: (trackId: string | null = state.selectedTrackId) => adjustTrackHeight(trackId, 16),
			decreaseAllHeights: () => adjustAllTrackHeights(-16),
			increaseAllHeights: () => adjustAllTrackHeights(16),
			setDisplayMode: setTrackDisplayMode,
			setRate: restricted('audioEffects', setTrackRate),
			setWaveformView: (trackId: string | null = state.selectedTrackId) => setTrackDisplayMode(trackId, 'waveform'),
			setSpectrogramView: restricted('audioSpectralEditing', (trackId: string | null = state.selectedTrackId) => setTrackDisplayMode(trackId, 'spectrogram')),
			setMultiView: restricted('audioSpectralEditing', (trackId: string | null = state.selectedTrackId) => setTrackDisplayMode(trackId, 'multiview')),
			mixAndRender: restricted('audioEffects', mixAndRenderTracks),
			resample: restricted('audioEffects', resampleTrack),
			duplicate: (trackId: string | null) => duplicateTrack(findTrack(getProject(), trackId)),
			remove: (trackId: string | null) => commit({ type: 'track/remove', trackId }),
		}),
		mixer: Object.freeze({
			addBus: (busType: AudioEditorCommandPayloads['mixer/bus-add']['busType'], options: Readonly<Record<string, unknown>> = {}) => {
				const id = options.id || createStableId(`${busType}-bus`);
				commit({ type: 'mixer/bus-add', busType, bus: { ...options, id } });
				return id;
			},
			updateBus: (busType: AudioEditorCommandPayloads['mixer/bus-add']['busType'], busId: string, changes: Readonly<Record<string, unknown>>) => commit({ type: 'mixer/bus-update', busType, busId, changes }),
			removeBus: (busType: AudioEditorCommandPayloads['mixer/bus-add']['busType'], busId: string) => commit({ type: 'mixer/bus-remove', busType, busId }),
			setRoute: (trackId: string | null, changes: Readonly<Record<string, unknown>>) => commit({ type: 'mixer/route-update', trackId, changes }),
			setSend: (trackId: string | null, sendId: string, gain: number) => commit({
				type: 'mixer/route-update', trackId, changes: { sends: { [sendId]: gain } },
			}),
			updateMaster: (changes: Readonly<Record<string, unknown>>) => commit({ type: 'master/update', changes }),
		}),
		generators: Object.freeze({
			generate: restricted('audioGenerators', generateSignal), repeatLast: restricted('audioGenerators', repeatLastGenerator),
		}),
		nyquist: Object.freeze({
			evaluate: restricted('audioEffects', (...args: Parameters<typeof runNyquistEvaluation>) => runNyquistEvaluation(...args)),
			preview: restricted('audioEffects', (request: Readonly<Record<string, unknown>>) => runNyquistEvaluation({ ...request, preview: true })),
			cancel: cancelNyquistEvaluation,
		}),
		labels: Object.freeze({
			add: addLabel,
			update: (trackId: string | null, labelId: string, changes: Readonly<Record<string, unknown>>) => commit({ type: 'label/update', trackId, labelId, changes }),
			remove: (trackId: string | null, labelId: string) => commit({ type: 'label/remove', trackId, labelId }),
			importFile: importLabelFile,
			export: exportLabels,
		}),
		metadata: Object.freeze({
			update: (changes: Readonly<Record<string, unknown>>) => commit({ type: 'metadata/update', changes }),
		}),
		preferences: createPreferenceActionGroup(scope, recordingPreferences),
		clip: Object.freeze({
			update: (clipId: string, changes: Readonly<Record<string, unknown>>) => commit({ type: 'clip/update', clipId, changes }, { selectClipId: clipId }),
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
			remove: (clipId: string) => commit({ type: 'clip/remove', clipId }),
			reverse: restricted('audioEffects', (clipId: string) => handleClipAction('reverse', clipId)),
			invert: restricted('audioEffects', (clipId: string) => handleClipAction('invert', clipId)),
			normalizePeak: restricted('audioEffects', (clipId: string) => handleClipAction('normalize-peak', clipId)),
			normalizeLoudness: restricted('audioEffects', (clipId: string) => handleClipAction('normalize-lufs', clipId)),
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
			auditionParametricEq: (...args: Parameters<NonNullable<typeof engine.auditionParametricEq>>) => engine.auditionParametricEq?.(...args) ?? false,
			readParametricEqSpectrum: (...args: Parameters<NonNullable<typeof engine.readParametricEqSpectrum>>) => engine.readParametricEqSpectrum?.(...args) ?? null,
			readDynamicsAnalysis: (...args: Parameters<NonNullable<typeof engine.readDynamicsAnalysis>>) => engine.readDynamicsAnalysis?.(...args) ?? null,
			readSelectionParametricEqSpectrum: (...args: Parameters<EngineParametricEqPreview['readSpectrum']>) => {
				const source = state.audacityPreviewSource;
				return source && 'readSpectrum' in source ? source.readSpectrum?.(...args) ?? null : null;
			},
			auditionSelectionParametricEq: (bandId: string | number | null) => {
				state.audacityPreviewAuditionBandId = bandId == null ? null : String(bandId);
				const source = state.audacityPreviewSource;
				return source && 'audition' in source ? source.audition?.(state.audacityPreviewAuditionBandId) ?? false : false;
			},
			remove: restricted('audioEffects', (scope: AudioEditorCommandPayloads['effect/remove']['scope'], trackId: string | null, effectId: string) => commit({ type: 'effect/remove', scope, trackId, busId: trackId, effectId })),
			reorder: restricted('audioEffects', (scope: AudioEditorCommandPayloads['effect/remove']['scope'], trackId: string | null, effectId: string, toIndex: number) => commit({ type: 'effect/reorder', scope, trackId, busId: trackId, effectId, toIndex })),
			copyStack: restricted('audioEffects', copyEffectStack),
			pasteStack: restricted('audioEffects', pasteEffectStack),
			setMasterGain: (gain: number) => commit({ type: 'master/update', changes: { gain: Math.max(0, Math.min(4, Number(gain))) } }),
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
	macros.bindEditorActions(actions);
	return actions;
}
