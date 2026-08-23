import { otherProductId, productLocalePath } from '../../../products.js';
import { documentationUrl } from '../../documentation-links.ts';

import { moveAudioEditorTrackBlock, trackSourceRate } from '../application-menu-model.js';
import createApplicationMenus from '../application-menus.js';
import { createDesktopHostMenuItems } from '../desktop-host-menu.ts';
import { framescaperNativeProjectActionRuntimeFor } from '../framescaper-native-project-actions.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../framescaper-candidate-authoring-actions.ts';
import { framescaperV27FinishingSurfaceId } from '../framescaper-v27-finishing-menu.ts';
import { createVideoTrimApplicationMenuActions } from './video-trim-application-menu-actions.ts';
import {
	resolveFramescaperNativeServicesWorkspaceRuntime,
	useFramescaperNativeServicesMenuRefresh,
	wrapFramescaperNativeServicesMenuRuntime,
} from './FramescaperNativeServicesSurface.tsx';
import {
	resolveSoundscaperNativeServicesWorkspaceRuntime,
	useSoundscaperNativeServicesMenuRefresh,
} from './SoundscaperNativeServicesSurface.tsx';
import { ANALYSIS_MODE_PANEL_IDS } from './workspace-panel-model.ts';

export { useFramescaperNativeServicesMenuRefresh, useSoundscaperNativeServicesMenuRefresh };

