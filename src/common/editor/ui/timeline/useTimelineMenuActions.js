import { useCallback } from 'react';

export function useTimelineMenuActions({
	controller,
	copy,
	onError,
	state,
	model,
}) {
	const { project, showMasterTrack, showMarkers } = model;
	const {
		addTrackFlyout,
		setAddTrackFlyout,
		setClipMenu,
		setTimelineRulerMenu,
		setTrackRulerFlyout,
	} = state;

	const run = useCallback((action) => {
		try {
			const value = action();
			if (value && typeof value.catch === 'function') value.catch(onError);
			return value;
		} catch (error) {
			onError(error);
			return undefined;
		}
	}, [onError]);

	const openAddTrackFlyout = useCallback((event) => {
		if (addTrackFlyout) {
			setAddTrackFlyout(null);
			return;
		}
		const rect = event.currentTarget.getBoundingClientRect();
		setAddTrackFlyout({
			x: rect.left + rect.width / 2 - 96,
			y: rect.bottom + 8,
			autoFocus: event.nativeEvent.detail === 0,
		});
	}, [addTrackFlyout]);

	const addTrackFromFlyout = useCallback((type) => {
		setAddTrackFlyout(null);
		if (type === 'audio') return run(() => controller.actions.track.add());
		if (type === 'video') return run(() => controller.actions.track.addVideo());
		if (type === 'label') return run(() => controller.actions.track.addLabel());
		if (type === 'send') return run(() => controller.actions.mixer.addBus('send', {
			name: `${copy.sendBus} ${(project?.mixer?.sends?.length || 0) + 1}`,
		}));
		return undefined;
	}, [controller, copy.sendBus, project?.mixer?.sends?.length, run]);

	const toggleMasterTrack = useCallback(() => run(() => controller.actions.preferences.update({
		view: { showMasterTrack: !showMasterTrack },
	})), [controller, run, showMasterTrack]);

	const toggleMarkers = useCallback(() => run(() => controller.actions.preferences.update({
		view: { showMarkers: !showMarkers },
	})), [controller, run, showMarkers]);

	const openClipMenu = useCallback((clipId, x, y, openedViaKeyboard = false) => {
		const clip = project?.clips.find((item) => String(item.id) === String(clipId));
		if (!clip) return;
		if (!project.selection?.clipIds?.includes(clip.id)) {
			run(() => controller.actions.timeline.selectClip(clip.id));
		}
		setClipMenu({
			clipId: clip.id,
			x: Number.isFinite(x) ? x : 0,
			y: Number.isFinite(y) ? y : 0,
			autoFocus: Boolean(openedViaKeyboard),
		});
	}, [controller, project, run]);

	const openTimelineRulerMenu = useCallback((event) => {
		event.preventDefault();
		event.stopPropagation();
		const rect = event.currentTarget.getBoundingClientRect();
		const openedViaKeyboard = event.type === 'keydown';
		setTrackRulerFlyout(null);
		setTimelineRulerMenu({
			x: openedViaKeyboard ? rect.left + 12 : event.clientX,
			y: openedViaKeyboard ? rect.bottom - 4 : event.clientY,
			autoFocus: openedViaKeyboard,
		});
	}, []);

	const openTrackRulerFlyout = useCallback((track, displayMode, event) => {
		event.preventDefault();
		event.stopPropagation();
		const rect = event.currentTarget.getBoundingClientRect();
		const openedViaKeyboard = event.type === 'keydown';
		const mode = displayMode === 'spectrogram'
			|| (displayMode === 'multiview' && (openedViaKeyboard || event.clientY < rect.top + rect.height / 2))
			? 'spectrogram'
			: 'waveform';
		const popupHeight = mode === 'spectrogram' ? 430 : 260;
		const requestedY = openedViaKeyboard ? rect.top : event.clientY + 8;
		setTimelineRulerMenu(null);
		setTrackRulerFlyout({
			trackId: track.id,
			mode,
			x: Math.max(8, rect.left - 208),
			y: Math.max(8, Math.min(requestedY, globalThis.innerHeight - popupHeight - 8)),
			trigger: event.currentTarget,
		});
	}, []);

	const onClipContextMenu = useCallback((event) => {
		const clipElement = event.target.closest?.('[data-clip-id]');
		if (!clipElement) return;
		event.preventDefault();
		event.stopPropagation();
		openClipMenu(clipElement.dataset.clipId, event.clientX, event.clientY);
	}, [openClipMenu]);

	return {
		run,
		openAddTrackFlyout,
		addTrackFromFlyout,
		toggleMasterTrack,
		toggleMarkers,
		openClipMenu,
		openTimelineRulerMenu,
		openTrackRulerFlyout,
		onClipContextMenu,
	};
}
