import { AUDACITY_TRACK_CONTEXT_ACTION_IDS } from '../../audacity-context-menu.js';
import { trackSourceChannelCount, trackSources } from '../application-menu-model.js';
import { createSoundscaperProductionApplicationMenuItems } from '../soundscaper-production-application-menu.ts';
import { createTakeCompApplicationMenuItems } from '../take-comp-application-menu.ts';
import { resolveSoundscaperFreezeStatus, selectedTrackAutomationLaneId } from '../workspace/useSoundscaperProductionWorkspace.ts';
import { mediaTrackBlockBounds } from '../timeline-track-block-geometry.ts';
import {
	DEFAULT_WAVEFORM_RULER_STATE,
	normalizeWaveformRulerState,
} from './geometry.ts';
import { manifestMenuItem } from './TimelineOverlayComponents.jsx';
import { moveMediaTrackBlock } from './timeline-navigation.js';

/**
 * Whether an audio-only clip command is available on this clip, in this product.
 *
 * Reverse, normalize, and pitch/speed are audio-effect work: their handlers
 * refuse outright where that capability is absent, so a surface that offers them
 * there produces an error instead of an edit. The clip properties dialog has
 * always asked this question; the clip context menu asks it here so both answer
 * the same way.
 */
export function audioClipEditUnavailable(clip, options) {
	if (options?.mutationsBlocked) return true;
	if (options?.audioEffects === false) return true;
	return !clip || clip.kind !== 'audio';
}

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
	onOpenSurface,
	onOpenTrackRate,
	productId,
	capabilities,
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
	const trackOverflowItems = menuTrack ? createTrackOverflowItems({
		controller, project, track: menuTrack, copy, productId, capabilities,
		mutationsBlocked, run, onOpenSurface, onOpenTrackRate,
	}) : [];
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
		{
			id: 'move-track', label: copy.moveTrack, disabled: mutationsBlocked,
			items: [
				manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.moveTop, copy.moveTrackTop, { disabled: mutationsBlocked || menuTrackBlock?.start === 0, onClick: () => run(() => moveMediaTrackBlock(controller, project.tracks, menuTrack.id, 'top')) }, contextLocale, unavailableReason),
				manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.moveUp, copy.moveTrackUp, { disabled: mutationsBlocked || menuTrackBlock?.start === 0, onClick: () => run(() => moveMediaTrackBlock(controller, project.tracks, menuTrack.id, 'up')) }, contextLocale, unavailableReason),
				manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.moveDown, copy.moveTrackDown, { disabled: mutationsBlocked || menuTrackBlock?.end === project.tracks.length - 1, onClick: () => run(() => moveMediaTrackBlock(controller, project.tracks, menuTrack.id, 'down')) }, contextLocale, unavailableReason),
				manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.moveBottom, copy.moveTrackBottom, { disabled: mutationsBlocked || menuTrackBlock?.end === project.tracks.length - 1, onClick: () => run(() => moveMediaTrackBlock(controller, project.tracks, menuTrack.id, 'bottom')) }, contextLocale, unavailableReason),
			].filter(Boolean),
		},
		...trackOverflowItems.shared,
		...trackOverflowItems.display,
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
			{
				id: 'track-display', label: copy.trackDisplay,
				items: [
					manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.waveform, copy.waveformView, { checked: menuTrack.displayMode === 'waveform', onClick: () => run(() => controller.actions.track.setWaveformView(menuTrack.id)) }, contextLocale, unavailableReason),
					...(snapshot.capabilities?.audioSpectralEditing ? [
						manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.spectrogram, copy.spectrogramView, { checked: menuTrack.displayMode === 'spectrogram', onClick: () => run(() => controller.actions.track.setSpectrogramView(menuTrack.id)) }, contextLocale, unavailableReason),
						manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.multiview, copy.multiview, { checked: menuTrack.displayMode === 'multiview', onClick: () => run(() => controller.actions.track.setMultiView(menuTrack.id)) }, contextLocale, unavailableReason),
					] : []),
				].filter(Boolean),
			},
			...trackOverflowItems.audio,
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

