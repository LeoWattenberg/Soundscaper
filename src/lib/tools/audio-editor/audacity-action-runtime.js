import { projectDurationFrames } from './project.js';

const STAFFPAD_EFFECT_TYPES = Object.freeze({
	changePitch: 'audacity-change-pitch',
	changeTempo: 'audacity-change-tempo',
	changeSpeedPitch: 'audacity-change-speed-pitch',
	slidingStretch: 'audacity-sliding-stretch',
});

const UI_FLAG_DEFAULTS = Object.freeze({
	clipping: true,
	halfWave: false,
	masterTrack: true,
	microphoneMetering: true,
	selectionToolbar: true,
	splitTool: false,
	statusbar: true,
	tracksPanel: true,
});

/**
 * Small, framework-neutral UI command target used by manifest actions which
 * open a dialog, focus a panel, or toggle browser-only chrome. React consumes
 * the emitted snapshot; headless tests exercise the exact same command target.
 */
export function createAudioEditorUiActionController(options = {}) {
	let flags = Object.freeze({ ...UI_FLAG_DEFAULTS, ...(options.flags || {}) });
	let request = null;
	let revision = 0;
	let disposed = false;
	let snapshot = null;
	const listeners = new Set();

	function ensureUsable() {
		if (disposed) throw new Error('The audio editor UI action controller is disposed.');
	}

	function publish() {
		snapshot = null;
		for (const listener of [...listeners]) listener();
	}

	function issue(type, payload = {}) {
		ensureUsable();
		if (typeof type !== 'string' || !type.trim()) throw new TypeError('A UI action type is required.');
		revision += 1;
		request = Object.freeze({ type, payload: Object.freeze({ ...payload }), revision });
		publish();
		return request;
	}

	function toggleFlag(name) {
		ensureUsable();
		if (!Object.hasOwn(flags, name)) throw new ReferenceError(`Unknown audio editor UI flag: ${name}.`);
		flags = Object.freeze({ ...flags, [name]: !flags[name] });
		publish();
		return flags[name];
	}

	function setFlag(name, value) {
		ensureUsable();
		if (!Object.hasOwn(flags, name)) throw new ReferenceError(`Unknown audio editor UI flag: ${name}.`);
		flags = Object.freeze({ ...flags, [name]: Boolean(value) });
		publish();
		return flags[name];
	}

	function getSnapshot() {
		if (!snapshot) snapshot = Object.freeze({ flags, request, revision, disposed });
		return snapshot;
	}

	function subscribe(listener) {
		ensureUsable();
		if (typeof listener !== 'function') throw new TypeError('A UI action subscriber must be a function.');
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	function dispose() {
		if (disposed) return;
		disposed = true;
		publish();
		listeners.clear();
	}

	return Object.freeze({
		actions: Object.freeze({
			issue,
			openSurface: (surface, payload) => issue('open-surface', { surface, ...(payload || {}) }),
			openExternal: (url) => issue('open-external', { url }),
			focusPanel: (panel, direction = null) => issue('focus-panel', { panel, direction }),
			openContextMenu: (payload) => issue('open-context-menu', payload),
			toggleFlag,
			setFlag,
		}),
		getSnapshot,
		subscribe,
		dispose,
	});
}

/**
 * Materialize the manifest's logical handler paths over the real editor
 * controller. Wrappers only bind parameters or coordinate an explicit UI
 * request; DSP, project mutation, history and persistence remain controller
 * operations.
 */
export function createAudacityActionRuntime(controller, options = {}) {
	if (!controller?.actions || typeof controller.getSnapshot !== 'function') {
		throw new TypeError('A concrete audio editor controller is required.');
	}
	const controllerActions = controller.actions;
	const uiController = options.uiController || createAudioEditorUiActionController();
	if (!uiController?.actions || typeof uiController.getSnapshot !== 'function') {
		throw new TypeError('A concrete audio editor UI action controller is required.');
	}
	const ui = uiController.actions;
	const snapshot = () => controller.getSnapshot();
	const project = () => snapshot().project;
	const selectedClipId = () => {
		const currentSnapshot = snapshot();
		const currentProject = currentSnapshot.project;
		if (!currentProject) return null;
		if (currentProject.clips.some((clip) => clip.id === currentSnapshot.selectedClipId)) {
			return currentSnapshot.selectedClipId;
		}
		return currentProject.selection?.clipIds?.find((clipId) => (
			currentProject.clips.some((clip) => clip.id === clipId)
		)) || null;
	};
	const selectedClip = () => project()?.clips.find((clip) => clip.id === selectedClipId()) || null;
	const selectedTrackId = () => {
		const currentSnapshot = snapshot();
		const currentProject = currentSnapshot.project;
		if (!currentProject) return null;
		if (currentProject.tracks.some((track) => track.id === currentSnapshot.selectedTrackId)) {
			return currentSnapshot.selectedTrackId;
		}
		const selectionTrackId = currentProject.selection?.trackIds?.find((trackId) => (
			currentProject.tracks.some((track) => track.id === trackId)
		));
		if (selectionTrackId) return selectionTrackId;
		const clipId = selectedClipId();
		return clipId
			? currentProject.tracks.find((track) => track.clipIds?.includes(clipId))?.id || null
			: null;
	};
	const selectedTrack = () => project()?.tracks.find((track) => track.id === selectedTrackId()) || null;
	const selectedAudioTrack = () => {
		const currentProject = project();
		if (!currentProject) return null;
		const current = selectedTrack();
		if (current && current.type !== 'label') return current;
		for (const trackId of currentProject.selection?.trackIds || []) {
			const track = currentProject.tracks.find((candidate) => candidate.id === trackId);
			if (track && track.type !== 'label') return track;
		}
		const clipId = selectedClipId();
		return currentProject.tracks.find((track) => track.type !== 'label' && track.clipIds?.includes(clipId)) || null;
	};
	const selectedRackEffect = (effectId = null) => {
		const track = selectedTrack();
		return track?.effects?.find((effect) => !effectId || effect.id === effectId) || null;
	};
	const openSurface = (surface, payload) => ui.openSurface(surface, payload);
	const openPanel = (panel) => {
		const entry = snapshot().preferences?.workspace?.panels?.[panel];
		if (entry && !entry.visible) controllerActions.preferences.setPanel(panel, { visible: true });
		ui.focusPanel(panel);
		return panel;
	};
	const setSelection = (startFrame, endFrame, details = {}) => controllerActions.timeline.setSelection(startFrame, endFrame, details);
	const selectEntireProject = () => setSelection(0, projectDurationFrames(project()));
	const nudgeFrames = () => 1;
	let alternateZoom = 240;

	function openEffect(type = null) {
		if (type) controllerActions.effects.setSelectionType(type);
		return openSurface('selection-effect', type ? { type } : {});
	}

	function openGenerator(type = 'tone') {
		return openSurface('generator', { type });
	}

	function updateSelectedClip(changes) {
		const clip = selectedClip();
		if (!clip) return openSurface('clip');
		return controllerActions.clip.update(clip.id, changes);
	}

	function updateSelectedTrack(changes) {
		const track = selectedTrack();
		if (!track) return null;
		return controllerActions.track.update(track.id, changes);
	}

	function moveSelectedClip(deltaFrames, trackDelta = 0) {
		const clip = selectedClip();
		const currentProject = project();
		if (!clip || !currentProject) return null;
		const currentTrackIndex = currentProject.tracks.findIndex((track) => track.clipIds?.includes(clip.id));
		const targetTrack = currentProject.tracks[Math.max(0, Math.min(currentProject.tracks.length - 1, currentTrackIndex + trackDelta))];
		if (!targetTrack || targetTrack.type === 'label') return null;
		return controllerActions.clip.move(
			clip.id,
			targetTrack.id,
			Math.max(0, clip.timelineStartFrame + deltaFrames),
		);
	}

	function trimSelectedClip(edge, deltaFrames) {
		const clip = selectedClip();
		if (!clip) return null;
		if (edge === 'left') {
			const delta = Math.max(-clip.sourceStartFrame, Math.min(clip.durationFrames - 1, deltaFrames));
			return controllerActions.clip.trim(clip.id, {
				timelineStartFrame: clip.timelineStartFrame + delta,
				sourceStartFrame: clip.sourceStartFrame + delta,
				durationFrames: clip.durationFrames - delta,
			});
		}
		const sourceFrames = clip.sourceDurationFrames || clip.durationFrames;
		const maximumGrowth = Math.max(0, sourceFrames - clip.sourceStartFrame - clip.durationFrames);
		const delta = Math.max(-(clip.durationFrames - 1), Math.min(maximumGrowth, deltaFrames));
		return controllerActions.clip.trim(clip.id, { durationFrames: clip.durationFrames + delta });
	}

	function selectRelativeClip(direction) {
		const clips = [...(project()?.clips || [])].sort((left, right) => (
			left.timelineStartFrame - right.timelineStartFrame || left.id.localeCompare(right.id)
		));
		if (!clips.length) return null;
		const index = Math.max(0, clips.findIndex((clip) => clip.id === snapshot().selectedClipId));
		const next = clips[Math.max(0, Math.min(clips.length - 1, index + direction))];
		controllerActions.timeline.selectClip(next.id);
		return next.id;
	}

	function selectRelativeTrack(direction, mode = 'replace') {
		const tracks = project()?.tracks || [];
		if (!tracks.length) return null;
		const current = Math.max(0, tracks.findIndex((track) => track.id === snapshot().selectedTrackId));
		const next = tracks[Math.max(0, Math.min(tracks.length - 1, current + direction))];
		const selection = project().selection || { startFrame: 0, endFrame: 0, trackIds: [] };
		if (mode === 'extend') {
			const trackIds = [...new Set([...(selection.trackIds || []), next.id])];
			setSelection(selection.startFrame, selection.endFrame, { trackIds });
		} else controllerActions.timeline.selectTrack(next.id);
		return next.id;
	}

	function toggleCurrentTrackSelection(mode = 'toggle') {
		const track = selectedTrack();
		if (!track) return null;
		const selection = project().selection || { startFrame: 0, endFrame: 0, trackIds: [] };
		const currentIds = selection.trackIds || [];
		const trackIds = mode === 'replace'
			? [track.id]
			: currentIds.includes(track.id)
				? currentIds.filter((id) => id !== track.id)
				: [...currentIds, track.id];
		return setSelection(selection.startFrame, selection.endFrame, { trackIds });
	}

	function adjustSelection(edge, deltaFrames) {
		const selection = project()?.selection || { startFrame: 0, endFrame: 0 };
		if (edge === 'left') return setSelection(Math.max(0, selection.startFrame + deltaFrames), selection.endFrame);
		return setSelection(selection.startFrame, Math.max(selection.startFrame, selection.endFrame + deltaFrames));
	}

	function removeRealtimeEffect(effectId = null) {
		const track = selectedTrack();
		const effect = selectedRackEffect(effectId);
		if (!track || !effect) return null;
		return controllerActions.effects.remove('track', track.id, effect.id);
	}

	function moveRealtimeEffect(direction, effectId = null) {
		const track = selectedTrack();
		const effect = selectedRackEffect(effectId);
		if (!track || !effect) return null;
		const index = track.effects.findIndex((candidate) => candidate.id === effect.id);
		return controllerActions.effects.reorder('track', track.id, effect.id, Math.max(0, index + direction));
	}

	function addRealtimeEffect(type, replaceEffectId = null) {
		const track = selectedTrack();
		if (!track) return null;
		if (replaceEffectId) removeRealtimeEffect(replaceEffectId);
		if (!type) return openPanel('effects');
		return controllerActions.effects.add({ scope: 'track', trackId: track.id, type });
	}

	const runtime = {
		...controllerActions,
		getActionContext: () => Object.freeze({
			snapshot: snapshot(),
			telemetry: controller.getTelemetrySnapshot?.() || null,
			ui: uiController.getSnapshot(),
		}),
		project: {
			...controllerActions.project,
			openRecent: (projectId = null) => projectId ? controllerActions.project.openById(projectId) : controllerActions.project.list(),
			clearRecent: () => controllerActions.project.clearRecent?.() || ui.issue('clear-recent-projects'),
			saveAs: (saveOptions) => controllerActions.project.saveAup4(saveOptions),
		},
		io: {
			importAudio: (files = null) => files ? controllerActions.project.importFiles(files) : ui.issue('choose-audio-files'),
			exportAudio: (settings = null) => settings ? controllerActions.export.start(settings) : openSurface('export'),
			exportClip: (clipId = snapshot().selectedClipId) => {
				const clip = project()?.clips.find((candidate) => candidate.id === clipId);
				if (!clip) return null;
				controllerActions.timeline.selectClip(clip.id);
				setSelection(clip.timelineStartFrame, clip.timelineStartFrame + clip.durationFrames, { clipIds: [clip.id] });
				return openSurface('export', { range: 'selection', clipId: clip.id });
			},
		},
		session: {
			closeProject: (projectId = project()?.id, closeOptions) => (
				controllerActions.project.close?.(projectId, closeOptions)
				|| ui.issue('close-project', { projectId, ...(closeOptions || {}) })
			),
		},
		workspace: {
			toggleTransportToolbar: () => controllerActions.preferences.toggleToolbar('transport'),
			toggleSelectionToolbar: () => ui.toggleFlag('selectionToolbar'),
			toggleTracksPanel: () => ui.toggleFlag('tracksPanel'),
			toggleStatusbar: () => ui.toggleFlag('statusbar'),
			toggleMasterTrack: () => ui.toggleFlag('masterTrack'),
			configure: () => openSurface('preferences', { section: 'workspace' }),
			fullscreen: () => ui.issue('toggle-fullscreen'),
			restoreDefault: () => controllerActions.preferences.setWorkspace('modern'),
		},
		clip: {
			...controllerActions.clip,
			group: controllerActions.edit.group,
			ungroup: controllerActions.edit.ungroup,
			rename: (title = null) => title == null ? openSurface('clip') : updateSelectedClip({ title: String(title) }),
			openProperties: () => openSurface('clip'),
			openPitchSpeed: () => openSurface('clip', { section: 'pitch-speed' }),
			setGain: (gain = 1) => updateSelectedClip({ gain: Number(gain) }),
			useTrackColor: () => updateSelectedClip({ color: 'auto' }),
			setColor: (color) => updateSelectedClip({ color }),
		},
		labels: {
			...controllerActions.labels,
			pasteNew: (text = '') => controllerActions.labels.add(null, { text: String(text) }),
		},
		panels: {
			labels: () => openPanel('labels'),
			metadata: () => openPanel('metadata'),
			effects: () => openPanel('effects'),
			history: () => openPanel('history'),
		},
		preferences: {
			...controllerActions.preferences,
			open: () => openSurface('preferences'),
			toggleTrackSynchronization: () => {
				const enabled = snapshot().preferences?.editing?.rippleMode === 'all-tracks';
				return controllerActions.preferences.update({ editing: { rippleMode: enabled ? 'off' : 'all-tracks' } });
			},
		},
		selection: {
			all: selectEntireProject,
			clear: controllerActions.timeline.clearSelection,
			allTracks: controllerActions.timeline.selectAllTracks,
			leftAtPlayback: controllerActions.timeline.selectLeftOfPlayback,
			rightAtPlayback: controllerActions.timeline.selectRightOfPlayback,
			trackStartToCursor: controllerActions.timeline.selectTrackStartToCursor,
			cursorToTrackEnd: controllerActions.timeline.selectCursorToTrackEnd,
			trackStartToEnd: controllerActions.timeline.selectTrackStartToEnd,
			zeroCross: controllerActions.timeline.zeroCross,
			extendLeft: () => adjustSelection('left', -nudgeFrames()),
			extendRight: () => adjustSelection('right', nudgeFrames()),
			contractLeft: () => adjustSelection('left', nudgeFrames()),
			contractRight: () => adjustSelection('right', -nudgeFrames()),
		},
		timeline: {
			...controllerActions.timeline,
			zoomDefault: () => controllerActions.timeline.setZoom(120),
			zoomSelection: () => {
				const selection = project()?.selection;
				const sampleRate = project()?.sampleRate || 48_000;
				if (!selection || selection.endFrame <= selection.startFrame) return controllerActions.timeline.zoomFit();
				return controllerActions.timeline.setZoom(960 / ((selection.endFrame - selection.startFrame) / sampleRate));
			},
			zoomToggle: () => {
				const current = snapshot().timeline?.pixelsPerSecond || 120;
				const target = Math.abs(current - 120) < 0.001 ? alternateZoom : 120;
				alternateZoom = current;
				return controllerActions.timeline.setZoom(target);
			},
			centerOnPlayhead: () => ui.issue('center-playhead'),
			configureSnap: () => openSurface('preferences', { section: 'snap' }),
			setSecondsRuler: () => controllerActions.project.setTimeDisplay('hh:mm:ss+milliseconds'),
			setMusicalRuler: () => controllerActions.project.setTimeDisplay('beats+measures'),
			nudgePlayheadLeft: () => controllerActions.transport.seek(Math.max(0, (controller.getTelemetrySnapshot?.().positionFrame || 0) - nudgeFrames())),
			nudgePlayheadRight: () => controllerActions.transport.seek((controller.getTelemetrySnapshot?.().positionFrame || 0) + nudgeFrames()),
		},
		view: {
			toggleClipping: () => ui.toggleFlag('clipping'),
			toggleRms: controllerActions.timeline.toggleRms,
			toggleVerticalRulers: controllerActions.timeline.toggleVerticalRulers,
			toggleGlobalSpectrogram: () => controllerActions.timeline.setView(snapshot().timeline?.view === 'spectrogram' ? 'waveform' : 'spectrogram'),
		},
		recording: {
			...controllerActions.recording,
			startCurrentTrack: controllerActions.recording.start,
			setLevel: (level = null) => level == null
				? ui.issue('focus-recording-level')
				: controllerActions.recording.setLevel(Number(level)),
			toggleMicMetering: () => ui.toggleFlag('microphoneMetering'),
			toggleInputMonitoring: () => controllerActions.recording.setMonitoring(!snapshot().monitor?.enabled),
		},
		transport: {
			...controllerActions.transport,
			pause: controllerActions.transport.playPause,
			setPlaybackTime: controllerActions.transport.seek,
		},
		mixer: {
			setPlaybackLevel: (level = 1) => controllerActions.effects.setMasterGain(Number(level)),
		},
		track: {
			...controllerActions.track,
			duplicate: (context = null) => {
				const requestedTrackId = typeof context === 'string' ? context : context?.trackId;
				const requestedTrack = requestedTrackId
					? project()?.tracks.find((track) => track.id === requestedTrackId && track.type !== 'label')
					: null;
				const track = requestedTrack || selectedAudioTrack();
				return track ? controllerActions.track.duplicate(track.id) : null;
			},
			removeSelected: () => {
				const trackId = selectedTrackId();
				return trackId ? controllerActions.track.remove(trackId) : null;
			},
			rename: (name = null) => name == null ? ui.issue('rename-track', { trackId: selectedTrackId() }) : updateSelectedTrack({ name: String(name) }),
			setRate: (rate) => {
				const track = selectedAudioTrack();
				return track ? controllerActions.track.setRate(track.id, rate) : null;
			},
			setSampleFormat: (sampleFormat) => {
				const track = selectedAudioTrack();
				return track ? controllerActions.track.setSampleFormat(track.id, sampleFormat) : null;
			},
			setCustomRate: (rate) => rate == null ? ui.issue('set-custom-track-rate', { trackId: selectedAudioTrack()?.id || null }) : runtime.track.setRate(rate),
			openSpectrogramSettings: () => openPanel('spectrogram'),
			setHalfWaveView: () => {
				const track = selectedAudioTrack();
				return track ? controllerActions.track.setDisplayMode(track.id, 'half-wave') : null;
			},
			setColor: (color = 'auto') => updateSelectedTrack({ color }),
		},
		navigation: {
			moveItemLeft: () => moveSelectedClip(-nudgeFrames()),
			moveItemRight: () => moveSelectedClip(nudgeFrames()),
			extendItemLeft: () => trimSelectedClip('left', -nudgeFrames()),
			extendItemRight: () => trimSelectedClip('right', nudgeFrames()),
			reduceItemLeft: () => trimSelectedClip('left', nudgeFrames()),
			reduceItemRight: () => trimSelectedClip('right', -nudgeFrames()),
			moveItemUp: () => moveSelectedClip(0, -1),
			moveItemDown: () => moveSelectedClip(0, 1),
			nextPanel: () => ui.focusPanel(null, 'next'),
			previousPanel: () => ui.focusPanel(null, 'previous'),
			nextItem: () => selectRelativeClip(1),
			previousItem: () => selectRelativeClip(-1),
			itemAbove: () => selectRelativeTrack(-1),
			itemBelow: () => selectRelativeTrack(1),
			firstTrack: () => selectRelativeTrack(-Number.MAX_SAFE_INTEGER),
			lastTrack: () => selectRelativeTrack(Number.MAX_SAFE_INTEGER),
			replaceSelection: () => toggleCurrentTrackSelection('replace'),
			toggleSelection: () => toggleCurrentTrackSelection('toggle'),
			rangeSelection: () => toggleCurrentTrackSelection('toggle'),
			extendTrackSelectionUp: () => selectRelativeTrack(-1, 'extend'),
			extendTrackSelectionDown: () => selectRelativeTrack(1, 'extend'),
			openContextMenu: () => ui.openContextMenu({
				trackId: snapshot().selectedTrackId,
				clipId: snapshot().selectedClipId,
			}),
		},
		tools: {
			toggleSplitTool: () => ui.toggleFlag('splitTool'),
		},
		effects: {
			...controllerActions.effects,
			openProcessor: () => openEffect(),
			openGenerator: () => openGenerator(),
			openRealtimeRack: () => openPanel('effects'),
			removeRealtime: removeRealtimeEffect,
			moveRealtimeUp: (effectId) => moveRealtimeEffect(-1, effectId),
			moveRealtimeDown: (effectId) => moveRealtimeEffect(1, effectId),
			openById: (effectId) => openEffect(effectId),
			addRealtimeById: (effectId) => addRealtimeEffect(effectId),
			replaceRealtimeById: (effectId, replacedEffectId = selectedRackEffect()?.id) => addRealtimeEffect(effectId, replacedEffectId),
			changePitch: () => openEffect(STAFFPAD_EFFECT_TYPES.changePitch),
			changeTempo: () => openEffect(STAFFPAD_EFFECT_TYPES.changeTempo),
			changeSpeedPitch: () => openEffect(STAFFPAD_EFFECT_TYPES.changeSpeedPitch),
			slidingStretch: () => openEffect(STAFFPAD_EFFECT_TYPES.slidingStretch),
		},
		generators: {
			...controllerActions.generators,
			silence: () => openGenerator('silence'),
			tone: () => openGenerator('tone'),
			chirp: () => openGenerator('chirp'),
			dtmf: () => openGenerator('dtmf'),
			noise: () => openGenerator('noise'),
		},
		help: {
			openTutorials: () => ui.openExternal('https://support.audacityteam.org/au4'),
			openManual: () => ui.openExternal('https://support.audacityteam.org/au4'),
			openSupport: () => ui.openExternal('mailto:team@kw.media?subject=Soundscaper%20support'),
			openAbout: () => ui.issue('open-about'),
		},
	};

	return Object.freeze({
		actions: freezeActionTree(runtime),
		uiController,
		dispose() {
			if (!options.uiController) uiController.dispose();
		},
	});
}

function freezeActionTree(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) freezeActionTree(child);
	return Object.freeze(value);
}