export function createWorkspaceApplicationMenus({
		aboutLabel,
		aup4InputRef,
		blocked,
		capabilities,
		controller,
		copy,
		crossProductHandoffAvailable = false,
		desktopHostRuntime,
		durationFrames,
		editBlocked,
		handoffBlocked,
		executeEdit,
		fileService,
		importInputRef,
		legacyAupInputRef,
		locale,
		openDesktopFiles,
		openEffects,
		openExternal,
		openGenerator,
		openProjects,
		openRecordingOffset,
		openSelectionEffect,
		openSpectralSelection,
		openSurface,
		openTimedRecording,
		openTrackRate = () => undefined,
		openWorkspacePanel,
		parityRuntime,
		productId,
		project,
		projectBinEffectivelyOpen,
		recordLabel,
		run,
		selectedClip,
		selectedAudioTrack,
		selectionActive,
		setDialog,
		setDialogValue,
		setNyquistTarget,
		setShowArmControls,
		showArmControls,
		soundscaperProduction,
		snapshot,
		toggleFullscreen,
		toggleRecording,
		toggleWorkspacePanel,
		uiFlags,
		zoomProject,
}) {
	const soundscaperNativeServices = resolveSoundscaperNativeServicesWorkspaceRuntime({ productId, copy });
	const framescaperNativeServicesRuntime = resolveFramescaperNativeServicesWorkspaceRuntime({
		productId, copy, project, projectCapabilities: capabilities,
		projectActions: framescaperNativeProjectActionRuntimeFor(controller),
	});
	const framescaperNativeServices = wrapFramescaperNativeServicesMenuRuntime(
		framescaperNativeServicesRuntime, run,
	);
	const candidateAuthoringRuntime = framescaperCandidateAuthoringActionRuntimeFor(controller);
	const framescaperCandidateAuthoring = candidateAuthoringRuntime === null ? null : Object.freeze({
		surfaces: candidateAuthoringRuntime.surfaces,
		open: (surface) => run(() => candidateAuthoringRuntime.run(surface)),
	});
	const desktopHost = createDesktopHostMenuItems(fileService.isDesktop !== true
		|| desktopHostRuntime === null || desktopHostRuntime === undefined ? null : {
		...desktopHostRuntime,
		copy,
		productName: copy.title,
	});
	return createApplicationMenus({
			productId,
			aboutLabel,
			capabilities,
			crossProductHandoffAvailable,
			locale,
		copy,
		desktopHost,
			project,
			snapshot,
			blocked,
			editBlocked,
			showArmControls,
			recordLabel,
			selectionActive,
			selectedClip,
			durationFrames,
			handoffBlocked,
			effectsPanelOpen: Boolean(snapshot.preferences?.workspace?.panels?.effects?.visible),
			projectBinEffectivelyOpen,
			uiFlags,
			actionRuntime: parityRuntime.actions,
			actions: {
				framescaperCandidateAuthoring,
				openFramescaperV27Finishing: (surface) => openSurface(
					framescaperV27FinishingSurfaceId(surface),
				),
				framescaperNativeServices,
				soundscaperProduction,
				soundscaperNativeServices,
				executeMulticameraCommand: (command) => run(() => {
					switch (command?.type) {
						case 'multicamera/create':
							return controller.actions.sequences.createMulticamera(
								command.projectId, command.expectedProjectRevision, command.group,
							);
						case 'multicamera/update':
							return controller.actions.sequences.updateMulticamera(
								command.projectId, command.expectedProjectRevision, command.groupId,
								command.expectedActiveMemberId, command.group,
							);
						case 'multicamera/switch':
							return controller.actions.sequences.switchMulticamera(
								command.projectId, command.expectedProjectRevision, command.groupId,
								command.expectedActiveMemberId, command.memberId,
							);
						case 'multicamera/remove':
							return controller.actions.sequences.removeMulticamera(
								command.projectId, command.expectedProjectRevision, command.groupId,
								command.expectedActiveMemberId,
							);
						default:
							throw new TypeError('The multicamera menu command is unsupported.');
					}
				}),
				executeNestedSequenceCommand: (command) => run(() => {
					switch (command?.type) {
						case 'sequence/create':
							return controller.actions.sequences.createSequence(command.sequence);
						case 'sequence/delete':
							return controller.actions.sequences.deleteSequence(command.sequenceId);
						case 'subsequence/add':
							return controller.actions.sequences.addNested(command.subsequence);
						case 'subsequence/update':
							return controller.actions.sequences.updateNested(command.subsequenceId, command.changes);
						case 'subsequence/remove':
							return controller.actions.sequences.removeNested(command.subsequenceId);
						default:
							throw new TypeError('The nested-sequence menu command is unsupported.');
					}
				}),
				openAudioWarp: () => openSurface('audio-warp'),
				openVideoComposition: () => openSurface('video-composition'),
				openVideoKeyframes: () => openSurface('video-keyframes'),
				openVideoRetime: () => openSurface('video-retime'),
				openVideoProxy: () => openSurface('video-proxy'),
				openTakeComp: () => openSurface('take-comp'),
				newProject: () => run(() => controller.actions.project.create()),
				openProjects,
				openFile: () => fileService.isDesktop
					? run(() => openDesktopFiles('project'))
					: aup4InputRef.current?.click(),
				openRecentProject: (projectId) => run(() => controller.actions.project.openRecent(projectId)),
				clearRecentProjects: () => run(() => controller.actions.project.clearRecent()),
				closeProject: () => run(() => controller.actions.project.close()),
				openAup4: () => fileService.isDesktop
					? run(() => openDesktopFiles('project'))
					: aup4InputRef.current?.click(),
				openLegacyAup: () => legacyAupInputRef.current?.click(),
				saveProject: () => run(() => controller.actions.project.save()),
				saveScape: () => run(() => controller.actions.project.saveScape({ saveCopy: snapshot.readOnly })),
				saveAup4: () => run(() => controller.actions.project.saveAup4({ saveCopy: snapshot.readOnly })),
				openAup4CompatibilityReport: () => setDialog('aup4-compatibility'),
				openDeliveryReport: () => setDialog('delivery-report'),
				importFiles: () => fileService.isDesktop
					? run(() => openDesktopFiles('media', true))
					: importInputRef.current?.click(),
				exportAudio: () => openSurface('export'),
				openDeliveryQueue: () => openSurface('delivery-queue'),
				exportLabels: () => openSurface('label-export'),
				exportEdl: () => run(() => controller.actions.export.exportEdl()),
				exportOtio: () => run(() => controller.actions.export.exportOtio()),
				exportFcpxml: () => run(() => controller.actions.export.exportFcpxml()),
				consolidateMedia: () => run(() => controller.actions.media.consolidate()),
				trimMedia: () => run(() => controller.actions.media.trim()),
				saveArchiveManifest: () => run(() => controller.actions.media.saveArchiveManifest()),
				renameProject: () => { setDialogValue(project?.title || ''); setDialog('rename'); },
				duplicateProject: () => run(() => controller.actions.project.duplicate()),
				deleteProject: () => setDialog('delete'),
				clearData: () => setDialog('clear'),
				switchProduct: () => run(async () => {
					const handoff = await controller.actions.project.prepareHandoff();
					const destination = otherProductId(productId);
					globalThis.location.assign(`${productLocalePath(destination, locale)}?project=${encodeURIComponent(handoff.projectId)}`);
				}),
				executeEdit,
				openLabels: () => openWorkspacePanel('labels'),
				openMetadata: () => openWorkspacePanel('metadata'),
				openClipProperties: () => openSurface('clip'),
				openPreferences: () => openSurface('preferences'),
				selectAll: () => run(() => controller.actions.timeline.setSelection(0, durationFrames)),
				selectNone: () => run(() => controller.actions.timeline.clearSelection()),
				selectAllTracks: () => run(() => controller.actions.timeline.selectAllTracks()),
				selectNoTracks: () => run(() => controller.actions.timeline.selectNoTracks()),
				selectPreviousClipBoundaryToCursor: () => run(() => controller.actions.timeline.selectPreviousClipBoundaryToCursor()),
				selectCursorToNextClipBoundary: () => run(() => controller.actions.timeline.selectCursorToNextClipBoundary()),
				selectPreviousClip: () => run(() => controller.actions.timeline.selectPreviousClip()),
				selectNextClip: () => run(() => controller.actions.timeline.selectNextClip()),
				skipToSelectionStart: () => run(() => controller.actions.timeline.skipToSelectionStart()),
				skipToSelectionEnd: () => run(() => controller.actions.timeline.skipToSelectionEnd()),
				selectLeftOfPlayback: () => run(() => controller.actions.timeline.selectLeftOfPlayback()),
				selectRightOfPlayback: () => run(() => controller.actions.timeline.selectRightOfPlayback()),
				selectTrackStartToCursor: () => run(() => controller.actions.timeline.selectTrackStartToCursor()),
				selectCursorToTrackEnd: () => run(() => controller.actions.timeline.selectCursorToTrackEnd()),
				selectTrackStartToEnd: () => run(() => controller.actions.timeline.selectTrackStartToEnd()),
				toggleLoop: () => run(() => controller.actions.transport.toggleLoop()),
				clearLoop: () => run(() => controller.actions.transport.clearLoop()),
				loopToSelection: () => run(() => controller.actions.transport.loopToSelection()),
				selectionToLoop: () => run(() => controller.actions.transport.selectionToLoop()),
				setLoopInOut: () => run(() => controller.actions.transport.setLoopInOut()),
				toggleSelectionFollowsLoop: () => run(() => controller.actions.transport.toggleSelectionFollowsLoop()),
				setTimelineView: (view) => run(() => controller.actions.timeline.setView(view)),
				toggleRms: () => run(() => controller.actions.timeline.toggleRms()),
				toggleVerticalRulers: () => run(() => controller.actions.timeline.toggleVerticalRulers()),
				toggleUpdateWhilePlaying: () => run(() => controller.actions.timeline.toggleUpdateWhilePlaying()),
				togglePinnedPlayhead: () => run(() => controller.actions.timeline.togglePinnedPlayhead()),
				toggleRulerPlayback: () => run(() => controller.actions.timeline.toggleRulerPlayback()),
					setSnap: (settings) => run(() => controller.actions.timeline.setSnap(settings)),
				zoomIn: () => zoomProject('in', 'playhead'),
				zoomOut: () => zoomProject('out', 'playhead'),
				zoomDefault: () => run(() => parityRuntime.actions.timeline.zoomDefault()),
				zoomSelection: () => run(() => parityRuntime.actions.timeline.zoomSelection()),
				zoomToggle: () => run(() => parityRuntime.actions.timeline.zoomToggle()),
				zoomFit: () => run(() => controller.actions.timeline.zoomFit()),
				fitHeight: () => run(() => controller.actions.timeline.fitHeight()),
				centerOnPlayhead: () => run(() => parityRuntime.actions.timeline.centerOnPlayhead()),
				fullscreen: () => run(toggleFullscreen),
				record: toggleRecording,
				recordNewTrack: () => run(() => controller.actions.recording.startNewTrack()),
				pauseRecording: () => run(() => controller.actions.recording.pause()),
				openTimedRecording,
				toggleLeadIn: () => run(() => controller.actions.recording.toggleLeadIn()),
				toggleMetronome: () => run(() => controller.actions.transport.toggleMetronome()),
				toggleArmControls: () => setShowArmControls((current) => !current),
				toggleMarkers: () => run(() => controller.actions.preferences.update({
					view: { showMarkers: !snapshot.preferences?.view?.showMarkers },
				})),
				stop: () => run(() => controller.actions.transport.stop()),
				playPause: () => run(() => controller.actions.transport.playPause()),
				playAtSpeed: () => run(() => controller.actions.transport.playAtSpeed()),
				previousVideoEdit: () => run(() => controller.actions.video.navigation.previousEdit()),
				shuttleBackward: () => run(() => controller.actions.video.navigation.shuttleBackward()),
				shuttleStop: () => run(() => controller.actions.video.navigation.shuttleStop()),
				shuttleForward: () => run(() => controller.actions.video.navigation.shuttleForward()),
				nextVideoEdit: () => run(() => controller.actions.video.navigation.nextEdit()),
				...createVideoTrimApplicationMenuActions(controller, run),
				linkVideoAudio: (videoClipId, audioClipId) => run(() => controller.actions.video.link(videoClipId, audioClipId)),
				unlinkVideoAudio: (clipId) => run(() => controller.actions.video.unlink(clipId)),
				setVideoHidden: (trackId, hidden) => run(() => controller.actions.track.update(trackId, { hidden })),
				setTrackLocked: (trackId, locked) => run(() => controller.actions.track.update(trackId, { locked })),
				toggleMonitoring: () => run(() => controller.actions.recording.setMonitoring(!snapshot.monitor?.enabled)),
				requestInputAccess: () => run(() => controller.actions.recording.requestInputAccess()),
				refreshInputs: () => run(() => controller.actions.recording.refreshInputs()),
				releaseInputs: () => run(() => controller.actions.recording.releaseInputs()),
				openRecordingOffset,
				addTrack: () => run(() => controller.actions.track.add()),
				addAudioTrack: () => run(() => controller.actions.track.add()),
				addMonoTrack: () => run(() => controller.actions.track.addMono()),
				addStereoTrack: () => run(() => controller.actions.track.addStereo()),
				addLabelTrack: () => run(() => controller.actions.track.addLabel()),
				duplicateTrack: () => snapshot.selectedTrackId && run(() => controller.actions.track.duplicate(snapshot.selectedTrackId)),
				removeTrack: () => snapshot.selectedTrackId && run(() => controller.actions.track.remove(snapshot.selectedTrackId)),
				moveTrackUp: () => snapshot.selectedTrackId && run(() => moveAudioEditorTrackBlock(
					controller,
					project?.tracks || [],
					snapshot.selectedTrackId,
					'up',
				)),
				moveTrackDown: () => snapshot.selectedTrackId && run(() => moveAudioEditorTrackBlock(
					controller,
					project?.tracks || [],
					snapshot.selectedTrackId,
					'down',
				)),
				moveTrackTop: () => snapshot.selectedTrackId && run(() => moveAudioEditorTrackBlock(
					controller,
					project?.tracks || [],
					snapshot.selectedTrackId,
					'top',
				)),
				moveTrackBottom: () => snapshot.selectedTrackId && run(() => moveAudioEditorTrackBlock(
					controller,
					project?.tracks || [],
					snapshot.selectedTrackId,
					'bottom',
				)),
				makeStereoTrack: () => run(() => controller.actions.track.makeStereo(snapshot.selectedTrackId)),
				swapTrackChannels: () => run(() => controller.actions.track.swapChannels(snapshot.selectedTrackId)),
				splitStereoLr: () => run(() => controller.actions.track.splitStereoLR(snapshot.selectedTrackId)),
				splitStereoCenter: () => run(() => controller.actions.track.splitStereoCenter(snapshot.selectedTrackId)),
				decreaseAllTrackHeights: () => run(() => controller.actions.track.decreaseAllHeights()),
				increaseAllTrackHeights: () => run(() => controller.actions.track.increaseAllHeights()),
				setTrackDisplay: (mode) => snapshot.selectedTrackId && run(() => controller.actions.track.setDisplayMode(snapshot.selectedTrackId, mode)),
				setTrackRate: (sampleRate) => snapshot.selectedTrackId && run(() => controller.actions.track.setRate(snapshot.selectedTrackId, sampleRate)),
				setTrackSampleFormat: (sampleFormat) => snapshot.selectedTrackId && run(() => controller.actions.track.setSampleFormat(snapshot.selectedTrackId, sampleFormat)),
				mixAndRender: () => run(() => controller.actions.track.mixAndRender()),
				openTrackRate: () => openTrackRate(selectedAudioTrack),
				openResample: () => {
					setDialogValue(String(trackSourceRate(project, selectedAudioTrack, project?.sampleRate || 48_000)));
					setDialog('resample');
				},
					zeroCross: () => run(() => controller.actions.timeline.zeroCross()),
				toggleTrackMute: () => {
					const track = project?.tracks.find((candidate) => candidate.id === snapshot.selectedTrackId);
					if (track) run(() => controller.actions.track.update(track.id, { mute: !track.mute }));
				},
				openEffects: () => openEffects(snapshot.selectedTrackId),
				openMacroManager: () => openSurface('macro-manager'),
				openSelectionEffect,
				repeatLastEffect: () => run(() => controller.actions.effects.repeatLast()),
				openSpectralSelection,
				deleteSpectralSelection: () => run(() => controller.actions.spectral.delete()),
				amplifySpectralSelection: () => openSpectralSelection(),
				openGenerator,
				openNyquist: (pluginId = null) => {
					setNyquistTarget({ prompt: !pluginId, pluginId });
					openSurface('nyquist');
				},
				openAnalysis: (mode = 'levels') => {
					openWorkspacePanel(ANALYSIS_MODE_PANEL_IDS[mode] || 'analysis');
				},
				measureLoudness: () => run(() => controller.actions.analysis.measureLoudness()),
					openEbuR128: () => openWorkspacePanel('ebu-r128'),
					setWorkspace: (workspaceId) => run(() => controller.actions.preferences.setWorkspace(workspaceId)),
					togglePanel: toggleWorkspacePanel,
					manual: () => openExternal(documentationUrl(productId, 'manual')),
					tutorials: () => openExternal(documentationUrl(productId, 'tutorials')),
					support: () => openExternal('mailto:team@kw.media?subject=Soundscaper%20support'),
					revertFactorySettings: () => parityRuntime.actions.help.revertFactorySettings(),
					toggleStoragePanel: () => parityRuntime.actions.help.toggleStoragePanel(),
					about: () => setDialog('about'),
				},
		});
}
