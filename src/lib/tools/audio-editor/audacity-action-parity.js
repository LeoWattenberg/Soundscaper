/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Audacity 4 browser action-parity contract.
 *
 * This inventory is intentionally pinned. Updating it means reviewing the
 * upstream menus and action registrations at the new commit, not merely
 * changing AUDACITY_ACTION_SOURCE.commit.
 */

export const AUDACITY_ACTION_SOURCE = deepFreeze({
	version: '4.0.0-beta.2+',
	commit: '908ad0a526e5bfdab68de780e893cebe172d27eb',
	url: 'https://github.com/audacity/audacity/tree/908ad0a526e5bfdab68de780e893cebe172d27eb/src',
});

export const AUDACITY_ACTION_STATUS = Object.freeze({
	IMPLEMENTED: 'implemented',
	DISABLED_UPSTREAM: 'disabled-upstream',
	EXCLUDED: 'excluded',
});

const UPSTREAM = Object.freeze({
	application: 'src/appshell/internal/applicationuiactions.cpp',
	menu: 'src/appshell/qml/Audacity/AppShell/appmenumodel.cpp',
	project: 'src/project/internal/projectuiactions.cpp',
	trackEdit: 'src/trackedit/internal/trackedituiactions.cpp',
	projectScene: 'src/projectscene/internal/projectsceneuiactions.cpp',
	playback: 'src/playback/internal/playbackuiactions.cpp',
	record: 'src/record/internal/recorduiactions.cpp',
	effects: 'src/effects/effects_base/internal/effectsuiactions.cpp',
	builtinEffects: 'src/effects/builtin_collection/internal/builtincollectionloader.cpp',
	spectrogram: 'src/spectrogram/internal/spectrogramuiactions.cpp',
});

const DISABLED_REASONS = deepFreeze({
	menu: {
		en: 'This command is disabled in the pinned Audacity 4 menu.',
		de: 'Dieser Befehl ist im festgelegten Audacity-4-Menü deaktiviert.',
	},
	todo: {
		en: 'Audacity 4 declares this command but does not provide a usable handler yet.',
		de: 'Audacity 4 deklariert diesen Befehl, stellt aber noch keine nutzbare Aktion bereit.',
	},
	local: {
		en: 'This existing editor command remains available as a disabled placeholder.',
		de: 'Dieser bestehende Editor-Befehl bleibt als deaktivierter Platzhalter erhalten.',
	},
	state: {
		en: 'This command is unavailable in the current editor state.',
		de: 'Dieser Befehl ist im aktuellen Editor-Zustand nicht verfügbar.',
	},
	pending: {
		en: 'This Audacity 4 parity command is not connected in this build yet.',
		de: 'Dieser Audacity-4-Paritätsbefehl ist in diesem Build noch nicht angebunden.',
	},
});

const EXCLUDED_REASONS = deepFreeze({
	cloud: {
		en: 'Cloud, account, sharing, and audio.com features are outside the browser editor scope.',
		de: 'Cloud-, Konto-, Freigabe- und audio.com-Funktionen gehören nicht zum Umfang des Browser-Editors.',
	},
	plugins: {
		en: 'External plugin and Nyquist support is intentionally omitted.',
		de: 'Externe Plugins und Nyquist-Unterstützung werden bewusst nicht übernommen.',
	},
	os: {
		en: 'Operating-system audio, device, and application-lifecycle settings are intentionally omitted.',
		de: 'Betriebssystem-, Audio-Geräte- und Anwendungsoptionen werden bewusst nicht übernommen.',
	},
	developer: {
		en: 'Hidden Extra, diagnostic, benchmark, and developer scaffolding is intentionally omitted.',
		de: 'Verborgene Extra-, Diagnose-, Benchmark- und Entwicklerfunktionen werden bewusst nicht übernommen.',
	},
	midi: {
		en: 'MIDI tracks are outside the browser editor scope.',
		de: 'MIDI-Spuren gehören nicht zum Umfang des Browser-Editors.',
	},
});

const implemented = (id, label, locations, handler, options = {}) => actionDefinition({
	id,
	label,
	locations,
	handler,
	enableWhen: options.enableWhen || 'always',
	shortcut: options.shortcut ?? null,
	status: AUDACITY_ACTION_STATUS.IMPLEMENTED,
	upstreamAction: options.upstreamAction || id,
	upstreamSource: options.source === undefined ? UPSTREAM.project : options.source,
	origin: options.origin || 'upstream',
});

const disabled = (id, label, locations, reason = DISABLED_REASONS.menu, options = {}) => actionDefinition({
	id,
	label,
	locations,
	handler: null,
	enableWhen: 'never',
	shortcut: options.shortcut ?? null,
	status: AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM,
	upstreamAction: options.upstreamAction || id,
	upstreamSource: options.source === undefined ? UPSTREAM.menu : options.source,
	origin: options.origin || 'upstream',
	reason,
});

const excluded = (id, label, locations, reason, options = {}) => actionDefinition({
	id,
	label,
	locations,
	handler: null,
	enableWhen: 'never',
	shortcut: options.shortcut ?? null,
	status: AUDACITY_ACTION_STATUS.EXCLUDED,
	upstreamAction: options.upstreamAction || id,
	upstreamSource: options.source === undefined ? UPSTREAM.project : options.source,
	origin: options.origin || 'upstream',
	reason,
});

