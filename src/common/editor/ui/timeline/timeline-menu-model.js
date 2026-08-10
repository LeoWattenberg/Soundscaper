import { AUDACITY_TRACK_CONTEXT_ACTION_IDS } from '../../audacity-context-menu.js';
import { mediaTrackBlockBounds } from '../timeline-track-block-geometry.ts';
import {
	DEFAULT_WAVEFORM_RULER_STATE,
	normalizeWaveformRulerState,
} from './geometry.ts';
import { manifestMenuItem } from './TimelineOverlayComponents.jsx';
import { moveMediaTrackBlock } from './timeline-navigation.js';

export function createTimelineMenuModel({
	controller,
	snapshot,
	locale,
	copy,
	showArmControls,
	onToggleArmControls,
	mutationsBlocked,
	state,
	model,
	menuActions,
}) {
	const {
		trackMenu,
		outputMenu,
		trackColorMenu,
		clipMenu,
		trackRulerFlyout,
		waveformRulerState,
		setTrackColorMenu,
		setWaveformRulerState,
		loopPreview,
	} = state;
	const { project, sampleRate } = model;
	const { run } = menuActions;

	const menuTrack = trackMenu ? project.tracks.find((track) => track.id === trackMenu.trackId) : null;
	const menuFolder = trackMenu?.folderId
		? (project.trackFolders || []).find((folder) => folder.id === trackMenu.folderId)
		: null;
	const trackFoldersAvailable = Boolean(snapshot.capabilities?.trackFolders);
	const menuTrackBlock = menuTrack ? mediaTrackBlockBounds(project.tracks, menuTrack.id) : null;
	const colorMenuTrack = trackColorMenu ? project.tracks.find((track) => track.id === trackColorMenu.trackId) : null;
	const menuClip = clipMenu ? project.clips.find((clip) => clip.id === clipMenu.clipId) : null;
	const rulerFlyoutTrack = trackRulerFlyout
		? project.tracks.find((track) => track.id === trackRulerFlyout.trackId && track.type === 'audio')
		: null;
	const activeWaveformRuler = rulerFlyoutTrack
		? normalizeWaveformRulerState(waveformRulerState[rulerFlyoutTrack.id])
		: DEFAULT_WAVEFORM_RULER_STATE;
	const contextLocale = locale;
	const unavailableReason = copy.unavailable;
	const updateWaveformRuler = (trackId, changes) => {
		setWaveformRulerState((current) => ({
			...current,
			[trackId]: {
				...(current[trackId] || DEFAULT_WAVEFORM_RULER_STATE),
				...changes,
			},
		}));
	};
	const updateTrackSpectrogram = (track, changes) => {
		if (!track || mutationsBlocked) return;
		run(() => controller.actions.track.update(track.id, {
			spectrogram: { ...track.spectrogram, ...changes },
		}));
	};
	const zoomSpectrogram = (track, direction) => {
		if (!track || mutationsBlocked) return;
		const nyquist = sampleRate / 2;
		const minimum = Math.max(0, Number(track.spectrogram?.minimumFrequency) || 0);
		const maximum = Math.min(nyquist, Number(track.spectrogram?.maximumFrequency) || nyquist);
		const center = (minimum + maximum) / 2;
		const requestedSpan = (maximum - minimum) * (direction === 'in' ? 0.5 : 2);
		const span = Math.max(10, Math.min(nyquist, requestedSpan));
		const nextMinimum = Math.max(0, Math.min(nyquist - span, center - span / 2));
		updateTrackSpectrogram(track, {
			minimumFrequency: Math.round(nextMinimum),
			maximumFrequency: Math.round(nextMinimum + span),
		});
	};
	const trackFolderMenuItems = trackFoldersAvailable && menuTrack ? [
		{ divider: true, label: '' },
		{
			label: copy.wrapTracksInFolder,
			disabled: mutationsBlocked,
			onClick: () => run(() => controller.actions.trackFolders.wrapSelection([menuTrack.id])),
		},
	] : [];
	const trackMenuItems = menuTrack ? [
		...(menuTrack.type === 'audio' ? [
			manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.showArmControls, copy.showArmControls, {
				checked: showArmControls,
				onClick: onToggleArmControls,
			}, contextLocale, unavailableReason),
			{ divider: true, label: '' },
		] : []),
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.duplicate, copy.duplicateTrack, {
			disabled: mutationsBlocked || menuTrack.type !== 'audio',
			onClick: () => run(() => controller.actions.track.duplicate(menuTrack.id)),
		}, contextLocale, unavailableReason),
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.moveTop, copy.moveTrackTop, {
			disabled: mutationsBlocked || menuTrackBlock?.start === 0,
			onClick: () => run(() => moveMediaTrackBlock(controller, project.tracks, menuTrack.id, 'top')),
		}, contextLocale, unavailableReason),
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.moveUp, copy.moveTrackUp, {
			disabled: mutationsBlocked || menuTrackBlock?.start === 0,
			onClick: () => run(() => moveMediaTrackBlock(controller, project.tracks, menuTrack.id, 'up')),
		}, contextLocale, unavailableReason),
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.moveDown, copy.moveTrackDown, {
			disabled: mutationsBlocked || menuTrackBlock?.end === project.tracks.length - 1,
			onClick: () => run(() => moveMediaTrackBlock(controller, project.tracks, menuTrack.id, 'down')),
		}, contextLocale, unavailableReason),
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.moveBottom, copy.moveTrackBottom, {
			disabled: mutationsBlocked || menuTrackBlock?.end === project.tracks.length - 1,
			onClick: () => run(() => moveMediaTrackBlock(controller, project.tracks, menuTrack.id, 'bottom')),
		}, contextLocale, unavailableReason),
		...(menuTrack.type === 'audio' ? [
			{ divider: true, label: '' },
			manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.changeColor, copy.trackColor, {
				disabled: mutationsBlocked,
				onClick: () => {
					const rect = trackMenu?.anchor?.getBoundingClientRect();
					setTrackColorMenu({
						trackId: menuTrack.id,
						x: rect?.right || 0,
						y: rect?.top || 0,
					});
				},
			}, contextLocale, unavailableReason),
			{ divider: true, label: '' },
			manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.waveform, copy.waveformView, {
				checked: menuTrack.displayMode === 'waveform',
				onClick: () => run(() => controller.actions.track.setWaveformView(menuTrack.id)),
			}, contextLocale, unavailableReason),
			...(snapshot.capabilities?.audioSpectralEditing ? [manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.spectrogram, copy.spectrogramView, {
				checked: menuTrack.displayMode === 'spectrogram',
				onClick: () => run(() => controller.actions.track.setSpectrogramView(menuTrack.id)),
			}, contextLocale, unavailableReason),
			manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.multiview, copy.multiview, {
				checked: menuTrack.displayMode === 'multiview',
				onClick: () => run(() => controller.actions.track.setMultiView(menuTrack.id)),
			}, contextLocale, unavailableReason)] : []),
		] : []),
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.decreaseHeight, copy.decreaseTrackHeight, {
			disabled: mutationsBlocked,
			onClick: () => run(() => controller.actions.track.decreaseHeight(menuTrack.id)),
		}, contextLocale, unavailableReason),
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.increaseHeight, copy.increaseTrackHeight, {
			disabled: mutationsBlocked,
			onClick: () => run(() => controller.actions.track.increaseHeight(menuTrack.id)),
		}, contextLocale, unavailableReason),
		{ divider: true, label: '' },
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.remove, copy.deleteTrack, {
			disabled: mutationsBlocked,
			onClick: () => run(() => controller.actions.track.remove(menuTrack.id)),
		}, contextLocale, unavailableReason),
		...trackFolderMenuItems,
	].filter(Boolean) : [];
	const outputMenuTarget = outputMenu?.scope === 'master'
		? project.master
		: project.mixer?.[`${outputMenu?.scope || ''}s`]?.find((bus) => bus.id === outputMenu?.busId) || null;
	const updateOutputMenuTarget = (changes) => {
		if (!outputMenuTarget || !outputMenu) return undefined;
		if (outputMenu.scope === 'master') return controller.actions.mixer.updateMaster(changes);
		return controller.actions.mixer.updateBus(outputMenu.scope, outputMenuTarget.id, changes);
	};
	const outputMenuItems = outputMenuTarget ? [
		{
			label: outputMenuTarget.collapsed === false ? copy.collapseTrack : copy.expandTrack,
			disabled: mutationsBlocked,
			onClick: () => run(() => updateOutputMenuTarget({ collapsed: outputMenuTarget.collapsed === false })),
		},
		...(outputMenu?.scope === 'master' ? [] : [
			{ divider: true, label: '' },
			{
				label: copy.removeBus,
				disabled: mutationsBlocked,
				onClick: () => run(() => controller.actions.mixer.removeBus(outputMenu.scope, outputMenuTarget.id)),
			},
		]),
	] : [];
	const folderMenuItems = menuFolder ? [
		{
			label: menuFolder.collapsed ? copy.expandTrackFolder : copy.collapseTrackFolder,
			disabled: mutationsBlocked,
			onClick: () => run(() => controller.actions.trackFolders.toggleCollapsed(menuFolder.id)),
		},
		{
			label: copy.newTrackFolder,
			disabled: mutationsBlocked,
			onClick: () => run(() => controller.actions.trackFolders.create(undefined, { parentFolderId: menuFolder.id })),
		},
		{ divider: true, label: '' },
		{
			label: copy.deleteTrackFolderKeepTracks,
			disabled: mutationsBlocked,
			onClick: () => run(() => controller.actions.trackFolders.remove(menuFolder.id, 'promote')),
		},
		{
			label: copy.deleteTrackFolderAndTracks,
			disabled: mutationsBlocked,
			onClick: () => run(() => controller.actions.trackFolders.remove(menuFolder.id, 'delete-contents')),
		},
	] : [];
	const displayedLoop = loopPreview || project.loop || {};

	return {
		menuTrack,
		menuFolder,
		folderMenuItems,
		colorMenuTrack,
		menuClip,
		rulerFlyoutTrack,
		activeWaveformRuler,
		contextLocale,
		unavailableReason,
		updateWaveformRuler,
		updateTrackSpectrogram,
		zoomSpectrogram,
		trackMenuItems,
		outputMenuTarget,
		outputMenuItems,
		displayedLoop,
	};
}
