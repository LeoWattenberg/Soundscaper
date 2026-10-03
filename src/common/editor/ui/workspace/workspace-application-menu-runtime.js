import { createWorkspaceSelectionViewMenuPorts } from './selection-view-menu-ports.ts';
import { assistanceDialogSurface } from '../assistance-task-catalog.ts';
import { otherProductId, productProfile } from '../../../products.js';
import { applicationInstallPromptCapture } from '../../../offline/install-prompt.ts';
import { documentationUrl } from '../../documentation-links.ts';
import { desktopDownloadUrl } from '../../desktop-download-links.ts';
import { INSTALL_APPLICATION_MENU_ITEM_ID } from '../install-application-menu.ts';
import { moveAudioEditorTrackBlock, trackSourceRate } from '../application-menu-model.js';
import createApplicationMenus from '../application-menus.js';
import { createDesktopHostMenuItems } from '../desktop-host-menu.ts';
import { createVideoTrimApplicationMenuActions } from './video-trim-application-menu-actions.ts';
import { createParallelStackMenuRuntime } from './parallel-stack-menu-runtime.ts';
import {
	createProductWorkspaceApplicationMenuRuntime,
	useProductNativeServicesMenuRefresh,
} from './workspace-product-application-menu-runtime.ts';
import { resolveSoundscaperNativeServicesWorkspaceRuntime,
	useSoundscaperNativeServicesMenuRefresh } from './SoundscaperNativeServicesSurface.tsx';

export {
	useProductNativeServicesMenuRefresh as useFramescaperNativeServicesMenuRefresh,
	useSoundscaperNativeServicesMenuRefresh,
};

