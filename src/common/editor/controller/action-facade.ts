/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorActions } from '../types.ts';
import {
	createRecordingActionFacade,
	createRecordingPreferenceActionFacade,
	type RecordingActionScope,
} from './recording-action-facade.ts';
import { createProjectOwnedFeatureActionFacades } from './project-owned-feature-action-facades.ts';
import { createTimelineAnnotationActionFacade } from './timeline-annotation-action-facade.ts';
import { createVideoTrimActionFacade } from './video-trim-action-facade.ts';
import { snapshotProductActionExtensions } from './product-action-extensions.ts';

export interface EditorActionRuntime {
	// The runtime composition root is JavaScript while it is being decomposed.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}

type RuntimeValue = EditorActionRuntime[string];

export function createGroupedEditorActions(scope: EditorActionRuntime): EditorActions;
export function createGroupedEditorActions(scope: EditorActionRuntime): RuntimeValue {
	const {
	AUDIO_EDITOR_DEFAULT_SHORTCUTS, addEffect, addLabel, addLabelTrack,
	addTrack, addVideoClipEffect, addVideoTrackPair, adjustAllTrackHeights,
	adjustTrackHeight, analysisService, applyAudacityEffectFromController, applyEffectPreset,
	applyProjectBinReplacement, applySamplePencil, applySpectralSelection, beginParametricEqGesture,
	beginRackEffectGesture, beginVideoEffectGesture, bypassVideoClipEffect, cancelAudacityEffectPreview,
	cancelNyquistEvaluation, cancelParametricEqGesture, cancelPlaybackCachePreparation, cancelProjectBinReplacement,
	cancelRackEffectGesture, cancelSampleEdit, cancelVideoEffectGesture,
	capabilities, captureRackNoiseProfileFromController, captureSelectedNoiseProfile, claimProjectLock,
	clearLocalData, clearLoopRegion, clearRecentProjects, closeProjectTab,
	commit, commitParametricEqGesture, commitRackEffectGesture, commitVideoEffectGesture,
	configureDisplayInput, continueLoudnessMeasurement, copy, copyEffectStack,
	createStableId, createWorkspacePreference, currentAudacityEffectParams, deleteEffectPreset,
	deleteProject, deleteWorkspacePreference, disjoinSelectedClip, dismissAup4CompatibilitySummary,
	duplicateProject, duplicateTrack, engine, exportEffectPreset,
	exportLabels, exportVideo, findTrack,
	flushProject, generateSelectionSilence, generateSignal, repeatLastGenerator, getClipVisualData,
	getProjectBinClipVisualData, getVideoSourceVisualData, getVisibleClips, handleClipAction, handleEdit,
	handleExportAction, handlePlayAtSpeed, handleTransport, hasMissingTimelineSources,
	importEffectPresets, importFiles, importLabelFile, inspectScape,
	listAudioEditorEffectPresets, listProjects, makeStereoTrack, mixAndRenderTracks,
	moveClips, moveClipsToNewTrack, moveClipsToProjectBin, movePanelPreference,
	moveToolbarPreference, moveTrack, newProject, normalizePlaybackFrame,
	openAudacityProject, openAup4, openProject, openScape, openScapeFile, overwriteClips,
	pasteEffectStack, pauseLoudnessMeasurement, placeProjectBinClip, playPauseProjectBinClip,
	prepareProjectBinReplacement, prepareProjectHandoff, previewAudacityEffectFromController, previewParametricEq,
	previewRackEffect, previewVideoEffectGesture, product, getProject,
	projectBinInstanceCount, refreshAudioDevices, refreshStorageUsage,
	canRelinkLinkedAudio, relinkLinkedAudio, canRelinkLinkedVideo, classifyLinkedVideoRelink, relinkLinkedVideo,
	releaseVideoSourceVisual, removeProjectBinClip, removeProjectBinSource, removeVideoClipEffect, renameProject,
	renameProjectBinClip, renderClipPitchSpeed, reorderTrack, reorderVideoClipEffect,
	repeatLastAudacityEffect, requestInputAccess, requestStoragePersistence, requestWaveformPcmWindow, resampleTrack,
	resetClipPitchSpeed, resetLoudnessMeasurement, resizeTrackHeight,
	runEffectMacro, runNyquistEvaluation, saveAup4, saveEffectPreset,
	saveNow, saveScape, selectAllTracks,
	selectAtZeroCrossings, selectClip, selectCursorToTrackEnd, selectLeftOfPlaybackPosition,
	selectProjectBinInstances, selectRightOfPlaybackPosition, selectTrack, selectTrackStartToCursor,
	selectTrackStartToEnd, sessionTab, setAllTracksView, setAudacityControlTrack,
	setAudacityEffectParamsFromController, setAudacityEffectType, setAudioOutputDevice, setAutoFitTrackHeight,
	setClipTimePitch, setLoopRegion, setLoopRegionInOut, setStatus,
	setLoopRegionToSelection, setPanelPreference,
	setPlayAtSpeedRate, setPreferredInputChannelCount, setPreferredInputDevice, setProjectBinClipColor,
	setSampleEditMode, setSelection, setSelectionToLoopRegion, setShortcutPreference,
	setSnapSettings, effectSelectionService, setTimelineView, setTimelineViewportWidth,
	setToolbarButtonPreference, setTrackDisplayMode, setTrackRate, setTrackSampleFormat,
	setVisibleTrackHeights, setWorkspacePreference, setZoom, smoothSelectedSamples,
	snapTimelineFrame, splitAtFrame, splitStereoTrack,
	state, stopProjectBinPreview, cleanupDisposableStorage, cleanupDerivativeCache, store, stretchClip, swapTrackChannels, switchProject,
	toggleMetronome, togglePanelPreference, togglePinnedPlayhead,
	toggleRmsWaveform, toggleRulerPlayback, toggleSelectionFollowsLoop,
	toggleStretchToTempo, toggleToolbarPreference, toggleUpdateWhilePlaying, toggleVerticalRulers, toggleVideoClipEffect,
	trimClips, updatePreferences, updateRackEffect, updateVideoClipEffect, updateWorkspacePreference, updateZoom,
	selectionViewService, sequenceTimingService, sourceMonitorService, timelineAnnotationService,
	regularIntervalAnnotationController, trackFolderService, trackStructuralOperations, videoEditService,
	audioWarpService, productSequenceActions, takeCompService, videoNavigationService,
	videoSourceReprobeService, videoTrimServices,
	} = scope;
	const restricted = (capability: RuntimeValue, action: RuntimeValue) => (...args: RuntimeValue) => {
		if (!capabilities[capability]) {
			throw new RangeError(`${product.name} does not support ${capability}.`);
		}
		return action(...args);
	};
	const videoNavigationMessage = (template: RuntimeValue, values: Readonly<Record<string, RuntimeValue>>) => (
		Object.entries(values).reduce((message, [key, value]) => (
			message.replace(`{${key}}`, String(value))
		), String(template))
	);
	const reportVideoShuttle = (operation: RuntimeValue) => {
		const view = operation();
		const timecode = sequenceTimingService.label(view.positionFrame, view.sequenceId);
		const message = view.rate === 0
			? videoNavigationMessage(copy.shuttleStoppedStatus, { timecode })
			: videoNavigationMessage(copy.shuttleStatus, {
				direction: view.rate < 0 ? copy.shuttleBackward : copy.shuttleForward,
				rate: Math.abs(view.rate), timecode,
			});
		setStatus(message, 'success');
		return view;
	};
	const navigateVideoEdit = (direction: 'previous' | 'next') => {
		const result = direction === 'previous'
			? videoNavigationService.previousEditPoint()
			: videoNavigationService.nextEditPoint();
		const found = result !== null;
		setStatus(found
			? videoNavigationMessage(direction === 'previous' ? copy.previousEditStatus : copy.nextEditStatus, {
				timecode: sequenceTimingService.playheadLabel(),
			})
			: direction === 'previous' ? copy.noPreviousEdit : copy.noNextEdit, found ? 'success' : 'info');
		return result;
	};
	const yieldProgramPlayhead = (operation: RuntimeValue) => (...args: RuntimeValue) => {
		if (capabilities.videoCompositing) videoNavigationService.shuttleStop();
		return operation(...args);
	};
	const recordingPreferences = createRecordingPreferenceActionFacade(
		scope as RecordingActionScope,
		restricted,
	);
	const sequenceExtensions = snapshotProductActionExtensions<RuntimeValue>(productSequenceActions, [
		'label', 'setActive', 'stepFrame', 'seekLabel',
	]);
	return Object.freeze({
		project: Object.freeze({
			create: (projectOptions: RuntimeValue) => newProject(projectOptions),
			open: (value: RuntimeValue) => openProject(value),
			openRecent: async (projectId: RuntimeValue = null) => {
				if (projectId == null) return state.recentProjectIds
					.map((id: RuntimeValue) => state.projects.find((candidate: RuntimeValue) => candidate.id === id))
					.filter(Boolean);
				if (!state.recentProjectIds.includes(projectId)) throw new Error(copy.projectNotFound);
				const openTab = sessionTab(projectId);
				if (openTab) return switchProject(openTab.history.present);
				const saved = await store.loadProject(projectId);
				if (!saved) throw new Error(copy.projectNotFound);
				return openProject(saved);
			},
			clearRecent: clearRecentProjects,
			openAudacityProject,
			openAup4,
			openScape,
			openScapeFile,
			inspectScape,
			saveAup4,
			saveScape,
			saveAs: saveScape,
			dismissAup4CompatibilitySummary,
			close: closeProjectTab,
			openById: async (projectId: RuntimeValue) => {
				const openTab = sessionTab(projectId);
				if (openTab) return switchProject(openTab.history.present);
				const saved = await store.loadProject(projectId);
				if (!saved) throw new Error(copy.projectNotFound);
				return openProject(saved);
			},
			list: listProjects,
			save: saveNow,
			flush: flushProject,
			prepareHandoff: prepareProjectHandoff,
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
			relinkLinkedAudio,
			canRelinkLinkedVideo,
			classifyLinkedVideoRelink,
			relinkLinkedVideo,
			playPause: playPauseProjectBinClip,
			stopPreview: stopProjectBinPreview,
			getVisualData: getProjectBinClipVisualData,
		}),
		video: Object.freeze({
			getClipVisualData,
			getSourceVisualData: getVideoSourceVisualData,
			releaseSourceVisual: releaseVideoSourceVisual,
			export: exportVideo,
			trim: createVideoTrimActionFacade({
				videoCompositing: capabilities.videoCompositing, productName: product.name, services: videoTrimServices,
			}),
			navigation: Object.freeze({
				view: restricted('videoCompositing', () => videoNavigationService.view()),
				shuttleBackward: restricted('videoCompositing', () => reportVideoShuttle(videoNavigationService.shuttleReverse)),
				shuttleStop: restricted('videoCompositing', () => reportVideoShuttle(videoNavigationService.shuttleStop)),
				shuttleForward: restricted('videoCompositing', () => reportVideoShuttle(videoNavigationService.shuttleForward)),
				previousEdit: restricted('videoCompositing', () => navigateVideoEdit('previous')),
				nextEdit: restricted('videoCompositing', () => navigateVideoEdit('next')),
			}),
			effects: Object.freeze({
				add: restricted('videoEffects', addVideoClipEffect),
				update: restricted('videoEffects', updateVideoClipEffect),
				bypass: restricted('videoEffects', bypassVideoClipEffect),
				toggle: restricted('videoEffects', toggleVideoClipEffect),
				reorder: restricted('videoEffects', reorderVideoClipEffect),
				remove: restricted('videoEffects', removeVideoClipEffect),
				beginGesture: restricted('videoEffects', beginVideoEffectGesture),
				preview: restricted('videoEffects', previewVideoEffectGesture),
				commit: restricted('videoEffects', commitVideoEffectGesture),
				cancel: restricted('videoEffects', cancelVideoEffectGesture),
			}),
			// Three-point editing from the Project Bin into the targeted lanes.
			targets: (sequenceId: RuntimeValue) => videoEditService.targets(sequenceId),
			toggleTarget: (trackId: RuntimeValue, sequenceId: RuntimeValue) => (
				videoEditService.toggleTarget(trackId, sequenceId)
			),
			clearTargets: () => videoEditService.clearTargets(),
			insert: (request: RuntimeValue) => videoEditService.insert(request),
			overwrite: (request: RuntimeValue) => videoEditService.overwrite(request),
			// Replace and match-frame are both defined against the frame under the
			// program playhead.
			replace: (request: RuntimeValue) => videoEditService.replace(request),
			matchFrame: (request: RuntimeValue) => videoEditService.matchFrame(request),
			// One video source open on its own frame grid: the marks an edit reads
			// come from here, and nothing about it is persisted.
			sourceMonitor: Object.freeze({
				view: () => sourceMonitorService.view(),
				open: (binItemId: RuntimeValue, options: RuntimeValue) => (
					sourceMonitorService.open(binItemId, options)
				),
				close: () => sourceMonitorService.close(),
				seek: (frame: RuntimeValue) => sourceMonitorService.seek(frame),
				step: (frameDelta: RuntimeValue) => sourceMonitorService.step(frameDelta),
				markIn: (frame: RuntimeValue) => sourceMonitorService.markIn(frame),
				markOut: (frame: RuntimeValue) => sourceMonitorService.markOut(frame),
				clearMarks: () => sourceMonitorService.clearMarks(),
			}),
			// Re-read an already-imported source: the same bytes, probed again by
			// the current build, with every edit cut against the old grid conformed.
			reprobeSource: (sourceId: RuntimeValue, options: RuntimeValue) => (
				videoSourceReprobeService.reprobe(sourceId, options)
			),
			link: (videoClipId: RuntimeValue, audioClipId: RuntimeValue) => commit({
				type: 'clip/link-av',
				videoClipId,
				audioClipId,
				avLinkId: createStableId('av-link'),
			}),
			unlink: (clipId: RuntimeValue) => commit({ type: 'clip/unlink-av', clipId }),
		}),
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
			zoomIn: () => updateZoom('in'),
			zoomOut: () => updateZoom('out'),
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
			setSampleFormat: restricted('audioEffects', setTrackSampleFormat),
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
		preferences: Object.freeze({
			update: recordingPreferences.update,
			revertFactorySettings: recordingPreferences.revertFactorySettings,
			setWorkspace: setWorkspacePreference,
			setTheme: (theme: RuntimeValue) => updatePreferences({ appearance: { theme } }),
			setClipStyle: (clipStyle: RuntimeValue) => updatePreferences({ appearance: { clipStyle } }),
			toggleToolbar: toggleToolbarPreference,
			moveToolbar: moveToolbarPreference,
			setToolbarButton: setToolbarButtonPreference,
			togglePanel: togglePanelPreference,
			setPanel: setPanelPreference,
			movePanel: movePanelPreference,
			setShortcut: setShortcutPreference,
			resetShortcuts: () => updatePreferences({ shortcuts: AUDIO_EDITOR_DEFAULT_SHORTCUTS }),
			createWorkspace: createWorkspacePreference,
			updateWorkspace: updateWorkspacePreference,
			deleteWorkspace: deleteWorkspacePreference,
		}),
		clip: Object.freeze({
			update: (clipId: RuntimeValue, changes: RuntimeValue) => commit({ type: 'clip/update', clipId, changes }, { selectClipId: clipId }),
			setTimePitch: restricted('audioEffects', setClipTimePitch),
			stretch: restricted('audioEffects', stretchClip),
			toggleStretchToTempo: restricted('audioEffects', toggleStretchToTempo),
			resetPitchSpeed: restricted('audioEffects', resetClipPitchSpeed),
			renderPitchSpeed: restricted('audioEffects', renderClipPitchSpeed),
			move: moveClips,
			moveToNewTrack: moveClipsToNewTrack,
			trim: trimClips,
			overwrite: overwriteClips,
			remove: (clipId: RuntimeValue) => commit({ type: 'clip/remove', clipId }),
			reverse: restricted('audioEffects', (clipId: RuntimeValue) => handleClipAction('reverse', clipId)),
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
			presets: Object.freeze({
				list: (effectType: RuntimeValue = state.audacityEffectType) => listAudioEditorEffectPresets(state.effectPresets, effectType),
				apply: restricted('audioEffects', applyEffectPreset),
				save: restricted('audioEffects', saveEffectPreset),
				saveAs: restricted('audioEffects', (name: RuntimeValue, params: RuntimeValue = currentAudacityEffectParams()) => saveEffectPreset({ name, params })),
				delete: restricted('audioEffects', deleteEffectPreset),
				import: restricted('audioEffects', importEffectPresets),
				export: restricted('audioEffects', exportEffectPreset),
			}),
		}),
		macros: Object.freeze({
			run: restricted('audioMacros', runEffectMacro),
		}),
		analysis: Object.freeze({
			run: restricted('audioAnalysis', analysisService.run),
			plotSpectrum: restricted('audioAnalysis', analysisService.plotSpectrum),
			findClipping: restricted('audioAnalysis', analysisService.findClipping),
			contrast: restricted('audioAnalysis', analysisService.captureContrast), repeatLast: restricted('audioAnalysis', analysisService.repeatLast),
		}),
		export: Object.freeze({
			start: (settings: RuntimeValue) => handleExportAction('start', settings),
			cancel: () => handleExportAction('cancel'),
		}),
	});
}
