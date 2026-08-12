import { applyAudacityParityToMenus } from '../audacity-action-parity.js';
import { listNyquistPlugins } from '../nyquist/plugin-registry.js';
import {
	AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS,
} from './application-menu-registry.ts';
import {
	EFFECT_MENU_GROUPS,
	audioEditorTrackBlockBounds,
	createSnapMenu,
	trackSourceChannelCount,
	trackSources,
} from './application-menu-model.js';
import { timelineAnnotationsAvailable } from './timeline/timeline-annotation-ui-model.ts';
import {
	ANALYZER_PANEL_ID_SET,
	WORKSPACE_PANEL_IDS,
	workspacePanelLabel,
} from './workspace/workspace-panel-model.ts';
import { filterProductMenus } from './application-menu-product-filter.js';
import { createFramescaperEditControlMenuItems } from './framescaper-edit-control-menu-model.ts';
import { createFramescaperVideoTrimApplicationMenuItems } from './framescaper-video-trim-application-menu.ts';
import { createTrackLockMenuItems, createTrackLockMenuModel } from './track-lock-menu-model.ts';
import { createClipSelectionNavigationMenuModel } from './clip-selection-navigation-menu-model.ts';
import { createTrackStructuralOperationMenuModel } from './track-structural-operation-menu-model.ts';
import { createImportAnalysisToolMenuItems, createRepeatAnalyzerMenuItem, createRepeatGeneratorMenuItem } from './import-analysis-application-menu.ts';
import { createTakeCompApplicationMenuItems } from './take-comp-application-menu.ts';
import { createPitchAndTempoApplicationMenuItems } from './pitch-tempo-application-menu.ts';
export default function createApplicationMenus({
	productId,
	aboutLabel,
	capabilities,
	locale,
	copy,
	project,
	snapshot,
	blocked,
	editBlocked,
	handoffBlocked = editBlocked,
	showArmControls,
	selectionActive,
	selectedClip,
	durationFrames,
	effectsPanelOpen,
	projectBinEffectivelyOpen,
	uiFlags,
	actionRuntime,
	actions,
}) {
	const divider = () => ({ divider: true });
	const clipSelectionActive = Boolean(selectedClip || project?.selection?.clipIds?.some((clipId) => (
		project.clips.some((clip) => clip.id === clipId)
	)));
	const editSelectionActive = selectionActive || clipSelectionActive;
	const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId) || null;
	const selectedAudioTrack = selectedTrack?.type === 'audio' ? selectedTrack : null;
	const selectedTrackBlock = selectedTrack ? audioEditorTrackBlockBounds(project.tracks, selectedTrack.id) : null;
	const selectedAudioChannelCount = trackSourceChannelCount(project, selectedAudioTrack);
	const selectedAudioSources = trackSources(project, selectedAudioTrack);
	const selectedAudioSampleRates = new Set(selectedAudioSources.map((source) => source.sampleRate));
	const selectedAudioSampleFormats = new Set(selectedAudioSources.map((source) => source.sampleFormat));
	const selectedMixTrackIds = new Set((project?.selection?.trackIds || []).filter((trackId) => (
		project?.tracks.some((track) => track.id === trackId && track.type === 'audio')
	)));
	if (!selectedMixTrackIds.size && selectedAudioTrack) selectedMixTrackIds.add(selectedAudioTrack.id);
	const mixableAudioSelected = project?.tracks.some((track) => (
		track.type === 'audio' && selectedMixTrackIds.has(track.id) && track.clipIds.length
	));
	const compatibleMonoTracks = Boolean(selectedAudioChannelCount === 1 && project?.tracks.some((track) => (
		track.id !== selectedAudioTrack.id && track.type === 'audio' && trackSourceChannelCount(project, track) === 1
	)));
	const selectedClipIds = project?.selection?.clipIds?.length
		? project.selection.clipIds
		: selectedClip ? [selectedClip.id] : [];
	const splitAvailable = Boolean(
		selectedClipIds.some((clipId) => project?.clips.some((clip) => clip.id === clipId))
		|| selectedAudioTrack?.clipIds?.length
		|| project?.selection?.trackIds?.some((trackId) => (
			project.tracks.some((track) => track.id === trackId && track.type === 'audio' && track.clipIds.length)
		)),
	);
	const multipleSelectedClips = selectedClipIds.length > 1;
	const groupedSelectedClips = selectedClipIds.some((clipId) => project?.clips.find((clip) => clip.id === clipId)?.groupId);
	const frequencySelectionActive = Boolean(snapshot.selection?.frequencyRange);
	const spectralTrackSelected = Boolean(selectedAudioTrack && (
		selectedAudioTrack.displayMode === 'spectrogram'
		|| selectedAudioTrack.displayMode === 'multiview'
		|| snapshot.timeline?.view === 'spectrogram'
	));
	const labelTracks = project?.tracks.filter((track) => track.type === 'label') || [];
	const preferences = snapshot.preferences;
	const videoNavigation = snapshot.videoNavigation;
	const videoNavigationBlocked = blocked || !project || !videoNavigation || videoNavigation.programEndFrame <= 0;
	const shuttleLabel = (label, direction) => videoNavigation?.rate * direction > 0
		? `${label} (${Math.abs(videoNavigation.rate)}×)`
		: label;
	const framescaperEditControls = createFramescaperEditControlMenuItems({
		productId, project, selectedClipId: selectedClip?.id ?? null,
		selectedTrackId: snapshot.selectedTrackId ?? null, editBlocked,
		copy: { linkAudio: copy.linkAudio, unlinkAudio: copy.unlinkAudio, showVideo: copy.videoVisible, hideVideo: copy.videoHidden },
	}, { link: actions.linkVideoAudio, unlink: actions.unlinkVideoAudio, setVideoHidden: actions.setVideoHidden });
	const framescaperVideoTrimItems = createFramescaperVideoTrimApplicationMenuItems({
		productId, selectedClipId: selectedClip?.id ?? null, editingBlocked: editBlocked,
		copy, currentPlayheadSample: actions.currentVideoPlayheadSample,
	}, actions);
	const trackLock = createTrackLockMenuItems(createTrackLockMenuModel({ project, selectedTrackId: snapshot.selectedTrackId ?? null, editingBlocked: editBlocked,
		copy: { lockTrack: copy.lockTrack, unlockTrack: copy.unlockTrack },
	}), { setTrackLocked: actions.setTrackLocked });
	const clipSelectionNavigationMenus = createClipSelectionNavigationMenuModel({ project, selectedTrackId: snapshot.selectedTrackId ?? null, blocked, copy }, actions);
	const structuralMenus = createTrackStructuralOperationMenuModel({ copy, editingBlocked: editBlocked,
		hasTracks: Boolean(project?.tracks.length),
		hasAlignmentTarget: Boolean(selectedTrack || project?.selection?.trackIds?.length),
	});
	const analyzerBlocked = (blocked && !snapshot.analysisProcessing) || !project?.clips.length;
	const importAnalysisMenuContext = { productId, copy, snapshot, editBlocked, blocked, analyzerBlocked, actionRuntime };
	const effectLabels = new Map((snapshot.effects?.selectionTypes || []).map(({ type, label }) => [type, label]));
	const effectGroups = EFFECT_MENU_GROUPS.map(([labelKey, types]) => ({
		id: labelKey,
		label: copy[labelKey],
		items: types.filter((type) => effectLabels.has(type)).map((type) => ({
			id: type,
			label: effectLabels.get(type),
			disabled: editBlocked || !selectedAudioTrack,
			onClick: () => actions.openSelectionEffect(type),
		})),
	})).filter((group) => group.items.length);
	const nyquistPlugins = listNyquistPlugins();
	const nyquistDisabled = (plugin) => {
		if (plugin.category === 'legacy') return editBlocked || !selectedAudioTrack || (plugin.spectral && !frequencySelectionActive);
		if (plugin.category === 'generate') return editBlocked;
		if (plugin.category === 'analyze') return blocked || !selectedAudioTrack;
		return editBlocked || !selectedAudioTrack;
	};
	const nyquistItem = (plugin, disabled) => ({
		id: plugin.id,
		label: plugin.name,
		disabled,
		onClick: () => actions.openNyquist(plugin.id),
	});
	const nyquistItems = (category) => nyquistPlugins
		.filter((plugin) => plugin.category === category)
		.map((plugin) => nyquistItem(plugin, nyquistDisabled(plugin)));
	const menus = applyAudacityParityToMenus([
		{
			id: 'file',
			label: copy.fileMenu,
			items: [
				{ id: 'new-project', label: copy.newProject, shortcut: 'Ctrl+N', disabled: blocked, onClick: actions.newProject },
				{ id: 'open-project', label: copy.open, shortcut: 'Ctrl+O', disabled: blocked, onClick: actions.openFile },
				{
					id: 'audacity-projects',
					label: copy.audacityProjects,
					disabled: blocked,
					items: [
						{ id: 'open-aup4', label: copy.openAup4, disabled: blocked, onClick: actions.openAup4 },
						{ id: 'open-legacy-aup', label: copy.openLegacyAup, disabled: blocked, onClick: actions.openLegacyAup },
						...(productId === 'soundscaper' ? [{ id: 'save-project-as', label: copy.saveAsAup4, preserveLabel: true, disabled: blocked, onClick: actions.saveAup4 }] : []),
						{
							id: 'aup4-compatibility-report',
							label: copy.aup4CompatibilityReport,
							disabled: !snapshot.aup4Compatibility?.report,
							onClick: actions.openAup4CompatibilityReport,
						},
					],
				},
				{
					id: 'recent-projects',
					label: copy.recentProjects,
					disabled: blocked,
					items: [
						...(snapshot.recentProjects || []).map((recentProject) => ({
							id: `recent-project-${recentProject.id}`,
							label: recentProject.title,
							onClick: () => actions.openRecentProject(recentProject.id),
						})),
						...(snapshot.recentProjects?.length ? [divider()] : []),
						{ id: 'clear-recent', label: copy.clearRecentProjects, disabled: !snapshot.recentProjects?.length, onClick: actions.clearRecentProjects },
					],
				},
				{ id: 'local-projects', label: copy.projectsTitle, disabled: blocked, onClick: actions.openProjects },
				{ id: 'file-close', label: copy.closeProject, shortcut: 'Ctrl+W', disabled: blocked, onClick: actions.closeProject },
				divider(),
				{ id: 'save-project', label: copy.saveProject, shortcut: 'Ctrl+S', disabled: editBlocked, onClick: actions.saveProject },
				{
					id: 'save-scape', label: copy.saveScape, shortcut: 'Ctrl+Shift+S',
					resolve: () => ({ disabled: blocked && !snapshot.readOnly }),
					onClick: actions.saveScape,
				},
				{ id: 'switch-product', label: productId === 'framescaper' ? copy.editInSoundscaper : copy.editInFramescaper, disabled: handoffBlocked, onClick: actions.switchProduct },
				divider(),
				{ id: 'import-audio', label: copy.importFile, preserveLabel: true, shortcut: 'Ctrl+I', disabled: blocked, onClick: actions.importFiles },
				{ id: 'export-audio', label: copy.exportAudio, shortcut: 'Ctrl+Shift+E', disabled: blocked, onClick: actions.exportAudio },
				{
					id: 'export-other',
					label: copy.exportOther,
					parityLabel: copy.audacityParityMatchExportOther,
					items: [
						{
							id: 'export-labels',
							label: copy.exportLabels,
							disabled: blocked || !labelTracks.length,
							onClick: actions.exportLabels,
						},
					],
				},
					divider(),
				{ id: 'project-properties', label: copy.metadata, disabled: blocked, onClick: actions.openMetadata },
				{ id: 'rename-project', label: copy.renameProject, disabled: editBlocked, onClick: actions.renameProject },
				{ id: 'duplicate-project', label: copy.duplicateProject, disabled: blocked, onClick: actions.duplicateProject },
				{ id: 'delete-project', label: copy.deleteProject, disabled: editBlocked, onClick: actions.deleteProject },
				{ id: 'clear-data', label: copy.clearData, disabled: blocked, onClick: actions.clearData },
			],
		},
		{
			id: 'edit',
			label: copy.editMenu,
			items: [
				{ id: 'undo', label: copy.undo, shortcut: 'Ctrl+Z', disabled: editBlocked || !snapshot.history?.canUndo, onClick: () => actions.executeEdit('undo') },
				{ id: 'redo', label: copy.redo, shortcut: 'Ctrl+Shift+Z', disabled: editBlocked || !snapshot.history?.canRedo, onClick: () => actions.executeEdit('redo') },
				divider(),
					{
						id: 'cut',
						label: copy.cut,
						items: [
							{ id: 'cut-leave-gap', label: copy.cutLeaveGap, shortcut: 'Ctrl+X', disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('cutLeaveGap') },
							{ id: 'cut-per-clip-ripple', label: copy.cutPerClipRipple, disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('cutPerClipRipple') },
							{ id: 'cut-per-track-ripple', label: copy.cutPerTrackRipple, shortcut: 'Shift+X', disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('cutPerTrackRipple') },
							{ id: 'cut-all-tracks-ripple', label: copy.cutAllTracksRipple, shortcut: 'Shift+Ctrl+X', disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('cutAllTracksRipple') },
						],
					},
					{
						id: 'delete',
						label: copy.liftDelete,
						items: [
							{ id: 'delete-leave-gap', label: copy.deleteLeaveGap, shortcut: 'Delete', disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('deleteLeaveGap') },
							{ id: 'delete-per-clip-ripple', label: copy.deletePerClipRipple, disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('deletePerClipRipple') },
							{ id: 'delete-per-track-ripple', label: copy.deletePerTrackRipple, shortcut: 'Backspace', disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('deletePerTrackRipple') },
							{ id: 'delete-all-tracks-ripple', label: copy.deleteAllTracksRipple, shortcut: 'Ctrl+Delete, Ctrl+Backspace', disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('deleteAllTracksRipple') },
						],
					},
				{ id: 'copy', label: copy.copy, shortcut: 'Ctrl+C', disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('copy') },
				{
					id: 'paste',
					label: copy.paste,
					items: [
						{ id: 'action://paste', label: copy.paste, shortcut: 'Ctrl+V', disabled: editBlocked || !snapshot.history?.hasClipboard, onClick: () => actions.executeEdit('paste') },
						{ id: 'insert', label: copy.pasteInsert, disabled: editBlocked || !snapshot.history?.hasClipboard, onClick: () => actions.executeEdit('pasteInsert') },
						{ id: 'action://trackedit/paste-insert-all-tracks-ripple', label: copy.pasteSync, disabled: editBlocked || !snapshot.history?.hasClipboard, onClick: () => actions.executeEdit('pasteAllTracksRipple') },
					],
				},
				{ id: 'duplicate-audio', label: copy.duplicateAudio, disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('duplicate') },
				{
					id: 'remove-special',
					label: copy.removeSpecial,
					items: [
						{ id: 'trim-audio-outside-selection', label: copy.trimOutsideSelection, disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('trimOutsideSelection') },
						{ id: 'silence-audio', label: copy.silenceAudio, disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('silenceSelection') },
					],
				},
				{
					id: 'clip-boundaries',
					label: copy.clipBoundaries,
					items: [
						{ id: 'split', label: copy.split, shortcut: 'S', disabled: editBlocked || !splitAvailable, onClick: () => actions.executeEdit('split') },
						{ id: 'split-into-new-track', label: copy.splitIntoNewTrack, disabled: editBlocked || !selectedClip, onClick: () => actions.executeEdit('splitIntoNewTrack') },
						{ id: 'join', label: copy.joinClips, disabled: editBlocked || !multipleSelectedClips, onClick: () => actions.executeEdit('join') },
						{ id: 'disjoin', label: copy.disjoinClips, disabled: editBlocked || !selectedClip, onClick: () => actions.executeEdit('disjoin') },
						{ id: 'group-clips', label: copy.groupClips, disabled: editBlocked || !multipleSelectedClips, onClick: () => actions.executeEdit('group') },
						{ id: 'ungroup-clips', label: copy.ungroupClips, disabled: editBlocked || !groupedSelectedClips, onClick: () => actions.executeEdit('ungroup') },
						...framescaperVideoTrimItems,
						...(framescaperEditControls.link ? [framescaperEditControls.link] : []),
						{ id: 'clip-properties', label: copy.clipPropertiesCommand, disabled: !selectedClip, onClick: actions.openClipProperties },
					],
				},
				divider(),
				{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.openLabelEditor, label: copy.editLabels, onClick: actions.openLabels },
				{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.openMetadataEditor, label: copy.metadata, onClick: actions.openMetadata },
				{ id: 'preferences', label: copy.preferences, onClick: actions.openPreferences },
			],
		},
		{
			id: 'select',
			label: copy.selectMenu,
			items: [
				{ id: 'select-all', label: copy.selectAll, shortcut: 'Ctrl+A', disabled: editBlocked || durationFrames <= 0, onClick: actions.selectAll },
				{ id: 'select-none', label: copy.selectNone, shortcut: 'Ctrl+Shift+A', disabled: !editSelectionActive, onClick: actions.selectNone },
				divider(),
				{ id: 'select-tracks', label: copy.selectTracks, items: [
					{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.selectAllTracks, label: copy.allTracks, disabled: !project?.tracks.length, onClick: actions.selectAllTracks },
					clipSelectionNavigationMenus.selectNoTracks,
				] },
				clipSelectionNavigationMenus.audioClips,
				{ id: 'menu-selection-spectral', label: copy.selectSpectral, items: [
					{ id: 'toggle-spectral-selection', label: copy.toggleSpectralSelection, disabled: editBlocked || !spectralTrackSelected },
					{ id: 'spectral-brush', label: copy.spectralBrush, checked: Boolean(uiFlags.spectralBrush), disabled: editBlocked || !spectralTrackSelected },
				] },
				{
					id: 'select-region',
					label: copy.selectRegion,
					items: [
						{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.selectLeftOfPlaybackPosition, label: copy.leftAtPlayback, onClick: actions.selectLeftOfPlayback },
						{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.selectRightOfPlaybackPosition, label: copy.rightAtPlayback, onClick: actions.selectRightOfPlayback },
						{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.selectTrackStartToCursor, label: copy.trackStartToCursor, onClick: actions.selectTrackStartToCursor },
						{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.selectCursorToTrackEnd, label: copy.cursorToTrackEnd, onClick: actions.selectCursorToTrackEnd },
						{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.selectTrackStartToEnd, label: copy.trackStartToEnd || copy.selectAll, onClick: actions.selectTrackStartToEnd },
					],
				},
				{
					id: 'looping',
					label: copy.loopRegion,
					items: [
						{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.toggleLoopRegion, label: copy.loop, shortcut: productId === 'framescaper' ? undefined : 'L', checked: Boolean(project?.loop?.enabled), onClick: actions.toggleLoop },
						{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.clearLoopRegion, label: copy.clearLoopRegion || copy.selectNone, disabled: !project?.loop?.enabled, onClick: actions.clearLoop },
						{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.setLoopRegionToSelection, label: copy.loopToSelection || copy.loop, disabled: !selectionActive, onClick: actions.loopToSelection },
						{ id: 'set-selection-to-loop', label: copy.selectionToLoop, disabled: !project?.loop?.enabled, onClick: actions.selectionToLoop },
						{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.setLoopRegionInOut, label: copy.setLoopInOut || copy.loopRegion, onClick: actions.setLoopInOut },
						{ id: 'toggle-selection-follows-loop-region', label: copy.selectionFollowsLoop, checked: Boolean(snapshot.loopOptions?.selectionFollows), onClick: actions.toggleSelectionFollowsLoop },
						],
					},
					{ id: 'zero-crossings', label: copy.zeroCrossings, shortcut: 'Z', disabled: editBlocked || !selectionActive, onClick: actions.zeroCross },
				],
			},
		{
			id: 'view',
			label: copy.viewMenu,
			items: [
				{
					id: 'panels',
					label: copy.panels,
					items: [
						{ id: 'toggle-tracks', label: copy.tracksPanel, checked: uiFlags.tracksPanel },
						...WORKSPACE_PANEL_IDS
							.filter((panelId) => !ANALYZER_PANEL_ID_SET.has(panelId)
								&& (capabilities.audioEffects || panelId !== 'effects')
								&& (capabilities.audioAnalysis || panelId !== 'ebu-r128')
								&& (panelId !== 'markers' || timelineAnnotationsAvailable(snapshot)))
							.map((panelId) => panelId === 'effects'
							? {
								id: 'show-effects',
								label: copy.showEffects,
								checked: effectsPanelOpen,
								disabled: !selectedAudioTrack,
								onClick: actions.openEffects,
							}
							: {
								id: `panel-${panelId}`,
								label: workspacePanelLabel(copy, panelId),
								checked: panelId === 'project-bin'
									? projectBinEffectivelyOpen
									: preferences.workspace.panels[panelId].visible,
								onClick: () => actions.togglePanel(panelId),
							}),
					],
				},
				{
					id: 'workspace-preset',
					label: copy.workspace,
					items: [
						{ id: 'workspace-modern', label: copy.workspaceModern, checked: preferences.workspace.activeId === 'modern', onClick: () => actions.setWorkspace('modern') },
						{ id: 'workspace-music', label: copy.workspaceMusic, checked: preferences.workspace.activeId === 'music', onClick: () => actions.setWorkspace('music') },
						{ id: 'workspace-classic', label: copy.workspaceClassic, checked: preferences.workspace.activeId === 'classic', onClick: () => actions.setWorkspace('classic') },
						{ id: 'workspace-video-editor', label: copy.workspaceVideo, checked: preferences.workspace.activeId === 'video-editor', onClick: () => actions.setWorkspace('video-editor') },
						...preferences.workspace.custom.map((workspace) => ({ id: `workspace-${workspace.id}`, label: workspace.name, checked: preferences.workspace.activeId === workspace.id, onClick: () => actions.setWorkspace(workspace.id) })),
					],
				},
				{ id: 'show-arm-controls', label: copy.showArmControls, checked: showArmControls, onClick: actions.toggleArmControls },
				{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.toggleRmsInWaveform, label: copy.showRms, checked: Boolean(snapshot.timeline?.showRms), onClick: actions.toggleRms },
				{ id: 'show-rulers', label: copy.showVerticalRulers, checked: snapshot.timeline?.showVerticalRulers !== false, onClick: actions.toggleVerticalRulers },
				{ id: 'toggle-clipping-in-waveform', label: copy.showClipping, checked: uiFlags.clipping },
				{ id: 'show-master-track', label: copy.masterTrack, checked: Boolean(snapshot.preferences?.view?.showMasterTrack) },
				...(timelineAnnotationsAvailable(snapshot) ? [{
					id: 'show-markers',
					label: copy.showMarkers,
					checked: Boolean(snapshot.preferences?.view?.showMarkers),
					onClick: actions.toggleMarkers,
				}] : []),
				{ id: 'toggle-statusbar', label: copy.statusBar, checked: uiFlags.statusbar },
				divider(),
				createSnapMenu(copy, project, editBlocked, actions.setSnap),
				{
					id: 'zoom',
					label: copy.zoomMenu,
					items: [
						{ id: 'zoom-in', label: copy.zoomIn, shortcut: 'Ctrl+1', onClick: actions.zoomIn },
						{ id: 'zoom-default', label: copy.zoomNormal, shortcut: 'Ctrl+2', onClick: actions.zoomDefault },
						{ id: 'zoom-out', label: copy.zoomOut, shortcut: 'Ctrl+3', onClick: actions.zoomOut },
						{ id: 'zoom-to-selection', label: copy.zoomSelection, disabled: !selectionActive, onClick: actions.zoomSelection },
						{ id: 'zoom-toggle', label: copy.zoomToggle, onClick: actions.zoomToggle },
						{ id: 'zoom-fit', label: copy.zoomFit, shortcut: 'Ctrl+0', onClick: actions.zoomFit },
						{ id: 'fit-height', label: copy.fitHeight, onClick: actions.fitHeight },
						{ id: 'center-view-on-playhead', label: copy.centerViewOnPlayhead, onClick: actions.centerOnPlayhead },
						divider(),
						{ id: 'decrease-all-track-heights', label: copy.decreaseAllTrackHeights, shortcut: 'Ctrl+Shift+Down', disabled: !project?.tracks.length, onClick: actions.decreaseAllTrackHeights },
						{ id: 'increase-all-track-heights', label: copy.increaseAllTrackHeights, shortcut: 'Ctrl+Shift+Up', disabled: !project?.tracks.length, onClick: actions.increaseAllTrackHeights },
					],
				},
				clipSelectionNavigationMenus.skip,
				divider(),
				{ id: 'fullscreen', label: copy.fullscreen, shortcut: 'F11', onClick: actions.fullscreen },
			],
		},
		{
			id: 'transport-menu',
			label: copy.transport,
			items: [
				{ id: 'action://playback/play', label: copy.play, shortcut: 'Space', onClick: actions.playPause },
				{ id: 'action://playback/stop', label: copy.stop, onClick: actions.stop },
				divider(),
				...(productId === 'framescaper' ? [{
					id: 'video-navigation',
					label: copy.videoNavigation,
					disabled: videoNavigationBlocked,
					items: [
						{ id: 'video-navigation-previous-edit', label: copy.previousEdit, shortcut: 'Up', onClick: actions.previousVideoEdit },
						{ id: 'video-navigation-reverse', label: shuttleLabel(copy.shuttleBackward, -1), shortcut: 'J', checked: videoNavigation?.rate < 0, onClick: actions.shuttleBackward },
						{ id: 'video-navigation-stop', label: copy.shuttleStop, shortcut: 'K', checked: videoNavigation?.rate === 0, onClick: actions.shuttleStop },
						{ id: 'video-navigation-forward', label: shuttleLabel(copy.shuttleForward, 1), shortcut: 'L', checked: videoNavigation?.rate > 0, onClick: actions.shuttleForward },
						{ id: 'video-navigation-next-edit', label: copy.nextEdit, shortcut: 'Down', onClick: actions.nextVideoEdit },
					],
				}, divider()] : []),
				{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.toggleLoopRegion, label: copy.loop, checked: Boolean(project?.loop?.enabled), onClick: actions.toggleLoop },
				{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.metronome, label: copy.metronome, checked: Boolean(snapshot.recordingOptions?.metronome), onClick: actions.toggleMetronome },
			],
		},
		{
			id: 'tracks',
			label: copy.tracksMenu,
			items: [
				{
					id: 'add-new-track',
					label: copy.addNewTrack,
					items: [
						{ id: 'new-audio-track', label: copy.audioTrack, disabled: editBlocked, onClick: actions.addAudioTrack },
						{ id: 'new-label-track', label: copy.labelTrack, disabled: editBlocked, onClick: actions.addLabelTrack },
					],
				},
				...createTakeCompApplicationMenuItems({ productId, capability: Boolean(capabilities.takeComp), project, copy, open: actions.openTakeComp }),
				{ id: 'duplicate-track', label: copy.duplicateTrack, disabled: editBlocked || !selectedAudioTrack, onClick: actions.duplicateTrack },
				{ id: 'remove-track', label: copy.removeTracks, disabled: editBlocked || !selectedTrack, onClick: actions.removeTrack },
				trackLock.toggle,
				...(framescaperEditControls.visibility ? [framescaperEditControls.visibility] : []),
				{
					id: 'move-track',
					label: copy.moveTrack,
					disabled: editBlocked || !selectedTrack,
					items: [
						{ id: 'track-move-top', label: copy.moveTrackTop, disabled: !selectedTrackBlock || selectedTrackBlock.start === 0, onClick: actions.moveTrackTop },
						{ id: 'track-move-up', label: copy.moveTrackUp, disabled: !selectedTrackBlock || selectedTrackBlock.start === 0, onClick: actions.moveTrackUp },
						{ id: 'track-move-down', label: copy.moveTrackDown, disabled: !selectedTrackBlock || selectedTrackBlock.end === project.tracks.length - 1, onClick: actions.moveTrackDown },
						{ id: 'track-move-bottom', label: copy.moveTrackBottom, disabled: !selectedTrackBlock || selectedTrackBlock.end === project.tracks.length - 1, onClick: actions.moveTrackBottom },
					],
				},
				{
					id: 'track-display',
					label: copy.trackDisplay,
					disabled: !selectedAudioTrack,
					items: [
						{ id: 'action://trackedit/track-view-waveform', label: copy.waveformView, checked: selectedAudioTrack?.displayMode === 'waveform', onClick: () => actions.setTrackDisplay('waveform') },
						{ id: 'action://trackedit/track-view-spectrogram', label: copy.spectrogramView, checked: selectedAudioTrack?.displayMode === 'spectrogram', onClick: () => actions.setTrackDisplay('spectrogram') },
						{ id: 'action://trackedit/track-view-multi', label: copy.multiview, checked: selectedAudioTrack?.displayMode === 'multiview', onClick: () => actions.setTrackDisplay('multiview') },
					],
				},
				{
					id: 'track-rate',
					label: copy.sampleRate,
					disabled: editBlocked || !selectedAudioTrack,
					items: [44_100, 48_000, 88_200, 96_000, 192_000].map((sampleRate) => ({
						id: `action://trackedit/track/change-rate?rate=${sampleRate}`,
						label: `${sampleRate} Hz`,
						checked: selectedAudioSampleRates.size === 1 && selectedAudioSampleRates.has(sampleRate),
						onClick: () => actions.setTrackRate(sampleRate),
					})).concat([{ id: 'track-change-rate-custom', label: `${copy.sampleRate}`, onClick: actions.openTrackRate }]),
				},
				{
					id: 'track-format',
					label: copy.sampleFormat,
					disabled: editBlocked || !selectedAudioTrack,
					items: [
						['int16', copy.sampleFormatPcm.replace('{bits}', '16')],
						['int24', copy.sampleFormatPcm.replace('{bits}', '24')],
						['float32', copy.sampleFormatFloat32],
					].map(([sampleFormat, label]) => ({
						id: `action://trackedit/track/change-format?format=${sampleFormat}`,
						label,
						checked: selectedAudioSampleFormats.size === 1 && selectedAudioSampleFormats.has(sampleFormat),
						onClick: () => actions.setTrackSampleFormat(sampleFormat),
					})),
				},
				{
					id: 'track-channels',
					label: copy.trackChannels,
					disabled: editBlocked || !selectedAudioTrack,
					items: [
						{ id: 'track-make-stereo', label: copy.makeStereoTrack, disabled: !compatibleMonoTracks, onClick: actions.makeStereoTrack },
						{ id: 'track-swap-channels', label: copy.swapStereoChannels, disabled: selectedAudioChannelCount !== 2, onClick: actions.swapTrackChannels },
						{ id: 'track-split-stereo-to-lr', label: copy.splitStereoLr, disabled: selectedAudioChannelCount !== 2, onClick: actions.splitStereoLr },
						{ id: 'track-split-stereo-to-center', label: copy.splitStereoCenter, disabled: selectedAudioChannelCount !== 2, onClick: actions.splitStereoCenter },
					],
				},
				divider(),
				{ id: 'mute-track', label: selectedAudioTrack?.mute ? copy.unmuteTrack : copy.muteTrack, disabled: editBlocked || !selectedAudioTrack, onClick: actions.toggleTrackMute },
				...structuralMenus.muteItems,
				{ id: 'mix', label: copy.mixMenu, items: [{
					id: 'mixdown-to',
					label: copy.mixdownTo,
					disabled: editBlocked || !mixableAudioSelected,
					onClick: actions.mixAndRender,
				}] },
				{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.trackResample, label: copy.resample, disabled: editBlocked || !selectedAudioTrack, onClick: actions.openResample },
				structuralMenus.alignMenu,
				structuralMenus.sortMenu,
			],
		},
		{
			id: 'generate',
			label: copy.generateMenu,
			items: [
				createRepeatGeneratorMenuItem(importAnalysisMenuContext),
				divider(),
				{ id: 'silence-generator', label: copy.silenceGenerator, disabled: editBlocked, onClick: () => actions.openGenerator('silence') },
				{ id: 'tone-generator', label: copy.toneGenerator, disabled: editBlocked, onClick: () => actions.openGenerator('tone') },
				{ id: 'chirp-generator', label: copy.chirpGenerator, disabled: editBlocked, onClick: () => actions.openGenerator('chirp') },
				{ id: 'dtmf-generator', label: copy.dtmfGenerator, disabled: editBlocked, onClick: () => actions.openGenerator('dtmf') },
				{ id: 'noise-generator', label: copy.noiseGenerator, disabled: editBlocked, onClick: () => actions.openGenerator('noise') },
				{ id: 'nyquist-generators', label: copy.nyquist, items: nyquistItems('generate') },
			],
		},
		{
			id: 'effect',
			label: copy.effectMenu,
			items: [
				{ id: 'realtime-effects', label: copy.addRealtimeEffects, disabled: !selectedAudioTrack, onClick: actions.openEffects },
				{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.repeatLastEffect, label: copy.repeatLastEffect, disabled: editBlocked || !editSelectionActive || !snapshot.effects?.canRepeatLast, onClick: actions.repeatLastEffect },
				divider(),
				...effectGroups,
				{ id: 'pitch-tempo', label: copy.pitchTempo, items: createPitchAndTempoApplicationMenuItems({
					productId, capabilities, project, selectedClipId: selectedClip?.id ?? null,
					selectedAudioTrack, editingBlocked: editBlocked, copy, effectLabels, actions,
				}) },
				{
					id: 'nyquist-effects',
					label: copy.nyquist,
					items: nyquistItems('legacy'),
				},
				{
					id: 'spectral-effects',
					label: copy.spectralEffects,
					items: [
						{ id: 'spectral-box-select', label: copy.spectralBoxSelect, disabled: editBlocked || !spectralTrackSelected, onClick: actions.openSpectralSelection },
						{ id: 'spectral-delete', label: copy.spectralDelete, disabled: editBlocked || !frequencySelectionActive, onClick: actions.deleteSpectralSelection },
						{ id: 'spectral-amplify', label: copy.spectralAmplify, disabled: editBlocked || !frequencySelectionActive, onClick: actions.amplifySpectralSelection },
					],
				},
			],
		},
		{
			id: 'analyze',
			label: copy.analyzeMenu,
			items: [
				createRepeatAnalyzerMenuItem(importAnalysisMenuContext),
				divider(),
				{ id: 'analysis', label: copy.analysisCommand, disabled: analyzerBlocked, onClick: () => actions.openAnalysis('levels') },
				{ id: 'plot-spectrum', label: copy.plotSpectrum, disabled: analyzerBlocked, onClick: () => actions.openAnalysis('spectrum') },
				{ id: 'find-clipping', label: copy.findClipping, disabled: analyzerBlocked, onClick: () => actions.openAnalysis('clipping') },
				{ id: 'contrast', label: copy.contrast, disabled: analyzerBlocked, onClick: () => actions.openAnalysis('contrast') },
				{ id: 'ebu-r128-metrics', label: copy.meterTypeEbuR128, disabled: !project, onClick: actions.openEbuR128 },
				{ id: 'nyquist-analyzers', label: copy.nyquist, items: nyquistItems('analyze') },
			],
		},
		{
			id: 'tools',
			label: copy.toolsMenu,
			items: [
				...createImportAnalysisToolMenuItems(importAnalysisMenuContext),
				{ id: 'manage-macros', label: copy.macroManager, disabled: !project, onClick: actions.openMacroManager },
				{ id: 'nyquist-prompt', label: copy.nyquistPrompt, disabled: !project, onClick: () => actions.openNyquist() },
			],
		},
		{
			id: 'help',
			label: copy.helpMenu,
			items: [
				{ id: 'tutorials', label: copy.tutorials, onClick: actions.tutorials },
				{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.onlineHandbook, label: copy.manual, onClick: actions.manual },
				{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.support, label: copy.support, onClick: actions.support },
				{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.revertFactory, label: copy.revertFactorySettings, onClick: actions.revertFactorySettings },
				divider(),
				{ id: 'debug-storage', label: copy.debugStorage, checked: uiFlags.storagePanel, onClick: actions.toggleStoragePanel },
				divider(),
				{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.aboutAudacity, label: aboutLabel, preserveLabel: true, onClick: actions.about },
			],
		},
	], { locale, copy, materializeDisabled: true, actionRuntime });
	return filterProductMenus(menus, capabilities, productId);
}