export function createWorkspaceApplicationMenus({
		aboutLabel,
		aup4InputRef,
		blocked,
		capabilities,
		compactLayout = false,
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
		locale,
		openDesktopFiles,
		openEffects,
		openAssistanceSearch = undefined,
		openExternal,
		openGenerator,
		openProjects,
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
		soundscaperWorkflow = undefined,
		snapshot,
		toggleFullscreen,
		toggleRecording,
		toggleWorkspacePanel,
		uiFlags,
		zoomProject,
}) {
	const soundscaperNativeServices = resolveSoundscaperNativeServicesWorkspaceRuntime({
		productId, copy, engine: controller?.engine, controller, durationFrames,
		selectedTrackId: snapshot.selectedTrackId ?? null,
		selectedClipId: snapshot.selectedClipId ?? null,
		processingBlocked: editBlocked || snapshot.readOnly === true,
	});
	const framescaperRuntime = createProductWorkspaceApplicationMenuRuntime({
		controller,
		productId,
		copy,
		project,
		projectCapabilities: capabilities,
		editingBlocked: editBlocked,
		readOnly: snapshot.readOnly === true,
		run,
		openSurface,
	});
	// The browser hands over its install offer whenever it decides the app is
	// installable, which is long after the first menus were built, so the Help
	// entry reads the shared capture at menu-open time instead of a snapshot.
	const installPrompt = applicationInstallPromptCapture();
	const desktopHost = createDesktopHostMenuItems(fileService.isDesktop !== true
		|| desktopHostRuntime === null || desktopHostRuntime === undefined ? null : {
		...desktopHostRuntime,
		copy,
		productId,
		productName: copy.title,
		...((typeof __SCAPE_DESKTOP_RENDERER__ === 'undefined' || __SCAPE_DESKTOP_RENDERER__) ? {
			openMcpConnection: productId === 'soundscaper'
				&& typeof fileService.readMcpStatus === 'function'
				&& typeof fileService.startMcp === 'function'
				&& typeof fileService.stopMcp === 'function'
				? () => openSurface('desktop-mcp') : undefined,
		} : {}),
	});
	const { selectionMenu, viewMenu } = createWorkspaceSelectionViewMenuPorts({
		controller, parityRuntime, snapshot, run, zoomProject, setShowArmControls, toggleWorkspacePanel, openSurface,
	});
	const menus = createApplicationMenus({
			selectionMenu, viewMenu,
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
			compactLayout,
			actionRuntime: parityRuntime.actions,
			actions: {
				openDiagnostics: () => openSurface('local-diagnostics'),
				installAvailable: () => installPrompt.available(),
				installApplication: () => run(() => installPrompt.prompt()),
				downloadDesktop: fileService.isDesktop ? undefined : () => openExternal(desktopDownloadUrl(productId)),
				openLocalModels: fileService.isDesktop ? () => openSurface('local-models') : undefined,
				openLocalAssistance: fileService.isDesktop ? (request = { mode: 'advanced' }) => openSurface(assistanceDialogSurface(request)) : undefined,
				openTextToSpeech: fileService.isDesktop ? () => openSurface('text-to-speech') : undefined,
				openLocalAssistanceIndexedSearch: fileService.isDesktop && project
					? openAssistanceSearch : undefined,
				framescaperCandidateAuthoring: framescaperRuntime.framescaperCandidateAuthoring,
				openFramescaperFinishing: framescaperRuntime.openFramescaperFinishing,
				framescaperNativeServices: framescaperRuntime.framescaperNativeServices,
				soundscaperWorkflow,
				soundscaperNativeServices,
				parallelStackProcessing: createParallelStackMenuRuntime({
					productId, desktop: fileService.isDesktop === true, controller, run,
					recording: Boolean(snapshot.recording || snapshot.recordingScheduling || snapshot.scheduledRecording),
				}),
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
				switchProject: (projectId) => run(() => controller.actions.project.openById(projectId)),
				clearRecentProjects: () => run(() => controller.actions.project.clearRecent()),
				closeProject: () => run(() => controller.actions.project.close()),
				claimProjectLock: () => run(() => controller.actions.project.claimLock()),
				saveDawproject: () => run(() => controller.actions.project.saveDawproject()),
				saveProject: () => run(() => controller.actions.project.save()),
				saveScape: () => run(() => controller.actions.project.saveScape({ saveCopy: snapshot.readOnly })),
				saveAup3: () => run(() => controller.actions.project.saveAup3({ saveCopy: snapshot.readOnly })),
				saveAup4: () => run(() => controller.actions.project.saveAup4({ saveCopy: snapshot.readOnly })),
				openDeliveryReport: () => setDialog('delivery-report'),
				importFiles: () => fileService.isDesktop
					? run(() => openDesktopFiles('media', true, { destination: 'timeline' }))
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
					const {
						createCrossProductHandoffLaunchIntent,
						serializeCrossProductHandoffLaunchIntent,
					} = await import('../../../cross-product-handoff-intent.ts');
					const destination = otherProductId(productId);
					const intent = createCrossProductHandoffLaunchIntent({
						sourceProject: project, destinationFamily: destination,
					});
					if (fileService.isDesktop) {
						await controller.actions.project.saveCrossProductCopy(intent);
						return;
					}
					const prepared = await controller.actions.project.prepareHandoff({
						projectId: intent.source.projectId,
						revision: intent.sourceRevision,
					});
					if (prepared?.projectId !== intent.source.projectId
						|| prepared.revision !== intent.sourceRevision) {
						throw new Error('The project changed while preparing its editable-copy handoff. Try again.');
					}
					globalThis.location.assign(`/transfer/send/?${serializeCrossProductHandoffLaunchIntent(intent)}`);
				}),
				...(fileService.isDesktop ? {
					cancelCrossProductCopy: () => run(() => (
						controller.actions.project.cancelCrossProductCopy()
					)),
					crossProductCopyActive: () => (
						controller.actions.project.crossProductCopyActive()
					),
				} : {}),
				executeEdit,
				addLabel: () => run(() => parityRuntime.actions.labels.add()),
				openLabels: () => openWorkspacePanel('labels'),
				openMetadata: () => openWorkspacePanel('metadata'),
				openClipProperties: () => openSurface('clip'),
				openPreferences: () => openSurface('preferences'),
				toggleLoop: () => run(() => controller.actions.transport.toggleLoop()),
				clearLoop: () => run(() => controller.actions.transport.clearLoop()),
				loopToSelection: () => run(() => controller.actions.transport.loopToSelection()),
				selectionToLoop: () => run(() => controller.actions.transport.selectionToLoop()),
				setLoopInOut: () => run(() => controller.actions.transport.setLoopInOut()),
				toggleSelectionFollowsLoop: () => run(() => controller.actions.transport.toggleSelectionFollowsLoop()),
				fullscreen: () => run(toggleFullscreen),
				record: toggleRecording,
				recordNewTrack: () => run(() => controller.actions.recording.startNewTrack()),
				pauseRecording: () => run(() => controller.actions.recording.pause()),
				openTimedRecording,
				toggleLeadIn: () => run(() => controller.actions.recording.toggleLeadIn()),
				toggleMetronome: () => run(() => controller.actions.transport.toggleMetronome()),
				stop: () => run(() => controller.actions.transport.stop()),
				playPause: () => run(() => controller.actions.transport.playPause()),
				playSelection: () => run(() => controller.actions.transport.playSelection()),
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
				setTrackDisplay: (mode) => snapshot.selectedTrackId && run(() => controller.actions.track.setDisplayMode(snapshot.selectedTrackId, mode)),
				setTrackRate: (sampleRate) => snapshot.selectedTrackId && run(() => controller.actions.track.setRate(snapshot.selectedTrackId, sampleRate)),
				mixAndRender: () => openSurface('mix-render'),
				openTrackRate: () => openTrackRate(selectedAudioTrack),
				openResample: () => {
					setDialogValue(String(trackSourceRate(project, selectedAudioTrack, project?.sampleRate || 48_000)));
					setDialog('resample');
				},
				openEffects: () => openEffects(snapshot.selectedTrackId),
				openMacrosPalette: () => openSurface('macros-palette'),
				runMacro: (macro) => run(() => controller.actions.macros.run(macro)),
				openSelectionEffect: (type) => snapshot.effects?.selectionTypes
					.find((candidate) => candidate.type === type)?.hasSettings === false
					? run(() => controller.actions.effects.applySelection({ type }))
					: openSelectionEffect(type),
				repeatLastEffect: () => run(() => controller.actions.effects.repeatLast()),
				openSpectralSelection,
				deleteSpectralSelection: () => run(() => controller.actions.spectral.delete()),
				amplifySpectralSelection: () => openSpectralSelection(),
				openGenerator,
				openNyquist: (pluginId = null) => {
					setNyquistTarget({ prompt: !pluginId, pluginId });
					openSurface('nyquist');
				},
				openAnalysis: (mode = 'levels') => openSurface(`offline-analysis-${mode}`),
				openRepeatAnalyzer: () => openSurface('offline-analysis-repeat'),
				measureLoudness: () => run(async () => {
					const report = await controller.actions.analysis.measureLoudness();
					if (report) setDialog('delivery-report');
				}),
					manual: () => openExternal(documentationUrl(productId, 'manual', locale)),
					tutorials: () => openExternal(documentationUrl(productId, 'tutorials', locale)),
					privacyPolicy: () => openSurface('privacy-policy'),
					support: () => openExternal(`mailto:team@mindscaper.org?subject=${encodeURIComponent(`${productProfile(productId).name} support`)}`),
					revertFactorySettings: () => parityRuntime.actions.help.revertFactorySettings(),
					toggleStoragePanel: () => parityRuntime.actions.help.toggleStoragePanel(),
					about: () => setDialog('about'),
				},
		});
	return fileService.isDesktop ? withoutInstallApplicationEntry(menus) : menus;
}

/**
 * Help without the install entry, for a build that is already installed.
 *
 * `beforeinstallprompt` is a browser event that Electron never fires, so the
 * shared entry would sit in the desktop Help menu greyed for good, explaining
 * that the browser has not offered to install an application the person is
 * running from their own machine. In a browser the entry stays visible and
 * disabled, because there the explanation is true and a row that vanishes is
 * harder to find again than one that is plainly unavailable.
 */
function withoutInstallApplicationEntry(menus) {
	return menus.map((menu) => (menu.id !== 'help' ? menu : {
		...menu,
		items: menu.items.filter((item) => item.id !== INSTALL_APPLICATION_MENU_ITEM_ID),
	}));
}