const definitions = [
	// File and project lifecycle.
	implemented('file-new', 'New', ['File'], 'project.create', { shortcut: 'Ctrl+N' }),
	implemented('file-open', 'Open…', ['File'], 'project.open', { shortcut: 'Ctrl+O' }),
	implemented('file-open-recent', 'Open recent', ['File'], 'project.openRecent', { enableWhen: 'recent-projects' }),
	implemented('clear-recent', 'Clear recent projects', ['File > Open recent'], 'project.clearRecent', { enableWhen: 'recent-projects' }),
	implemented('project-import', 'Import audio…', ['File'], 'io.importAudio', { shortcut: 'Ctrl+I' }),
	implemented('file-save', 'Save project', ['File'], 'project.save', { shortcut: 'Ctrl+S', enableWhen: 'project-writable' }),
	implemented('file-save-as', 'Save project as…', ['File'], 'project.saveAs', { shortcut: 'Ctrl+Shift+S', enableWhen: 'project-opened' }),
	implemented('export-audio', 'Export audio…', ['File'], 'io.exportAudio', { shortcut: 'Ctrl+Shift+E', enableWhen: 'project-opened' }),
	implemented('export-labels', 'Export labels…', ['File > Export other'], 'labels.export', { enableWhen: 'label-track-present' }),
	implemented('file-close', 'Close project', ['File'], 'session.closeProject', { shortcut: 'Ctrl+W', enableWhen: 'project-opened' }),
	disabled('export-midi', 'Export MIDI…', ['File > Export other'], DISABLED_REASONS.menu, { source: UPSTREAM.menu }),
	disabled('insert', 'Insert', ['Command inventory'], DISABLED_REASONS.todo, { source: UPSTREAM.project }),
	disabled('project-properties', 'Project properties…', ['File'], DISABLED_REASONS.todo, { source: UPSTREAM.project }),
	disabled('revert-factory', 'Revert to factory settings', ['Help'], DISABLED_REASONS.todo, { source: UPSTREAM.application }),
	implemented('toggle-transport', 'Playback controls', ['View > Toolbars'], 'workspace.toggleTransportToolbar', { source: UPSTREAM.application }),
	implemented('toggle-tracks', 'Tracks panel', ['View > Panels'], 'workspace.toggleTracksPanel', { source: UPSTREAM.application, enableWhen: 'project-opened' }),
	implemented('toggle-statusbar', 'Status bar', ['View'], 'workspace.toggleStatusbar', { source: UPSTREAM.application, enableWhen: 'project-opened' }),
	implemented('configure-workspaces', 'Configure workspaces…', ['View > Workspaces'], 'workspace.configure', { source: UPSTREAM.menu }),

	// Edit menu and destructive/ripple variants.
	implemented('action://trackedit/undo', 'Undo', ['Edit'], 'edit.undo', { shortcut: 'Ctrl+Z', enableWhen: 'history-can-undo', source: UPSTREAM.trackEdit }),
	implemented('action://trackedit/redo', 'Redo', ['Edit'], 'edit.redo', { shortcut: 'Ctrl+Shift+Z', enableWhen: 'history-can-redo', source: UPSTREAM.trackEdit }),
	implemented('action://cut', 'Cut', ['Edit'], 'edit.cut', { shortcut: 'Ctrl+X', enableWhen: 'editable-selection', source: UPSTREAM.trackEdit }),
	implemented('action://copy', 'Copy', ['Edit'], 'edit.copy', { shortcut: 'Ctrl+C', enableWhen: 'selection', source: UPSTREAM.trackEdit }),
	implemented('action://paste', 'Paste', ['Edit'], 'edit.paste', { shortcut: 'Ctrl+V', enableWhen: 'clipboard-and-project-writable', source: UPSTREAM.trackEdit }),
	implemented('action://delete', 'Delete', ['Edit', 'Clip context'], 'edit.delete', { shortcut: 'Delete', enableWhen: 'editable-selection-or-clip', source: UPSTREAM.trackEdit }),
	implemented('duplicate', 'Duplicate', ['Edit'], 'edit.duplicate', { shortcut: 'Ctrl+D', enableWhen: 'editable-selection-or-clip', source: UPSTREAM.trackEdit }),
	implemented('action://trackedit/paste-overlap', 'Paste and overlap', ['Edit > Paste special'], 'edit.pasteOverlap', { enableWhen: 'clipboard-and-project-writable', source: UPSTREAM.trackEdit }),
	implemented('action://trackedit/paste-insert', 'Paste and insert', ['Edit > Paste special'], 'edit.pasteInsert', { enableWhen: 'clipboard-and-project-writable', source: UPSTREAM.trackEdit }),
	implemented('action://trackedit/paste-insert-all-tracks-ripple', 'Paste and preserve synchronization', ['Edit > Paste special'], 'edit.pasteAllTracksRipple', { enableWhen: 'clipboard-and-project-writable', source: UPSTREAM.trackEdit }),
	implemented('cut-leave-gap', 'Cut and leave gap', ['Edit > Remove special'], 'edit.cutLeaveGap', { enableWhen: 'editable-selection', source: UPSTREAM.trackEdit }),
	implemented('cut-per-clip-ripple', 'Cut and close gap per clip', ['Edit > Remove special'], 'edit.cutPerClipRipple', { enableWhen: 'editable-selection', source: UPSTREAM.trackEdit }),
	implemented('cut-per-track-ripple', 'Cut and close gap per track', ['Edit > Remove special'], 'edit.cutPerTrackRipple', { enableWhen: 'editable-selection', source: UPSTREAM.trackEdit }),
	implemented('cut-all-tracks-ripple', 'Cut and close gap on all tracks', ['Edit > Remove special'], 'edit.cutAllTracksRipple', { enableWhen: 'editable-selection', source: UPSTREAM.trackEdit }),
	implemented('delete-leave-gap', 'Delete and leave gap', ['Edit > Remove special'], 'edit.deleteLeaveGap', { enableWhen: 'editable-selection', source: UPSTREAM.trackEdit }),
	implemented('delete-per-clip-ripple', 'Delete and close gap per clip', ['Edit > Remove special'], 'edit.deletePerClipRipple', { enableWhen: 'editable-selection', source: UPSTREAM.trackEdit }),
	implemented('delete-per-track-ripple', 'Delete and close gap per track', ['Edit > Remove special'], 'edit.deletePerTrackRipple', { enableWhen: 'editable-selection', source: UPSTREAM.trackEdit }),
	implemented('delete-all-tracks-ripple', 'Delete and close gap on all tracks', ['Edit > Remove special'], 'edit.deleteAllTracksRipple', { enableWhen: 'editable-selection', source: UPSTREAM.trackEdit }),
	implemented('trim-audio-outside-selection', 'Trim audio outside selection', ['Edit > Remove special'], 'edit.trimOutsideSelection', { enableWhen: 'editable-selection', source: UPSTREAM.trackEdit }),
	implemented('silence-audio-selection', 'Silence audio selection', ['Edit > Remove special'], 'edit.silenceSelection', { enableWhen: 'editable-selection', source: UPSTREAM.trackEdit }),
	implemented('split', 'Split', ['Edit > Clip', 'Clip context'], 'edit.split', { shortcut: 'S', enableWhen: 'editable-selection-or-clip', source: UPSTREAM.trackEdit }),
	implemented('split-into-new-track', 'Split into new track', ['Edit > Clip'], 'edit.splitIntoNewTrack', { enableWhen: 'editable-selection-or-clip', source: UPSTREAM.project }),
	implemented('join', 'Join selected clips', ['Edit > Clip'], 'edit.join', { enableWhen: 'multiple-editable-clips', source: UPSTREAM.trackEdit }),
	implemented('disjoin', 'Split clips at silences', ['Edit > Clip'], 'edit.disjoin', { enableWhen: 'editable-selection-or-clip', source: UPSTREAM.trackEdit }),
	implemented('group-clips', 'Group clips', ['Edit > Clip', 'Clip context'], 'clip.group', { enableWhen: 'multiple-editable-clips', source: UPSTREAM.trackEdit }),
	implemented('ungroup-clips', 'Ungroup clips', ['Edit > Clip', 'Clip context'], 'clip.ungroup', { enableWhen: 'grouped-editable-clips', source: UPSTREAM.trackEdit }),
	implemented('rename-item', 'Rename clip', ['Edit > Clip'], 'clip.rename', { enableWhen: 'clip-selected' }),
	implemented('trim-clip', 'Trim clip', ['Edit > Clip'], 'clip.trim', { enableWhen: 'clip-selected' }),
	implemented('label-add', 'Add label', ['Edit > Label'], 'labels.add', { enableWhen: 'project-writable', source: UPSTREAM.trackEdit }),
	implemented('paste-new-label', 'Paste text to new label', ['Edit > Label'], 'labels.pasteNew', { enableWhen: 'project-writable', source: UPSTREAM.project }),
	implemented('open-label-editor', 'Manage labels…', ['Edit > Label', 'View'], 'panels.labels', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('open-metadata-editor', 'Metadata editor…', ['Edit', 'View'], 'panels.metadata', { enableWhen: 'project-opened' }),
	implemented('preference-dialog', 'Preferences…', ['Edit'], 'preferences.open', { enableWhen: 'always' }),

	// Selection and looping.
	implemented('select-all', 'Select all', ['Select'], 'selection.all', { shortcut: 'Ctrl+A', enableWhen: 'project-has-audio' }),
	implemented('clear-selection', 'Select none', ['Select'], 'selection.clear', { shortcut: 'Ctrl+Shift+A', enableWhen: 'selection' }),
	implemented('select-all-tracks', 'Select all tracks', ['Select'], 'selection.allTracks', { enableWhen: 'project-opened' }),
	implemented('select-left-of-playback-position', 'Left at playback position', ['Select > Region'], 'selection.leftAtPlayback', { enableWhen: 'project-opened' }),
	implemented('select-right-of-playback-position', 'Right at playback position', ['Select > Region'], 'selection.rightAtPlayback', { enableWhen: 'project-opened' }),
	implemented('select-track-start-to-cursor', 'Track start to cursor', ['Select > Region'], 'selection.trackStartToCursor', { enableWhen: 'project-opened' }),
	implemented('select-cursor-to-track-end', 'Cursor to track end', ['Select > Region'], 'selection.cursorToTrackEnd', { enableWhen: 'project-opened' }),
	implemented('select-track-start-to-end', 'Track start to end', ['Select > Region'], 'selection.trackStartToEnd', { enableWhen: 'project-opened' }),
	implemented('toggle-loop-region', 'Loop region', ['Select > Looping', 'Transport'], 'transport.toggleLoop', { shortcut: 'L', enableWhen: 'project-opened', source: UPSTREAM.playback }),
	implemented('clear-loop-region', 'Clear loop region', ['Select > Looping'], 'transport.clearLoop', { enableWhen: 'loop-region', source: UPSTREAM.playback }),
	implemented('set-loop-region-to-selection', 'Set loop to selection', ['Select > Looping'], 'transport.loopToSelection', { enableWhen: 'selection', source: UPSTREAM.playback }),
	implemented('set-selection-to-loop', 'Set selection to loop', ['Select > Looping'], 'transport.selectionToLoop', { enableWhen: 'loop-region', source: UPSTREAM.playback }),
	implemented('set-loop-region-in-out', 'Set loop in/out', ['Select > Looping'], 'transport.setLoopInOut', { enableWhen: 'project-opened', source: UPSTREAM.playback }),
	implemented('toggle-selection-follows-loop-region', 'Creating a loop also selects audio', ['Select > Looping'], 'transport.toggleSelectionFollowsLoop', { enableWhen: 'project-opened', source: UPSTREAM.playback }),
	implemented('zero-cross', 'At zero crossings', ['Select'], 'selection.zeroCross', { shortcut: 'Z', enableWhen: 'time-selection' }),
	disabled('menu-selection-audio-clips', 'Audio clips', ['Select'], DISABLED_REASONS.menu),
	disabled('select-previous-clip-boundary-to-cursor', 'Previous clip boundary to cursor', ['Select > Audio clips'], DISABLED_REASONS.menu),
	disabled('select-cursor-to-next-clip-boundary', 'Cursor to next clip boundary', ['Select > Audio clips'], DISABLED_REASONS.menu),
	disabled('select-previous-clip', 'Previous clip', ['Select > Audio clips'], DISABLED_REASONS.menu),
	disabled('select-next-clip', 'Next clip', ['Select > Audio clips'], DISABLED_REASONS.menu),
	disabled('menu-selection-spectral', 'Spectral', ['Select'], DISABLED_REASONS.menu),
	disabled('toggle-spectral-selection', 'Spectral selection', ['Select > Spectral'], DISABLED_REASONS.menu),

	// View, rulers, and panels.
	implemented('zoom-in', 'Zoom in', ['View > Zoom'], 'timeline.zoomIn', { shortcut: 'Ctrl+1', enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('zoom-out', 'Zoom out', ['View > Zoom'], 'timeline.zoomOut', { shortcut: 'Ctrl+3', enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('zoom-default', 'Zoom normal', ['View > Zoom'], 'timeline.zoomDefault', { shortcut: 'Ctrl+2', enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('zoom-to-selection', 'Zoom to selection', ['View > Zoom'], 'timeline.zoomSelection', { enableWhen: 'selection', source: UPSTREAM.projectScene }),
	implemented('zoom-toggle', 'Zoom toggle', ['View > Zoom'], 'timeline.zoomToggle', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('zoom-to-fit-project', 'Fit project to width', ['View > Zoom'], 'timeline.zoomFit', { shortcut: 'Ctrl+F', enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('center-view-on-playhead', 'Center view on playhead', ['View > Zoom'], 'timeline.centerOnPlayhead', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('collapse-all-tracks', 'Collapse all tracks', ['View > Zoom'], 'track.collapseAll', { enableWhen: 'project-opened' }),
	implemented('expand-all-tracks', 'Expand all tracks', ['View > Zoom'], 'track.expandAll', { enableWhen: 'project-opened' }),
	implemented('toggle-effects', 'Effects', ['View'], 'panels.effects', { enableWhen: 'project-opened' }),
	implemented('toggle-history', 'History', ['View'], 'panels.history', { enableWhen: 'project-opened' }),
	implemented('fullscreen', 'Fullscreen', ['View'], 'workspace.fullscreen', { shortcut: 'F11', source: UPSTREAM.menu }),
	implemented('toggle-clipping-in-waveform', 'Show clipping in waveform', ['View'], 'view.toggleClipping', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('toggle-rms-in-waveform', 'Show RMS in waveform', ['View'], 'view.toggleRms', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('toggle-vertical-rulers', 'Show vertical rulers', ['View'], 'view.toggleVerticalRulers', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('dock-restore-default-layout', 'Reset layout', ['View'], 'workspace.restoreDefault', { source: UPSTREAM.menu }),
	implemented('action://trackedit/global-view-spectrogram', 'Toggle spectral view', ['View', 'Tools toolbar'], 'view.toggleGlobalSpectrogram', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('snap', 'Snapping', ['Selection toolbar'], 'timeline.configureSnap', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('minutes-seconds-ruler', 'Minutes and seconds ruler', ['Timeline ruler'], 'timeline.setSecondsRuler', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('beats-measures-ruler', 'Beats and measures ruler', ['Timeline ruler'], 'timeline.setMusicalRuler', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('show-master-track', 'Show master track', ['View'], 'workspace.toggleMasterTrack', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('toggle-update-display-while-playing', 'Update display while playing', ['View'], 'timeline.toggleUpdateWhilePlaying', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('toggle-pinned-play-head', 'Pinned playhead', ['View'], 'timeline.togglePinnedPlayhead', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('toggle-playback-on-ruler-click-enabled', 'Click ruler to start playback', ['Timeline ruler'], 'timeline.toggleRulerPlayback', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	disabled('menu-skip', 'Skip to', ['View'], DISABLED_REASONS.menu),
	disabled('skip-to-selection-start', 'Selection start', ['View > Skip to'], DISABLED_REASONS.menu),
	disabled('skip-to-selection-end', 'Selection end', ['View > Skip to'], DISABLED_REASONS.menu),

	// Recording and transport. Browser implementations use the default permitted microphone.
	implemented('record-on-current-track', 'Record on current track', ['Record', 'Transport'], 'recording.startCurrentTrack', { shortcut: 'R', enableWhen: 'project-writable-and-not-recording', source: UPSTREAM.record }),
	implemented('record-on-new-track', 'Record on new track', ['Record'], 'recording.startNewTrack', { shortcut: 'Shift+R', enableWhen: 'project-writable-and-not-recording', source: UPSTREAM.record }),
	implemented('action://record/lead-in-recording', 'Lead-in recording', ['Record'], 'recording.toggleLeadIn', { enableWhen: 'not-recording', source: UPSTREAM.record }),
	implemented('action://record/pause', 'Pause recording', ['Record', 'Transport'], 'recording.pause', { enableWhen: 'recording', source: UPSTREAM.record }),
	implemented('action://record/stop', 'Stop recording', ['Record', 'Transport'], 'recording.stop', { enableWhen: 'recording', source: UPSTREAM.record }),
	implemented('action://playback/play', 'Play', ['Transport'], 'transport.playPause', { shortcut: 'Space', enableWhen: 'project-opened', source: UPSTREAM.playback }),
	implemented('action://playback/pause', 'Pause', ['Transport'], 'transport.pause', { enableWhen: 'playing', source: UPSTREAM.playback }),
	implemented('action://playback/stop', 'Stop', ['Transport'], 'transport.stop', { enableWhen: 'playing-or-recording', source: UPSTREAM.playback }),
	implemented('action://playback/rewind-start', 'Skip to start', ['Transport'], 'transport.jumpStart', { enableWhen: 'project-opened', source: UPSTREAM.playback }),
	implemented('action://playback/rewind-end', 'Skip to end', ['Transport'], 'transport.jumpEnd', { enableWhen: 'project-opened', source: UPSTREAM.playback }),
	implemented('metronome', 'Metronome', ['Transport'], 'transport.toggleMetronome', { enableWhen: 'project-opened', source: UPSTREAM.playback }),
	implemented('playback-time', 'Playback time', ['Transport toolbar'], 'transport.setPlaybackTime', { enableWhen: 'project-opened', source: UPSTREAM.playback }),
	implemented('playback-bpm', 'Project tempo', ['Transport toolbar'], 'project.setTempo', { enableWhen: 'project-writable', source: UPSTREAM.playback }),
	implemented('playback-time-signature', 'Time signature', ['Transport toolbar'], 'project.setTimeSignature', { enableWhen: 'project-writable', source: UPSTREAM.playback }),
	implemented('action://playback/level', 'Playback level', ['Mixer toolbar'], 'mixer.setPlaybackLevel', { enableWhen: 'project-opened', source: UPSTREAM.playback }),
	implemented('repeat', 'Play repeats', ['Transport'], 'transport.toggleLoop', { enableWhen: 'project-opened', source: UPSTREAM.playback }),
	implemented('pan', 'Automatically follow playback', ['Transport'], 'timeline.togglePinnedPlayhead', { enableWhen: 'project-opened', source: UPSTREAM.playback }),
	implemented('action://record/level', 'Record level', ['Meter toolbar'], 'recording.setLevel', { enableWhen: 'project-opened', source: UPSTREAM.record }),
	implemented('action://record/toggle-mic-metering', 'Show microphone metering', ['Meter toolbar'], 'recording.toggleMicMetering', { enableWhen: 'project-opened', source: UPSTREAM.record }),
	implemented('action://record/toggle-input-monitoring', 'Input monitoring', ['Meter toolbar'], 'recording.toggleInputMonitoring', { enableWhen: 'project-opened', source: UPSTREAM.record }),
	disabled('set-up-timed-recording', 'Set up timed recording…', ['Record'], DISABLED_REASONS.todo, { source: UPSTREAM.menu }),
	disabled('toggle-sound-activated-recording', 'Sound-activated recording', ['Record'], DISABLED_REASONS.todo, { source: UPSTREAM.menu }),
	disabled('set-sound-activation-level', 'Sound activation level…', ['Record'], DISABLED_REASONS.todo, { source: UPSTREAM.menu }),

	// Tracks and track context actions.
	implemented('new-mono-track', 'New mono track', ['Tracks'], 'track.addMono', { enableWhen: 'project-writable', source: UPSTREAM.trackEdit }),
	implemented('new-stereo-track', 'New stereo track', ['Tracks'], 'track.addStereo', { enableWhen: 'project-writable', source: UPSTREAM.trackEdit }),
	implemented('new-label-track', 'New label track', ['Tracks'], 'track.addLabel', { enableWhen: 'project-writable', source: UPSTREAM.trackEdit }),
	implemented('duplicate-track', 'Duplicate track', ['Tracks', 'Track context'], 'track.duplicate', { enableWhen: 'editable-audio-track-selected' }),
	implemented('remove-tracks', 'Remove tracks', ['Tracks', 'Track context'], 'track.removeSelected', { enableWhen: 'editable-track-selected' }),
	implemented('track-rename', 'Rename track', ['Track context'], 'track.rename', { enableWhen: 'editable-track-selected', source: UPSTREAM.trackEdit }),
	implemented('track-move-up', 'Move track up', ['Track context'], 'track.moveUp', { enableWhen: 'editable-track-selected', source: UPSTREAM.trackEdit }),
	implemented('track-move-down', 'Move track down', ['Track context'], 'track.moveDown', { enableWhen: 'editable-track-selected', source: UPSTREAM.trackEdit }),
	implemented('track-move-top', 'Move track to top', ['Track context'], 'track.moveTop', { enableWhen: 'editable-track-selected', source: UPSTREAM.trackEdit }),
	implemented('track-move-bottom', 'Move track to bottom', ['Track context'], 'track.moveBottom', { enableWhen: 'editable-track-selected', source: UPSTREAM.trackEdit }),
	implemented('track-make-stereo', 'Make stereo track', ['Track context'], 'track.makeStereo', { enableWhen: 'compatible-mono-tracks', source: UPSTREAM.trackEdit }),
	implemented('track-swap-channels', 'Swap stereo channels', ['Track context'], 'track.swapChannels', { enableWhen: 'stereo-track-selected', source: UPSTREAM.trackEdit }),
	implemented('track-split-stereo-to-lr', 'Split stereo to L/R mono', ['Track context'], 'track.splitStereoLR', { enableWhen: 'stereo-track-selected', source: UPSTREAM.trackEdit }),
	implemented('track-split-stereo-to-center', 'Split stereo to center mono', ['Track context'], 'track.splitStereoCenter', { enableWhen: 'stereo-track-selected', source: UPSTREAM.trackEdit }),
	implemented('track-resample', 'Resample track…', ['Track context'], 'track.resample', { enableWhen: 'editable-audio-track-selected', source: UPSTREAM.trackEdit }),
	implemented('action://trackedit/track-view-waveform', 'Waveform', ['Track context > Display'], 'track.setWaveformView', { enableWhen: 'audio-track-selected', source: UPSTREAM.trackEdit }),
	implemented('action://trackedit/track-view-spectrogram', 'Spectrogram', ['Track context > Display'], 'track.setSpectrogramView', { enableWhen: 'audio-track-selected', source: UPSTREAM.trackEdit }),
	implemented('action://trackedit/track-view-multi', 'Multi-view', ['Track context > Display'], 'track.setMultiView', { enableWhen: 'audio-track-selected', source: UPSTREAM.trackEdit }),
	implemented('track-change-rate-custom', 'Custom track sample rate…', ['Track context > Rate'], 'track.setCustomRate', { enableWhen: 'editable-audio-track-selected', source: UPSTREAM.trackEdit }),
	implemented('action://trackedit/track/change-rate?rate=%1', 'Track sample rate', ['Track context > Rate'], 'track.setRate', { enableWhen: 'editable-audio-track-selected', source: UPSTREAM.trackEdit, upstreamAction: 'dynamic ActionQuery rate action' }),
	implemented('action://trackedit/track/change-format?format=%1', 'Track sample format', ['Track context > Format'], 'track.setSampleFormat', { enableWhen: 'editable-audio-track-selected', source: UPSTREAM.trackEdit, upstreamAction: 'dynamic ActionQuery format action' }),
	implemented('track-spectrogram-settings', 'Spectrogram settings…', ['Track context > Spectrogram'], 'track.openSpectrogramSettings', { enableWhen: 'audio-track-selected', source: UPSTREAM.spectrogram }),
	implemented('action://projectscene/track-view-half-wave', 'Half-wave', ['Track context > Display'], 'track.setHalfWaveView', { enableWhen: 'audio-track-selected', source: UPSTREAM.projectScene }),
	implemented('keep-tracks-synchronised', 'Keep tracks synchronized', ['Tracks'], 'preferences.toggleTrackSynchronization', { enableWhen: 'project-opened', source: UPSTREAM.project }),
	implemented('track-view-item-move-left', 'Move item left', ['Keyboard navigation'], 'navigation.moveItemLeft', { enableWhen: 'editable-clip-selected', source: UPSTREAM.trackEdit }),
	implemented('track-view-item-move-right', 'Move item right', ['Keyboard navigation'], 'navigation.moveItemRight', { enableWhen: 'editable-clip-selected', source: UPSTREAM.trackEdit }),
	implemented('track-view-item-extend-left', 'Extend item left', ['Keyboard navigation'], 'navigation.extendItemLeft', { enableWhen: 'editable-clip-selected', source: UPSTREAM.trackEdit }),
	implemented('track-view-item-extend-right', 'Extend item right', ['Keyboard navigation'], 'navigation.extendItemRight', { enableWhen: 'editable-clip-selected', source: UPSTREAM.trackEdit }),
	implemented('track-view-item-reduce-left', 'Reduce item from left', ['Keyboard navigation'], 'navigation.reduceItemLeft', { enableWhen: 'editable-clip-selected', source: UPSTREAM.trackEdit }),
	implemented('track-view-item-reduce-right', 'Reduce item from right', ['Keyboard navigation'], 'navigation.reduceItemRight', { enableWhen: 'editable-clip-selected', source: UPSTREAM.trackEdit }),
	implemented('track-view-item-move-up', 'Move item up', ['Keyboard navigation'], 'navigation.moveItemUp', { enableWhen: 'editable-clip-selected', source: UPSTREAM.trackEdit }),
	implemented('track-view-item-move-down', 'Move item down', ['Keyboard navigation'], 'navigation.moveItemDown', { enableWhen: 'editable-clip-selected', source: UPSTREAM.trackEdit }),
	implemented('track-view-next-panel', 'Next panel', ['Keyboard navigation'], 'navigation.nextPanel', { enableWhen: 'project-opened', source: UPSTREAM.trackEdit }),
	implemented('track-view-prev-panel', 'Previous panel', ['Keyboard navigation'], 'navigation.previousPanel', { enableWhen: 'project-opened', source: UPSTREAM.trackEdit }),
	implemented('track-view-next-item', 'Next item', ['Keyboard navigation'], 'navigation.nextItem', { enableWhen: 'project-opened', source: UPSTREAM.trackEdit }),
	implemented('track-view-prev-item', 'Previous item', ['Keyboard navigation'], 'navigation.previousItem', { enableWhen: 'project-opened', source: UPSTREAM.trackEdit }),
	implemented('track-view-above-item', 'Item above', ['Keyboard navigation'], 'navigation.itemAbove', { enableWhen: 'project-opened', source: UPSTREAM.trackEdit }),
	implemented('track-view-below-item', 'Item below', ['Keyboard navigation'], 'navigation.itemBelow', { enableWhen: 'project-opened', source: UPSTREAM.trackEdit }),
	implemented('track-view-first-track', 'First track', ['Keyboard navigation'], 'navigation.firstTrack', { enableWhen: 'project-opened', source: UPSTREAM.trackEdit }),
	implemented('track-view-last-track', 'Last track', ['Keyboard navigation'], 'navigation.lastTrack', { enableWhen: 'project-opened', source: UPSTREAM.trackEdit }),
	implemented('track-view-replace-selection', 'Replace track selection', ['Keyboard navigation'], 'navigation.replaceSelection', { enableWhen: 'project-opened', source: UPSTREAM.trackEdit }),
	implemented('track-view-toggle-selection', 'Toggle track selection', ['Keyboard navigation'], 'navigation.toggleSelection', { enableWhen: 'project-opened', source: UPSTREAM.trackEdit }),
	implemented('track-view-range-selection', 'Range track selection', ['Keyboard navigation'], 'navigation.rangeSelection', { enableWhen: 'project-opened', source: UPSTREAM.trackEdit }),
	implemented('track-view-extend-track-selection-prev', 'Extend track selection up', ['Keyboard navigation'], 'navigation.extendTrackSelectionUp', { enableWhen: 'project-opened', source: UPSTREAM.trackEdit }),
	implemented('track-view-extend-track-selection-next', 'Extend track selection down', ['Keyboard navigation'], 'navigation.extendTrackSelectionDown', { enableWhen: 'project-opened', source: UPSTREAM.trackEdit }),
	implemented('track-view-item-context-menu', 'Open item context menu', ['Keyboard navigation'], 'navigation.openContextMenu', { enableWhen: 'project-opened', source: UPSTREAM.trackEdit }),
	disabled('mixdown-to', 'Mix-down to…', ['Tracks'], DISABLED_REASONS.todo, { source: UPSTREAM.project }),
	disabled('menu-align', 'Align content', ['Tracks'], DISABLED_REASONS.menu),
	disabled('align-end-to-end', 'Align end to end', ['Tracks > Align content'], DISABLED_REASONS.menu),
	disabled('align-together', 'Align together', ['Tracks > Align content'], DISABLED_REASONS.menu),
	disabled('align-start-to-zero', 'Align start to zero', ['Tracks > Align content'], DISABLED_REASONS.menu),
	disabled('align-start-to-playhead', 'Align start to playhead', ['Tracks > Align content'], DISABLED_REASONS.menu),
	disabled('align-start-to-selection-end', 'Align start to selection end', ['Tracks > Align content'], DISABLED_REASONS.menu),
	disabled('align-end-to-playhead', 'Align end to playhead', ['Tracks > Align content'], DISABLED_REASONS.menu),
	disabled('align-end-to-selection-end', 'Align end to selection end', ['Tracks > Align content'], DISABLED_REASONS.menu),
	disabled('menu-sort', 'Sort tracks', ['Tracks'], DISABLED_REASONS.menu),
	disabled('sort-by-time', 'Sort by time', ['Tracks > Sort tracks'], DISABLED_REASONS.menu),
	disabled('sort-by-name', 'Sort by name', ['Tracks > Sort tracks'], DISABLED_REASONS.menu),

	// Clip properties and spectral tools.
	implemented('clip-properties', 'Clip properties…', ['Clip context'], 'clip.openProperties', { enableWhen: 'clip-selected', source: UPSTREAM.projectScene }),
	implemented('split-tool', 'Split tool', ['Tools toolbar'], 'tools.toggleSplitTool', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('clip-gain', 'Clip gain', ['Clip context'], 'clip.setGain', { enableWhen: 'editable-clip-selected', source: UPSTREAM.projectScene }),
	implemented('clip-pitch-speed', 'Pitch and speed…', ['Clip context'], 'clip.openPitchSpeed', { enableWhen: 'editable-clip-selected', source: UPSTREAM.projectScene }),
	implemented('stretch-clip-to-match-tempo', 'Stretch with tempo changes', ['Clip context'], 'clip.toggleStretchToTempo', { enableWhen: 'editable-clip-selected', source: UPSTREAM.trackEdit }),
	implemented('clip-render-pitch-speed', 'Render pitch and speed', ['Clip context'], 'clip.renderPitchSpeed', { enableWhen: 'editable-transformed-clip', source: UPSTREAM.trackEdit }),
	implemented('clip-reset-pitch-speed', 'Reset pitch and speed', ['Clip context'], 'clip.resetPitchSpeed', { enableWhen: 'editable-transformed-clip', source: UPSTREAM.trackEdit }),
	implemented('clip-export', 'Export clip…', ['Clip context'], 'io.exportClip', { enableWhen: 'clip-selected', source: UPSTREAM.trackEdit }),
	implemented('action://trackedit/clip/change-color-auto', 'Follow track color', ['Clip context > Color'], 'clip.useTrackColor', { enableWhen: 'editable-clip-selected', source: UPSTREAM.projectScene }),
	implemented('action://trackedit/clip/change-color?colorindex=%1', 'Change clip color', ['Clip context > Color'], 'clip.setColor', { enableWhen: 'editable-clip-selected', source: UPSTREAM.projectScene, upstreamAction: 'dynamic ActionQuery clip-color action' }),
	implemented('action://trackedit/track/change-color?colorindex=%1', 'Change track color', ['Track context > Color'], 'track.setColor', { enableWhen: 'editable-track-selected', source: UPSTREAM.projectScene, upstreamAction: 'dynamic ActionQuery track-color action' }),
	implemented('play-position-decrease', 'Move play cursor left', ['Keyboard navigation'], 'timeline.nudgePlayheadLeft', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('play-position-increase', 'Move play cursor right', ['Keyboard navigation'], 'timeline.nudgePlayheadRight', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('sel-ext-left', 'Extend selection left', ['Keyboard navigation'], 'selection.extendLeft', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('sel-ext-right', 'Extend selection right', ['Keyboard navigation'], 'selection.extendRight', { enableWhen: 'project-opened', source: UPSTREAM.projectScene }),
	implemented('sel-cntr-left', 'Contract selection from left', ['Keyboard navigation'], 'selection.contractLeft', { enableWhen: 'time-selection', source: UPSTREAM.projectScene }),
	implemented('sel-cntr-right', 'Contract selection from right', ['Keyboard navigation'], 'selection.contractRight', { enableWhen: 'time-selection', source: UPSTREAM.projectScene }),
	implemented('spectral-box-select', 'Spectral box select', ['Tools toolbar'], 'spectral.boxSelect', { enableWhen: 'spectrogram-track-selected', source: UPSTREAM.projectScene }),
	implemented('spectral-delete', 'Spectral delete', ['Effect > Spectral'], 'spectral.delete', { enableWhen: 'editable-frequency-selection', source: UPSTREAM.builtinEffects }),
	implemented('spectral-amplify', 'Spectral amplify', ['Effect > Spectral'], 'spectral.amplify', { enableWhen: 'editable-frequency-selection', source: UPSTREAM.builtinEffects }),
	disabled('spectral-brush', 'Spectral brush', ['Tools toolbar'], DISABLED_REASONS.todo, { source: UPSTREAM.projectScene }),

	// Built-in effect menus use dynamically generated upstream action URIs. These
	// stable browser IDs are reconciled with the separate effect parameter manifest.
	implemented('effect://builtin/processors', 'Built-in processors', ['Effect'], 'effects.openProcessor', { enableWhen: 'editable-selection', source: UPSTREAM.builtinEffects, upstreamAction: 'dynamic processor action' }),
	implemented('effect://builtin/generators', 'Built-in generators', ['Generate'], 'effects.openGenerator', { enableWhen: 'project-writable', source: UPSTREAM.builtinEffects, upstreamAction: 'dynamic generator action' }),
	implemented('add-realtime-effects', 'Add track effects', ['Effect'], 'effects.openRealtimeRack', { enableWhen: 'audio-track-selected', source: UPSTREAM.effects }),
	implemented('repeat-last-effect', 'Repeat last effect', ['Effect'], 'effects.repeatLast', { enableWhen: 'repeatable-effect-and-editable-selection', source: UPSTREAM.effects }),
	implemented('realtimeeffect-remove', 'Remove realtime effect', ['Realtime effect context'], 'effects.removeRealtime', { enableWhen: 'realtime-effect-selected', source: UPSTREAM.effects }),
	implemented('realtime-effect-move-up', 'Move realtime effect up', ['Realtime effect context'], 'effects.moveRealtimeUp', { enableWhen: 'realtime-effect-can-move-up', source: UPSTREAM.projectScene }),
	implemented('realtime-effect-move-down', 'Move realtime effect down', ['Realtime effect context'], 'effects.moveRealtimeDown', { enableWhen: 'realtime-effect-can-move-down', source: UPSTREAM.projectScene }),
	implemented('action://effects/presets/apply', 'Apply preset', ['Effect dialog > Presets'], 'effects.presets.apply', { enableWhen: 'effect-preset-selected', source: UPSTREAM.effects }),
	implemented('action://effects/presets/save_as', 'Save preset as…', ['Effect dialog > Presets'], 'effects.presets.saveAs', { enableWhen: 'effect-opened', source: UPSTREAM.effects }),
	implemented('action://effects/presets/save', 'Save preset', ['Effect dialog > Presets'], 'effects.presets.save', { enableWhen: 'editable-effect-preset-selected', source: UPSTREAM.effects }),
	implemented('action://effects/presets/delete', 'Delete preset', ['Effect dialog > Presets'], 'effects.presets.delete', { enableWhen: 'editable-effect-preset-selected', source: UPSTREAM.effects }),
	implemented('action://effects/presets/import', 'Import preset…', ['Effect dialog > Presets'], 'effects.presets.import', { enableWhen: 'effect-opened', source: UPSTREAM.effects }),
	implemented('action://effects/presets/export', 'Export preset…', ['Effect dialog > Presets'], 'effects.presets.export', { enableWhen: 'effect-preset-selected', source: UPSTREAM.effects }),
	implemented('action://effects/open?effectId=%1', 'Open effect', ['Generate', 'Effect', 'Analyze', 'Tools'], 'effects.openById', { enableWhen: 'project-opened', source: UPSTREAM.effects, upstreamAction: 'dynamic ActionQuery effect action' }),
	implemented('action://effects/realtime-add?effectId=%1', 'Add realtime effect', ['Realtime effect rack'], 'effects.addRealtimeById', { enableWhen: 'audio-track-selected', source: UPSTREAM.effects, upstreamAction: 'dynamic ActionQuery realtime-add action' }),
	implemented('action://effects/realtime-replace?effectId=%1', 'Replace realtime effect', ['Realtime effect context'], 'effects.replaceRealtimeById', { enableWhen: 'realtime-effect-selected', source: UPSTREAM.effects, upstreamAction: 'dynamic ActionQuery realtime-replace action' }),
	implemented('effect://builtin/change-pitch', 'Change pitch…', ['Effect > Pitch and tempo'], 'effects.changePitch', { enableWhen: 'editable-selection', source: UPSTREAM.builtinEffects, upstreamAction: 'dynamic Change Pitch effect action' }),
	implemented('effect://builtin/change-tempo', 'Change tempo…', ['Effect > Pitch and tempo'], 'effects.changeTempo', { enableWhen: 'editable-selection', source: 'au3/lib-src/au3-time-and-pitch/StaffPad/TimeAndPitch.cpp', upstreamAction: 'legacy Change Tempo effect adapted to StaffPad' }),
	implemented('effect://builtin/change-speed-pitch', 'Change speed and pitch…', ['Effect > Pitch and tempo'], 'effects.changeSpeedPitch', { enableWhen: 'editable-selection', source: 'au3/lib-src/au3-time-and-pitch/StaffPad/TimeAndPitch.cpp', upstreamAction: 'legacy Change Speed and Pitch effect adapted to StaffPad' }),
	implemented('effect://builtin/sliding-stretch', 'Sliding stretch…', ['Effect > Pitch and tempo'], 'effects.slidingStretch', { enableWhen: 'editable-selection', source: UPSTREAM.builtinEffects, upstreamAction: 'dynamic Sliding Stretch effect action' }),
	implemented('generator://silence', 'Silence…', ['Generate'], 'generators.silence', { enableWhen: 'project-writable', source: UPSTREAM.builtinEffects, upstreamAction: 'dynamic Silence effect action' }),
	implemented('generator://tone', 'Tone…', ['Generate'], 'generators.tone', { enableWhen: 'project-writable', source: UPSTREAM.builtinEffects, upstreamAction: 'dynamic Tone effect action' }),
	implemented('generator://chirp', 'Chirp…', ['Generate'], 'generators.chirp', { enableWhen: 'project-writable', source: UPSTREAM.builtinEffects, upstreamAction: 'dynamic Chirp effect action' }),
	implemented('generator://dtmf', 'DTMF tones…', ['Generate'], 'generators.dtmf', { enableWhen: 'project-writable', source: UPSTREAM.builtinEffects, upstreamAction: 'dynamic DTMF effect action' }),
	implemented('generator://noise', 'Noise…', ['Generate'], 'generators.noise', { enableWhen: 'project-writable', source: UPSTREAM.builtinEffects, upstreamAction: 'dynamic Noise effect action' }),
	implemented('contrast-analyzer', 'Contrast…', ['Analyze'], 'analysis.contrast', { enableWhen: 'audio-selection' }),
	implemented('plot-spectrum', 'Plot spectrum…', ['Analyze'], 'analysis.plotSpectrum', { enableWhen: 'audio-selection' }),
	implemented('find-clipping', 'Find clipping…', ['Analyze'], 'analysis.findClipping', { enableWhen: 'audio-selection', source: UPSTREAM.builtinEffects, upstreamAction: 'dynamic Find Clipping effect action' }),

	// Upstream TODO commands retained as visible, inert entries.
	disabled('favourite-effect-1', 'Favorite effect 1', ['Effect'], DISABLED_REASONS.todo, { source: UPSTREAM.project }),
	disabled('favourite-effect-2', 'Favorite effect 2', ['Effect'], DISABLED_REASONS.todo, { source: UPSTREAM.project }),
	disabled('favourite-effect-3', 'Favorite effect 3', ['Effect'], DISABLED_REASONS.todo, { source: UPSTREAM.project }),
	disabled('manage-macros', 'Manage macros…', ['Tools'], DISABLED_REASONS.todo, { source: UPSTREAM.menu }),
	disabled('menu-macros', 'Macros', ['Tools'], DISABLED_REASONS.menu),
	disabled('apply-macros-palette', 'Apply macro…', ['Tools > Macros'], DISABLED_REASONS.menu),
	disabled('macro-fade-ends', 'Fade ends', ['Tools > Macros'], DISABLED_REASONS.menu),
	disabled('macro-mp3-conversion', 'MP3 conversion', ['Tools > Macros'], DISABLED_REASONS.menu),
	disabled('raw-data-import', 'Import raw data…', ['Tools'], DISABLED_REASONS.todo, { source: UPSTREAM.project }),
	disabled('reset-configuration', 'Reset configuration', ['Tools'], DISABLED_REASONS.todo, { source: UPSTREAM.project }),

	// Help actions that translate naturally to a browser surface.
	implemented('tutorials', 'Tutorials', ['Help'], 'help.openTutorials', { source: UPSTREAM.project }),
	implemented('online-handbook', 'Manual', ['Help'], 'help.openManual', { shortcut: 'F1', source: UPSTREAM.menu }),
	implemented('local://support', 'Support', ['Help'], 'help.openSupport', { source: null, origin: 'local' }),
	implemented('about-audacity', 'About this editor', ['Help'], 'help.openAbout', { source: UPSTREAM.menu }),
	implemented('local://transport-toolbar', 'Transport toolbar', ['View > Toolbars'], 'workspace.toggleTransportToolbar', { source: null, origin: 'local' }),
	implemented('local://selection-toolbar', 'Selection toolbar', ['View > Toolbars'], 'workspace.toggleSelectionToolbar', { source: null, origin: 'local' }),

	// Existing browser placeholders explicitly retained by the user's parity policy.
	disabled('local://backup-project', 'Backup project', ['File'], DISABLED_REASONS.local, { source: null, origin: 'local' }),
	disabled('local://export-multiple', 'Export multiple', ['File'], DISABLED_REASONS.local, { source: null, origin: 'local' }),
	disabled('local://store-selection', 'Store selection', ['Select'], DISABLED_REASONS.local, { source: null, origin: 'local' }),
	disabled('local://retrieve-selection', 'Retrieve selection', ['Select'], DISABLED_REASONS.local, { source: null, origin: 'local' }),
	disabled('local://select-no-tracks', 'Select no tracks', ['Select > Tracks'], DISABLED_REASONS.local, { source: null, origin: 'local' }),
	disabled('local://mute-all', 'Mute all tracks', ['Tracks'], DISABLED_REASONS.local, { source: null, origin: 'local' }),
	disabled('local://unmute-all', 'Unmute all tracks', ['Tracks'], DISABLED_REASONS.local, { source: null, origin: 'local' }),
	disabled('local://repeat-generator', 'Repeat last generator', ['Generate'], DISABLED_REASONS.local, { source: null, origin: 'local' }),
	disabled('local://rhythm-generator', 'Rhythm track…', ['Generate'], DISABLED_REASONS.local, { source: null, origin: 'local' }),
	disabled('local://pluck-generator', 'Pluck…', ['Generate'], DISABLED_REASONS.local, { source: null, origin: 'local' }),
	disabled('local://risset-generator', 'Risset drum…', ['Generate'], DISABLED_REASONS.local, { source: null, origin: 'local' }),
	disabled('local://repeat-analyzer', 'Repeat last analyzer', ['Analyze'], DISABLED_REASONS.local, { source: null, origin: 'local' }),
	disabled('local://beat-finder', 'Beat finder…', ['Analyze'], DISABLED_REASONS.local, { source: null, origin: 'local' }),
	disabled('local://silence-finder', 'Silence finder…', ['Analyze'], DISABLED_REASONS.local, { source: null, origin: 'local' }),
	disabled('local://sound-finder', 'Sound finder…', ['Analyze'], DISABLED_REASONS.local, { source: null, origin: 'local' }),

	// Explicit product exclusions. They remain in the audit inventory but never
	// appear in generated or decorated menus.
	excluded('restart', 'Restart', ['Application'], EXCLUDED_REASONS.os, { source: UPSTREAM.application }),
	excluded('project-show-in-folder', 'Show project in file manager', ['File'], EXCLUDED_REASONS.os),
	excluded('action://cancel', 'Cancel framework action', ['Application'], EXCLUDED_REASONS.developer, { source: UPSTREAM.application }),
	excluded('action://trigger', 'Trigger framework action', ['Application'], EXCLUDED_REASONS.developer, { source: UPSTREAM.application }),
	excluded('cloud-file-open', 'Open cloud project', ['File'], EXCLUDED_REASONS.cloud),
	excluded('sample-data-export', 'Sample data export', ['Tools'], EXCLUDED_REASONS.plugins),
	excluded('sample-data-import', 'Sample data import', ['Tools'], EXCLUDED_REASONS.plugins),
	excluded('prev-window', 'Previous window', ['Extra'], EXCLUDED_REASONS.developer),
	excluded('next-window', 'Next window', ['Extra'], EXCLUDED_REASONS.developer),
	excluded('regular-interval-labels', 'Regular interval labels', ['Extra'], EXCLUDED_REASONS.developer),
	excluded('device-info', 'Device information', ['Diagnostics'], EXCLUDED_REASONS.os),
	excluded('midi-device-info', 'MIDI device information', ['Diagnostics'], EXCLUDED_REASONS.midi),
	excluded('log', 'Application log', ['Diagnostics'], EXCLUDED_REASONS.developer),
	excluded('crash-report', 'Crash report', ['Diagnostics'], EXCLUDED_REASONS.developer),
	excluded('raise-segfault', 'Raise segmentation fault', ['Diagnostics'], EXCLUDED_REASONS.developer),
	excluded('throw-exception', 'Throw exception', ['Diagnostics'], EXCLUDED_REASONS.developer),
	excluded('violate-assertion', 'Violate assertion', ['Diagnostics'], EXCLUDED_REASONS.developer),
	excluded('menu-tree', 'Menu tree', ['Diagnostics'], EXCLUDED_REASONS.developer),
	excluded('frame-statistics', 'Frame statistics', ['Diagnostics'], EXCLUDED_REASONS.developer),
	excluded('action://playback/change-api', 'Change audio API', ['Audio setup'], EXCLUDED_REASONS.os, { source: UPSTREAM.playback }),
	excluded('action://playback/change-playback-device', 'Change playback device', ['Audio setup'], EXCLUDED_REASONS.os, { source: UPSTREAM.playback }),
	excluded('action://playback/change-recording-device', 'Change recording device', ['Audio setup'], EXCLUDED_REASONS.os, { source: UPSTREAM.playback }),
	excluded('action://playback/change-input-channels', 'Change recording channels', ['Audio setup'], EXCLUDED_REASONS.os, { source: UPSTREAM.playback }),
	excluded('action://effects/toggle_vendor_ui', 'Use vendor UI', ['Effect dialog'], EXCLUDED_REASONS.plugins, { source: UPSTREAM.effects }),
	excluded('diagnostic-show-navigation-tree', 'Show navigation tree', ['Diagnostics'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('diagnostic-show-accessible-tree', 'Show accessibility tree', ['Diagnostics'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('diagnostic-accessible-tree-dump', 'Dump accessibility tree', ['Diagnostics'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('testflow-show-scripts', 'Show test-flow scripts', ['Diagnostics'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('extensions-show-apidump', 'Show extension API dump', ['Diagnostics'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('multiwindows-dev-show-info', 'Show multi-window diagnostics', ['Diagnostics'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('insert-hbox', 'Insert horizontal box', ['Developer menu'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('insert-vbox', 'Insert vertical box', ['Developer menu'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('insert-textframe', 'Insert text frame', ['Developer menu'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('append-hbox', 'Append horizontal box', ['Developer menu'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('append-vbox', 'Append vertical box', ['Developer menu'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('append-textframe', 'Append text frame', ['Developer menu'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('show-invisible', 'Show invisible items', ['Developer menu'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('show-unprintable', 'Show unprintable items', ['Developer menu'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('show-frames', 'Show frames', ['Developer menu'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('show-pageborders', 'Show page borders', ['Developer menu'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('show-irregular', 'Show irregular items', ['Developer menu'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('show-soundflags', 'Show sound flags', ['Developer menu'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('file-save-to-cloud', 'Save to cloud', ['File'], EXCLUDED_REASONS.cloud),
	excluded('file-share-audio', 'Share audio', ['File'], EXCLUDED_REASONS.cloud),
	excluded('audacity://cloud/open-audio-file', 'Open cloud audio', ['File'], EXCLUDED_REASONS.cloud),
	excluded('audacity://cloud/open-project-page', 'Open project page', ['Help'], EXCLUDED_REASONS.cloud, { source: 'src/au3cloud/internal/clouduiactions.cpp' }),
	excluded('audacity://cloud/open-audio-page', 'Open audio page', ['Help'], EXCLUDED_REASONS.cloud, { source: 'src/au3cloud/internal/clouduiactions.cpp' }),
	excluded('link-account', 'Link account', ['Help'], EXCLUDED_REASONS.cloud),
	excluded('plugin-manager', 'Plugin manager', ['Generate', 'Effect', 'Analyze', 'Tools'], EXCLUDED_REASONS.plugins),
	excluded('get-effects', 'Get effects', ['Effect'], EXCLUDED_REASONS.plugins, { source: UPSTREAM.playback }),
	excluded('nyquist-plugin-installer', 'Nyquist plugin installer', ['Tools'], EXCLUDED_REASONS.plugins),
	excluded('nyquist-prompt', 'Nyquist prompt', ['Tools'], EXCLUDED_REASONS.plugins),
	excluded('audio-setup', 'Audio setup', ['Transport'], EXCLUDED_REASONS.os, { source: UPSTREAM.playback }),
	excluded('audio-settings', 'Audio settings', ['Transport'], EXCLUDED_REASONS.os, { source: UPSTREAM.playback }),
	excluded('rescan-devices', 'Rescan audio devices', ['Transport'], EXCLUDED_REASONS.os, { source: UPSTREAM.playback }),
	excluded('quit', 'Quit', ['File'], EXCLUDED_REASONS.os, { source: UPSTREAM.menu }),
	excluded('check-update', 'Check for updates', ['Help'], EXCLUDED_REASONS.os, { source: UPSTREAM.menu }),
	excluded('about-qt', 'About Qt', ['Help'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('menu-extra', 'Extra', ['Application menu'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('menu-diagnostics', 'Diagnostics', ['Help'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('benchmark', 'Benchmark', ['Extra'], EXCLUDED_REASONS.developer),
	excluded('diagnostic-show-actions', 'Show actions', ['Diagnostics'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('diagnostic-show-paths', 'Show paths', ['Diagnostics'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('diagnostic-show-graphicsinfo', 'Show graphics information', ['Diagnostics'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('diagnostic-show-profiler', 'Show profiler', ['Diagnostics'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('diagnostic-save-diagnostic-files', 'Save diagnostic files', ['Diagnostics'], EXCLUDED_REASONS.developer, { source: UPSTREAM.menu }),
	excluded('local://midi-track', 'MIDI track', ['Tracks'], EXCLUDED_REASONS.midi, { source: null, origin: 'local' }),
];

export const AUDACITY_ACTION_MANIFEST = deepFreeze(toManifest(definitions));

// Existing UI IDs predate the upstream parity inventory. Keeping aliases here
// lets menu rendering consume the manifest without forcing command/model churn.
export const AUDACITY_ACTION_ALIASES = deepFreeze({
	'new-project': 'file-new',
	'open-project': 'file-open',
	'recent-projects': 'file-open-recent',
	'save-project': 'file-save',
	'save-project-as': 'file-save-as',
	'backup-project': 'local://backup-project',
	'import-audio': 'project-import',
	'export-multiple': 'local://export-multiple',
	undo: 'action://trackedit/undo',
	'action://undo': 'action://trackedit/undo',
	redo: 'action://trackedit/redo',
	'action://redo': 'action://trackedit/redo',
	cut: 'action://cut',
	'action://trackedit/cut': 'action://cut',
	copy: 'action://copy',
	'action://trackedit/copy': 'action://copy',
	paste: 'action://paste',
	'action://trackedit/paste-default': 'action://paste',
	delete: 'action://delete',
	'action://trackedit/delete': 'action://delete',
	'duplicate-audio': 'duplicate',
	'ripple-delete': 'delete-per-track-ripple',
	'split-delete': 'delete-per-clip-ripple',
	'silence-audio': 'silence-audio-selection',
	'clip-properties': 'clip-properties',
	'clip-rename': 'rename-item',
	'clip-pitch-speed-open': 'clip-pitch-speed',
	'merge-selected-on-tracks': 'join',
	'duplicate-selected': 'duplicate',
	'duplicate-clip': 'duplicate',
	labels: 'open-label-editor',
	metadata: 'open-metadata-editor',
	preferences: 'preference-dialog',
	'select-none': 'clear-selection',
	'select-no-tracks': 'local://select-no-tracks',
	'left-at-playback': 'select-left-of-playback-position',
	'right-at-playback': 'select-right-of-playback-position',
	'track-start-cursor': 'select-track-start-to-cursor',
	'cursor-track-end': 'select-cursor-to-track-end',
	'store-selection': 'local://store-selection',
	'retrieve-selection': 'local://retrieve-selection',
	'zero-crossings': 'zero-cross',
	'show-effects': 'toggle-effects',
	'panel-history': 'toggle-history',
	'transport-toolbar': 'local://transport-toolbar',
	'selection-toolbar': 'local://selection-toolbar',
	'show-rms': 'toggle-rms-in-waveform',
	'show-rulers': 'toggle-vertical-rulers',
	'zoom-fit': 'zoom-to-fit-project',
	record: 'record-on-current-track',
	'action://record/start': 'record-on-current-track',
	'record-new-track': 'record-on-new-track',
	'pause-recording': 'action://record/pause',
	stop: 'action://playback/stop',
	'lead-in-time': 'action://record/lead-in-recording',
	'sound-activated': 'toggle-sound-activated-recording',
	'audio-track': 'new-stereo-track',
	'label-track': 'new-label-track',
	'midi-track': 'local://midi-track',
	'remove-track': 'remove-tracks',
	'track-delete': 'remove-tracks',
	'track-duplicate': 'duplicate-track',
	'mute-all': 'local://mute-all',
	'unmute-all': 'local://unmute-all',
	resample: 'track-resample',
	align: 'menu-align',
	sort: 'menu-sort',
	'mix-render': 'mixdown-to',
	'mix-render-new': 'mixdown-to',
	'plugin-manager': 'plugin-manager',
	'effect-plugin-manager': 'plugin-manager',
	'analyze-plugin-manager': 'plugin-manager',
	'tools-plugin-manager': 'plugin-manager',
	'realtime-effects': 'add-realtime-effects',
	'repeat-effect': 'repeat-last-effect',
	'change-pitch': 'effect://builtin/change-pitch',
	'change-tempo': 'effect://builtin/change-tempo',
	'silence-generator': 'generator://silence',
	'tone-generator': 'generator://tone',
	'chirp-generator': 'generator://chirp',
	'dtmf-generator': 'generator://dtmf',
	'noise-generator': 'generator://noise',
	'repeat-generator': 'local://repeat-generator',
	'rhythm-generator': 'local://rhythm-generator',
	'pluck-generator': 'local://pluck-generator',
	'risset-generator': 'local://risset-generator',
	contrast: 'contrast-analyzer',
	'repeat-analyzer': 'local://repeat-analyzer',
	'beat-finder': 'local://beat-finder',
	'silence-finder': 'local://silence-finder',
	'sound-finder': 'local://sound-finder',
	'macro-manager': 'manage-macros',
	manual: 'online-handbook',
	'ask-help': 'local://support',
	support: 'local://support',
	diagnostics: 'menu-diagnostics',
	updates: 'check-update',
	about: 'about-audacity',
	extra: 'menu-extra',
	'extra-transport': 'menu-extra',
	'extra-edit': 'menu-extra',
	'extra-select': 'menu-extra',
	'extra-tracks': 'menu-extra',
	'extra-export': 'menu-extra',
	'play-at-speed': 'menu-extra',
});

export function resolveAudacityActionId(id) {
	return AUDACITY_ACTION_ALIASES[id] || id;
}

export function audacityActionDefinition(id) {
	return matchAudacityAction(id)?.definition || null;
}

export function audacityActionReason(id, locale = 'en') {
	const reason = audacityActionDefinition(id)?.reason;
	return reason?.[locale === 'de' ? 'de' : 'en'] || null;
}

/**
 * Evaluate a manifest predicate against a controller/runtime snapshot.
 * Disabled and excluded records always evaluate false, regardless of state.
 */
export function evaluateAudacityActionEnablement(id, context) {
	const definition = audacityActionDefinition(id);
	if (!definition || definition.status !== AUDACITY_ACTION_STATUS.IMPLEMENTED) return false;
	return evaluateAudacityEnableWhen(definition.enableWhen, resolveActionContext(context));
}

/** Evaluate one of the closed predicate vocabulary entries used by the manifest. */
export function evaluateAudacityEnableWhen(enableWhen, context = {}) {
	if (typeof enableWhen !== 'string' || !enableWhen) throw new TypeError('An Audacity enableWhen predicate is required.');
	const resolvedContext = resolveActionContext(context);
	const override = resolvedContext?.predicates?.[enableWhen];
	if (typeof override === 'boolean') return override;

	const snapshot = resolvedContext?.snapshot || {};
	const project = snapshot.project || null;
	const telemetry = resolvedContext?.telemetry || {};
	const ui = resolvedContext?.ui || {};
	const tracks = project?.tracks || [];
	const clips = project?.clips || [];
	const selection = project?.selection || snapshot.selection || {};
	const selectedClipIds = uniqueExistingIds([
		snapshot.selectedClipId,
		...(selection.clipIds || []),
	], clips);
	const selectedClips = selectedClipIds.map((clipId) => clips.find((clip) => clip.id === clipId)).filter(Boolean);
	const selectedTrackIds = uniqueExistingIds([
		snapshot.selectedTrackId,
		...(selection.trackIds || []),
		...selectedClips.map((clip) => tracks.find((track) => track.clipIds?.includes(clip.id))?.id),
	], tracks);
	const selectedTracks = selectedTrackIds.map((trackId) => tracks.find((track) => track.id === trackId)).filter(Boolean);
	const selectedTrack = selectedTracks[0] || null;
	const selectedAudioTrack = selectedTracks.find((track) => track.type !== 'label') || null;
	const selectedClip = selectedClips[0] || null;
	const timeSelection = Number.isSafeInteger(selection.startFrame)
		&& Number.isSafeInteger(selection.endFrame)
		&& selection.endFrame > selection.startFrame;
	const frequencySelection = timeSelection
		&& Number.isFinite(selection.frequencyRange?.minimumFrequency)
		&& Number.isFinite(selection.frequencyRange?.maximumFrequency)
		&& selection.frequencyRange.maximumFrequency > selection.frequencyRange.minimumFrequency;
	const projectOpened = Boolean(project);
	const projectWritable = projectOpened && !snapshot.readOnly;
	const recording = Boolean(snapshot.recording || snapshot.recordingStarting || telemetry.recording);
	const playing = telemetry.transportState === 'playing';
	const editingBlocked = !projectWritable
		|| Boolean(snapshot.importing || recording || snapshot.exporting || snapshot.processingEffect || snapshot.sampleEdit?.processing);
	const editable = projectWritable && !editingBlocked;
	const projectHasAudio = tracks.some((track) => track.type !== 'label' && track.clipIds?.length);
	const audioSelection = timeSelection && Boolean(selectedAudioTrack || projectHasAudio);
	const realtimeEffectId = resolvedContext?.realtimeEffectId || null;
	const realtimeEffects = selectedAudioTrack?.effects || [];
	const realtimeEffectIndex = realtimeEffects.findIndex((effect) => effect.id === realtimeEffectId);
	const effectOpened = typeof resolvedContext?.effectOpened === 'boolean'
		? resolvedContext.effectOpened
		: ['selection-effect', 'generator'].includes(ui.request?.payload?.surface);
	const effectPresetId = resolvedContext?.effectPresetId || null;
	const effectPresetSelected = Boolean(effectPresetId && snapshot.effects?.presets?.some((preset) => preset.id === effectPresetId));
	const hasSelection = timeSelection || selectedTrackIds.length > 0 || selectedClipIds.length > 0;
	const predicates = {
		always: true,
		never: false,
		'project-opened': projectOpened,
		'project-writable': projectWritable,
		'project-writable-and-not-recording': projectWritable && !recording,
		'project-has-audio': projectHasAudio,
		'recent-projects': Boolean(snapshot.recentProjects?.length),
		'history-can-undo': Boolean(snapshot.history?.canUndo),
		'history-can-redo': Boolean(snapshot.history?.canRedo),
		selection: hasSelection,
		'time-selection': timeSelection,
		'audio-selection': audioSelection,
		'editable-selection': editable && audioSelection,
		'editable-selection-or-clip': editable && (audioSelection || Boolean(selectedClip)),
		'clipboard-and-project-writable': projectWritable && Boolean(snapshot.history?.hasClipboard),
		'clip-selected': Boolean(selectedClip),
		'editable-clip-selected': editable && Boolean(selectedClip),
		'editable-transformed-clip': editable && Boolean(selectedClip) && clipHasTimePitchTransform(selectedClip),
		'multiple-editable-clips': editable && selectedClips.length > 1,
		'grouped-editable-clips': editable && selectedClips.some((clip) => Boolean(clip.groupId)),
		'track-selected': Boolean(selectedTrack),
		'editable-track-selected': editable && Boolean(selectedTrack),
		'audio-track-selected': Boolean(selectedAudioTrack),
		'editable-audio-track-selected': editable && Boolean(selectedAudioTrack),
		'stereo-track-selected': Boolean(selectedAudioTrack?.channelCount === 2),
		'compatible-mono-tracks': editable && selectedAudioTrack?.channelCount === 1 && tracks.some((track) => (
			track.id !== selectedAudioTrack.id && track.type !== 'label' && track.channelCount === 1
		)),
		'label-track-present': tracks.some((track) => track.type === 'label'),
		'loop-region': Boolean(project?.loop?.enabled && project.loop.endFrame > project.loop.startFrame),
		playing,
		'playing-or-recording': playing || recording,
		recording,
		'not-recording': !recording,
		'spectrogram-track-selected': Boolean(selectedAudioTrack && (
			selectedAudioTrack.displayMode === 'spectrogram'
			|| selectedAudioTrack.displayMode === 'multiview'
			|| snapshot.timeline?.view === 'spectrogram'
		)),
		'editable-frequency-selection': editable && Boolean(selectedAudioTrack) && frequencySelection,
		'repeatable-effect-and-editable-selection': editable && audioSelection && Boolean(snapshot.effects?.canRepeatLast),
		'effect-opened': effectOpened,
		'effect-preset-selected': effectPresetSelected,
		'editable-effect-preset-selected': projectWritable && effectPresetSelected,
		'realtime-effect-selected': realtimeEffectIndex >= 0,
		'realtime-effect-can-move-up': realtimeEffectIndex > 0,
		'realtime-effect-can-move-down': realtimeEffectIndex >= 0 && realtimeEffectIndex < realtimeEffects.length - 1,
	};
	if (!Object.hasOwn(predicates, enableWhen)) throw new ReferenceError(`Unknown Audacity enableWhen predicate: ${enableWhen}.`);
	return Boolean(predicates[enableWhen]);
}

/**
 * Resolve an implemented manifest action against a concrete runtime action
 * tree. Disabled and excluded actions are deliberately never resolved, even
 * when an object happens to expose a property with the same name.
 *
 * Runtime actions are closures and must not depend on a dynamic `this` value;
 * returning the function unchanged keeps this check honest (and makes it
 * possible for tests to prove that the callable belongs to the real runtime).
 */
export function resolveAudacityActionHandler(id, actionRuntime) {
	const match = matchAudacityAction(id);
	const definition = match?.definition;
	if (!definition || definition.status !== AUDACITY_ACTION_STATUS.IMPLEMENTED) return null;
	if (!actionRuntime || typeof actionRuntime !== 'object') return null;
	let candidate = actionRuntime;
	for (const segment of definition.handler.split('.')) {
		if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'function')) return null;
		if (!Object.hasOwn(candidate, segment)) return null;
		candidate = candidate[segment];
	}
	if (typeof candidate !== 'function') return null;
	if (!match.dynamic || match.template) return candidate;
	if (!match.valid) return null;
	return () => candidate(...match.parameters);
}

/** Return a deterministic release-gate report for a concrete action runtime. */
export function auditAudacityActionRuntime(actionRuntime) {
	const implemented = [];
	const resolved = [];
	const missing = [];
	for (const definition of Object.values(AUDACITY_ACTION_MANIFEST)) {
		if (definition.status !== AUDACITY_ACTION_STATUS.IMPLEMENTED) continue;
		implemented.push(definition.id);
		if (resolveAudacityActionHandler(definition.id, actionRuntime)) resolved.push(definition.id);
		else missing.push(Object.freeze({ id: definition.id, handler: definition.handler }));
	}
	return Object.freeze({
		implemented: Object.freeze(implemented),
		resolved: Object.freeze(resolved),
		missing: Object.freeze(missing),
		complete: missing.length === 0,
	});
}

/**
 * Applies parity policy to an already-materialized UI menu without mutating it.
 * Unknown local containers and effect groups are deliberately retained so
 * migration to fully manifest-generated menus can happen incrementally.
 */
export function applyAudacityParityToMenus(menus, {
	locale = 'en',
	materializeDisabled = false,
	actionRuntime = null,
	actionContext,
} = {}) {
	if (!Array.isArray(menus)) throw new TypeError('menus must be an array.');
	const completeMenus = materializeDisabled
		? materializeAudacityDisabledMenuActions(menus, { locale })
		: menus;
	const resolvedContext = actionContext === undefined
		? resolveRuntimeActionContext(actionRuntime)
		: resolveActionContext(actionContext);
	return cleanMenuItems(completeMenus.map((item) => decorateMenuItem(item, locale, actionRuntime, resolvedContext)).filter(Boolean));
}

function decorateMenuItem(item, locale, actionRuntime, actionContext) {
	if (!item || typeof item !== 'object') throw new TypeError('Each menu item must be an object.');
	if (item.divider) return { ...item };
	const definition = item.id ? audacityActionDefinition(item.id) : null;
	if (definition?.status === AUDACITY_ACTION_STATUS.EXCLUDED) return null;

	const children = item.items
		? cleanMenuItems(item.items.map((child) => decorateMenuItem(child, locale, actionRuntime, actionContext)).filter(Boolean))
		: undefined;
	const result = { ...item };
	if (children) result.items = children;

	if (definition) {
		result.parityActionId = definition.id;
		result.parityStatus = definition.status;
	}
	if (definition?.status === AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM) {
		result.disabled = true;
		result.onClick = undefined;
		result.disabledReason = definition.reason[locale === 'de' ? 'de' : 'en'];
	} else if (!children?.length && definition?.status === AUDACITY_ACTION_STATUS.IMPLEMENTED) {
		const hadHandler = typeof result.onClick === 'function';
		const stateDisabled = result.disabled || (
			actionContext !== undefined && !evaluateAudacityEnableWhen(definition.enableWhen, actionContext)
		);
		if (stateDisabled) {
			result.disabled = true;
			result.onClick = undefined;
			result.disabledReason ||= (
				actionContext === undefined && !hadHandler ? DISABLED_REASONS.pending : DISABLED_REASONS.state
			)[locale === 'de' ? 'de' : 'en'];
		} else if (typeof result.onClick !== 'function') {
			const handler = resolveAudacityActionHandler(item.id, actionRuntime);
			if (handler) result.onClick = handler;
			else {
				result.disabled = true;
				result.onClick = undefined;
				result.disabledReason = DISABLED_REASONS.pending[locale === 'de' ? 'de' : 'en'];
			}
		}
	} else if (result.disabled) {
		const hadHandler = typeof result.onClick === 'function';
		result.onClick = undefined;
		result.disabledReason ||= (hadHandler ? DISABLED_REASONS.state : DISABLED_REASONS.local)[locale === 'de' ? 'de' : 'en'];
	}
	return result;
}

function matchAudacityAction(id) {
	if (typeof id !== 'string' || !id) return null;
	const resolvedId = resolveAudacityActionId(id);
	const exact = AUDACITY_ACTION_MANIFEST[resolvedId];
	if (exact) return { definition: exact, dynamic: exact.id.includes('%1'), template: true, valid: true, parameters: [] };

	for (const definition of Object.values(AUDACITY_ACTION_MANIFEST)) {
		const markerIndex = definition.id.indexOf('%1');
		if (markerIndex < 0) continue;
		const prefix = definition.id.slice(0, markerIndex);
		const suffix = definition.id.slice(markerIndex + 2);
		if (!resolvedId.startsWith(prefix) || !resolvedId.endsWith(suffix)) continue;
		const encodedValue = resolvedId.slice(prefix.length, suffix ? -suffix.length : undefined);
		if (!encodedValue) return { definition, dynamic: true, template: false, valid: false, parameters: [] };
		let value;
		try {
			value = decodeURIComponent(encodedValue.replace(/\+/g, ' '));
		} catch {
			return { definition, dynamic: true, template: false, valid: false, parameters: [] };
		}
		const parameterName = definition.id.slice(0, markerIndex).match(/[?&]([^?&=]+)=$/)?.[1] || '';
		if (parameterName === 'rate') {
			const rate = Number(value);
			if (!Number.isSafeInteger(rate) || rate <= 0) {
				return { definition, dynamic: true, template: false, valid: false, parameters: [] };
			}
			value = rate;
		} else if (parameterName === 'colorindex') {
			const colorIndex = Number(value);
			if (!Number.isSafeInteger(colorIndex) || colorIndex < 0) {
				return { definition, dynamic: true, template: false, valid: false, parameters: [] };
			}
			value = colorIndex;
		}
		return { definition, dynamic: true, template: false, valid: true, parameters: [value] };
	}
	return null;
}

function resolveRuntimeActionContext(actionRuntime) {
	if (!actionRuntime || typeof actionRuntime.getActionContext !== 'function') return undefined;
	return resolveActionContext(actionRuntime.getActionContext());
}

function resolveActionContext(context) {
	if (context && typeof context.getActionContext === 'function') return resolveActionContext(context.getActionContext());
	if (!context || typeof context !== 'object') return {};
	if (
		Object.hasOwn(context, 'snapshot')
		|| Object.hasOwn(context, 'telemetry')
		|| Object.hasOwn(context, 'ui')
		|| Object.hasOwn(context, 'predicates')
		|| Object.hasOwn(context, 'effectOpened')
		|| Object.hasOwn(context, 'effectPresetId')
		|| Object.hasOwn(context, 'realtimeEffectId')
	) return context;
	return { snapshot: context };
}

function uniqueExistingIds(values, records) {
	const available = new Set(records.map((record) => record.id));
	return [...new Set(values.filter((value) => typeof value === 'string' && available.has(value)))];
}

function clipHasTimePitchTransform(clip) {
	return Boolean(
		clip
		&& (
			Math.abs(Number(clip.pitchCents) || 0) > 1e-9
			|| Math.abs((Number(clip.speedRatio) || 1) - 1) > 1e-9
			|| clip.stretchToTempo
		),
	);
}

const APPLICATION_MENU_IDS = Object.freeze({
	File: 'file',
	Edit: 'edit',
	Select: 'select',
	View: 'view',
	Record: 'record',
	Tracks: 'tracks',
	Generate: 'generate',
	Effect: 'effect',
	Analyze: 'analyze',
	Tools: 'tools',
	Help: 'help',
});

const GERMAN_PARITY_LABELS = Object.freeze({
	'Export other': 'Weitere Exporte',
	'Export MIDI…': 'MIDI exportieren…',
	'Audio clips': 'Audio-Clips',
	'Previous clip boundary to cursor': 'Vorherige Clip-Grenze bis Cursor',
	'Cursor to next clip boundary': 'Cursor bis nächste Clip-Grenze',
	'Previous clip': 'Vorheriger Clip',
	'Next clip': 'Nächster Clip',
	Spectral: 'Spektral',
	'Spectral selection': 'Spektralauswahl',
	'Skip to': 'Springen zu',
	'Selection start': 'Auswahlbeginn',
	'Selection end': 'Auswahlende',
	'Set up timed recording…': 'Zeitgesteuerte Aufnahme einrichten…',
	'Sound activation level…': 'Aktivierungspegel…',
	'Align content': 'Inhalt ausrichten',
	'Align end to end': 'Ende an Ende ausrichten',
	'Align together': 'Zusammen ausrichten',
	'Align start to zero': 'Anfang an Null ausrichten',
	'Align start to playhead': 'Anfang an Abspielposition ausrichten',
	'Align start to selection end': 'Anfang am Auswahlende ausrichten',
	'Align end to playhead': 'Ende an Abspielposition ausrichten',
	'Align end to selection end': 'Ende am Auswahlende ausrichten',
	'Sort tracks': 'Spuren sortieren',
	'Sort by time': 'Nach Zeit sortieren',
	'Sort by name': 'Nach Name sortieren',
	Macros: 'Makros',
	'Apply macro…': 'Makro anwenden…',
	'Fade ends': 'Enden ausblenden',
	'MP3 conversion': 'MP3-Konvertierung',
	'Import raw data…': 'Rohdaten importieren…',
	'Reset configuration': 'Konfiguration zurücksetzen',
	Insert: 'Einfügen',
});

/** Materialize every pinned application-menu command that is intentionally disabled. */
export function materializeAudacityDisabledMenuActions(menus, { locale = 'en' } = {}) {
	const result = menus.map(cloneMenuTree);
	const definitions = Object.values(AUDACITY_ACTION_MANIFEST)
		.filter((definition) => definition.status === AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM);
	for (const definition of definitions) {
		const location = definition.locations.find((candidate) => APPLICATION_MENU_IDS[String(candidate).split(' > ')[0]]);
		if (!location) continue;
		const path = String(location).split(' > ');
		const root = result.find((menu) => menu.id === APPLICATION_MENU_IDS[path[0]]);
		if (!root) continue;
		root.items ||= [];
		let children = root.items;
		for (const segment of path.slice(1)) {
			let container = children.find((item) => menuItemMatchesManifestLabel(item, segment));
			if (!container) {
				const containerDefinition = definitions.find((candidate) => (
					candidate.label === segment
					&& candidate.locations.some((candidateLocation) => candidateLocation === path.slice(0, path.indexOf(segment)).join(' > '))
				));
				container = {
					id: containerDefinition?.id || `parity-${slug(path.slice(0, path.indexOf(segment) + 1).join('-'))}`,
					label: localizedParityLabel(segment, locale),
					items: [],
				};
				children.push(container);
			}
			container.items ||= [];
			children = container.items;
		}
		if (findMenuAction(result, definition.id)) continue;
		const isContainer = definitions.some((candidate) => candidate.locations.some((candidateLocation) => (
			String(candidateLocation).startsWith(`${path.join(' > ')} > ${definition.label}`)
		)));
		children.push({
			id: definition.id,
			label: localizedParityLabel(definition.label, locale),
			disabled: true,
			...(definition.shortcut ? { shortcut: definition.shortcut } : {}),
			...(isContainer ? { items: [] } : {}),
		});
	}
	return result;
}

/**
 * Build the searchable shortcut/command inventory from the pinned manifest,
 * then overlay localized labels and legacy preference IDs from rendered menus.
 * Excluded actions never enter the inventory; disabled-upstream actions remain
 * visible and carry the reason the UI needs to keep their controls inert.
 */
export function collectAudacityShortcutCommands(menus, { locale = 'en' } = {}) {
	if (!Array.isArray(menus)) throw new TypeError('menus must be an array.');
	const normalizedLocale = locale === 'de' ? 'de' : 'en';
	const commands = new Map();

	for (const definition of Object.values(AUDACITY_ACTION_MANIFEST)) {
		if (definition.status === AUDACITY_ACTION_STATUS.EXCLUDED) continue;
		const disabled = definition.status === AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM;
		commands.set(definition.id, {
			id: definition.id,
			preferenceId: definition.id,
			label: localizedParityLabel(definition.label, normalizedLocale),
			shortcut: definition.shortcut || '',
			parityStatus: definition.status,
			disabled,
			disabledReason: disabled ? definition.reason[normalizedLocale] : null,
		});
	}

	const visit = (items = []) => {
		for (const item of items) {
			if (!item || item.divider) continue;
			if (item.items?.length) {
				visit(item.items);
				continue;
			}
			if (!item.id) continue;
			const definition = audacityActionDefinition(item.id);
			if (definition?.status === AUDACITY_ACTION_STATUS.EXCLUDED) continue;
			const id = definition?.id || item.id;
			const current = commands.get(id);
			const disabled = definition
				? definition.status === AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM
				: Boolean(item.disabled);
			commands.set(id, {
				...(current || {}),
				id,
				preferenceId: item.id,
				label: item.label || current?.label || id,
				shortcut: item.shortcut || current?.shortcut || '',
				parityStatus: definition?.status || null,
				disabled,
				disabledReason: disabled
					? (item.disabledReason || definition?.reason?.[normalizedLocale] || null)
					: null,
			});
		}
	};
	visit(menus);

	return [...commands.values()].sort((left, right) => (
		left.label.localeCompare(right.label, normalizedLocale)
		|| left.id.localeCompare(right.id)
	));
}

function menuItemMatchesManifestLabel(item, label) {
	return item?.label === label || item?.parityLabel === label || audacityActionDefinition(item?.id)?.label === label;
}

function findMenuAction(items, actionId) {
	for (const item of items || []) {
		if (resolveAudacityActionId(item?.id) === actionId) return item;
		const child = findMenuAction(item?.items, actionId);
		if (child) return child;
	}
	return null;
}

function cloneMenuTree(item) {
	return item && typeof item === 'object'
		? { ...item, ...(item.items ? { items: item.items.map(cloneMenuTree) } : {}) }
		: item;
}

function localizedParityLabel(label, locale) {
	return locale === 'de' ? GERMAN_PARITY_LABELS[label] || label : label;
}

function slug(value) {
	return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function cleanMenuItems(items) {
	const result = [];
	for (const item of items) {
		if (item.divider && (!result.length || result.at(-1).divider)) continue;
		result.push(item);
	}
	while (result.at(-1)?.divider) result.pop();
	return result;
}

function actionDefinition({
	id,
	label,
	locations,
	handler,
	enableWhen,
	shortcut,
	status,
	upstreamAction,
	upstreamSource,
	origin,
	reason,
}) {
	return {
		id,
		label,
		locations: Array.isArray(locations) ? locations : [locations],
		shortcut,
		handler,
		enableWhen,
		status,
		upstreamAction,
		upstreamSource,
		origin,
		...(reason ? { reason } : {}),
	};
}

function toManifest(entries) {
	const manifest = {};
	for (const entry of entries) {
		if (manifest[entry.id]) throw new Error(`Duplicate Audacity action ID: ${entry.id}.`);
		manifest[entry.id] = entry;
	}
	return manifest;
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) deepFreeze(child);
	return value;
}