function createTrackOverflowItems({
	controller, project, track, copy, productId, capabilities, mutationsBlocked, run, onOpenSurface, onOpenTrackRate,
}) {
	const audioTrack = track.type === 'audio' ? track : null;
	const sources = trackSources(project, audioTrack);
	const sourceRates = new Set(sources.map((source) => source.sampleRate));
	const sourceFormats = new Set(sources.map((source) => source.sampleFormat));
	const channelCount = trackSourceChannelCount(project, audioTrack);
	const compatibleMonoTrack = channelCount === 1 && project.tracks.some((candidate) => (
		candidate.id !== track.id && candidate.type === 'audio' && trackSourceChannelCount(project, candidate) === 1
	));
	const selectTrack = () => controller.actions.timeline.selectTrack(track.id);
	const freezeActions = controller.actions.audioFreeze;
	const production = createSoundscaperProductionApplicationMenuItems({
		productId,
		capabilities,
		project,
		selectedTrackId: track.id,
		automationMode: controller.actions.audioAutomation?.getSnapshot?.().mode,
		freezeStatus: resolveSoundscaperFreezeStatus(controller, project, track.id),
		freezeActionsAvailable: ['freeze', 'refresh', 'unfreeze', 'commit'].every((name) => (
			typeof freezeActions?.[name] === 'function'
		)),
		editingBlocked: mutationsBlocked,
		readOnly: false,
		copy,
	}, {
		open: (surface) => {
			run(selectTrack);
			onOpenSurface?.(`soundscaper-production:${surface}`);
		},
		setAutomationMode: (mode) => run(() => controller.actions.audioAutomation?.setMode(
			mode,
			selectedTrackAutomationLaneId(project, track.id),
		)),
		freeze: (operation, trackId) => run(() => freezeActions?.[operation]?.(trackId)),
	});
	const takeComp = createTakeCompApplicationMenuItems({
		productId,
		capability: capabilities?.takeComp === true,
		project,
		copy,
		open: () => onOpenSurface?.('take-comp'),
	});
	return {
		// Picture visibility is a track control, not a menu command: the video track
		// control panel carries it as mute, with solo hiding every other video track.
		display: [],
		shared: [
			{
				id: 'track-lock-toggle', label: track.locked ? copy.unlockTrack : copy.lockTrack,
				disabled: mutationsBlocked,
				onClick: () => run(() => controller.actions.track.update(track.id, { locked: !track.locked })),
			},
		],
		audio: audioTrack ? [
			...production.tracks,
			...takeComp,
			// Sample rate, sample format, and channel layout are audio-effect work:
			// their handlers refuse outright on a product without that capability,
			// so a surface that offered them there only produced an error after the
			// operator had chosen a value. The application menu already hides them.
			...(capabilities?.audioEffects === false ? [] : [
			{
				id: 'track-rate', label: copy.sampleRate, disabled: mutationsBlocked,
				items: [44_100, 48_000, 88_200, 96_000, 192_000].map((sampleRate) => ({
					id: `action://trackedit/track/change-rate?rate=${sampleRate}`,
					label: `${sampleRate} Hz`, checked: sourceRates.size === 1 && sourceRates.has(sampleRate),
					onClick: () => run(() => controller.actions.track.setRate(track.id, sampleRate)),
				})).concat([{
					id: 'track-change-rate-custom', label: copy.sampleRate,
					disabled: mutationsBlocked,
					onClick: () => onOpenTrackRate?.(track),
				}]),
			},
			{
				id: 'track-format', label: copy.sampleFormat, disabled: mutationsBlocked,
				items: [
					['int16', copy.sampleFormatPcm.replace('{bits}', '16')],
					['int24', copy.sampleFormatPcm.replace('{bits}', '24')],
					['float32', copy.sampleFormatFloat32],
				].map(([sampleFormat, label]) => ({
					id: `action://trackedit/track/change-format?format=${sampleFormat}`,
					label, checked: sourceFormats.size === 1 && sourceFormats.has(sampleFormat),
					onClick: () => run(() => controller.actions.track.setSampleFormat(track.id, sampleFormat)),
				})),
			},
			{
				id: 'track-channels', label: copy.trackChannels, disabled: mutationsBlocked,
				items: [
					{ id: 'track-make-stereo', label: copy.makeStereoTrack, disabled: !compatibleMonoTrack, onClick: () => run(() => controller.actions.track.makeStereo(track.id)) },
					{ id: 'track-swap-channels', label: copy.swapStereoChannels, disabled: channelCount !== 2, onClick: () => run(() => controller.actions.track.swapChannels(track.id)) },
					{ id: 'track-split-stereo-to-lr', label: copy.splitStereoLr, disabled: channelCount !== 2, onClick: () => run(() => controller.actions.track.splitStereoLR(track.id)) },
					{ id: 'track-split-stereo-to-center', label: copy.splitStereoCenter, disabled: channelCount !== 2, onClick: () => run(() => controller.actions.track.splitStereoCenter(track.id)) },
				],
			},
			]),
		] : [],
	};
}
