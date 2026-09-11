// Reviewed Soundscaper catalog keys mapped to exact Audacity 4 Qt TS identities.
//
// `context`, `source`, and `comment` are all significant. Do not replace this
// with a source-only lookup: the same English source often occurs in unrelated
// Audacity contexts. The set intentionally favors high-value editor commands
// that are complete in both a representative LTR locale and an RTL locale.
//
// Adding, removing or editing an entry changes the mapping digest. Rerun the
// converter from a verified artifact in the same change so every committed
// catalog carries matching provenance; desktop packaging refuses a snapshot
// whose catalogs disagree.
export const AUDACITY_QT_MAPPING_VERSION = 3;

export const AUDACITY_QT_MAPPING = deepFreeze([
	entry('addEffect', 'projectscene', 'Add effect'),
	entry('addTrack', 'projectscene', 'Add track'),
	entry('applyEffectPreset', 'action', '&Apply preset', '', ['stripMnemonic']),
	entry('clearLoopRegion', 'action', 'Clear loop region'),
	entry('clipping', 'builtin-effects', 'Clipping'),
	entry('closeProject', 'action', 'Close project'),
	entry('copy', 'action', 'Copy'),
	entry('cut', 'action', 'Cut'),
	entry('delay', 'effects-nyquist', 'Delay'),
	entry('deleteTrack', 'action', 'Delete track'),
	entry('duplicateAudio', 'action', 'Duplicate'),
	entry('editingAlwaysConvertToMono', 'preferences', 'Always convert to mono without prompt'),
	entry('editingAlwaysPasteAsNewClip', 'preferences', 'Always paste audio as a new clip'),
	entry('editingApplyEffectsToAllAudio', 'preferences', 'Apply effects to all audio when no selection is made'),
	entry('editingAsymmetricAlways', 'preferences', 'Always'),
	entry('editingAsymmetricNever', 'preferences', 'Never'),
	entry('editingAsymmetricStereoHeights', 'preferences', 'Asymmetric stereo heights'),
	entry('editingAsymmetricStereoHeightsDescription', 'preferences', 'Dragging on the center line may adjust the height of the channel:'),
	entry('editingAsymmetricWorkspace', 'preferences', 'Depending on workspace'),
	entry('editingCloseGapAllTracks', 'trackedit/preferences', 'All clips on all tracks move back to fill the gap'),
	entry('editingCloseGapBehavior', 'trackedit/preferences', 'When closing the gap, do the following'),
	entry('editingCloseGapClip', 'trackedit/preferences', 'The selected clip moves back to fill the gap'),
	entry('editingCloseGapRipple', 'trackedit/preferences', 'Close gap (ripple)'),
	entry('editingCloseGapTrack', 'trackedit/preferences', 'All clips on the same track move back to fill the gap'),
	entry('editingDeleteBehavior', 'trackedit/preferences', 'Choose behavior when deleting a portion of a clip'),
	entry('editingEffectBehavior', 'preferences', 'Effect behavior'),
	entry('editingLeaveGap', 'trackedit/preferences', 'Leave gap'),
	entry('editingMonoStereoConversion', 'preferences', 'Mono & stereo conversion'),
	entry('editingPasteBehavior', 'trackedit/preferences', 'Choose behavior when pasting audio'),
	entry('editingPasteInsertAllTracks', 'trackedit/preferences', 'Pasting audio pushes all clips on all tracks'),
	entry('editingPasteInsertBehavior', 'trackedit/preferences', 'When making room for pasted audio, do the following'),
	entry('editingPasteInsertTrack', 'trackedit/preferences', 'Pasting audio pushes other clips on the same track'),
	entry('editingPasteOverlaps', 'trackedit/preferences', 'Paste overlaps other clips'),
	entry('editingPastePushes', 'trackedit/preferences', 'Paste pushes other clips'),
	entry('editingWorkspaces', 'workspace', 'Workspaces'),
	entry('editingZoomDefault', 'appshell/preferences', 'Zoom Default'),
	entry('editingZoomFitToWidth', 'appshell/preferences', 'Fit to Width'),
	entry('editingZoomFourPixelsPerSample', 'appshell/preferences', '4 Pixels per Sample'),
	entry('editingZoomMax', 'appshell/preferences', 'Max Zoom'),
	entry('editingZoomMilliseconds', 'appshell/preferences', 'MilliSeconds'),
	entry('editingZoomMinutes', 'appshell/preferences', 'Minutes'),
	entry('editingZoomPreset100ths', 'appshell/preferences', '100ths of Seconds'),
	entry('editingZoomPreset10ths', 'appshell/preferences', '10ths of Seconds'),
	entry('editingZoomPreset20ths', 'appshell/preferences', '20ths of Seconds'),
	entry('editingZoomPreset500ths', 'appshell/preferences', '500ths of Seconds'),
	entry('editingZoomPreset50ths', 'appshell/preferences', '50ths of Seconds'),
	entry('editingZoomPreset5ths', 'appshell/preferences', '5ths of Seconds'),
	entry('editingZoomSamples', 'appshell/preferences', 'Samples'),
	entry('editingZoomSeconds', 'appshell/preferences', 'Seconds'),
	entry('editingZoomState1', 'appshell/preferences', 'Zoom state 1:'),
	entry('editingZoomState2', 'appshell/preferences', 'Zoom state 2:'),
	entry('editingZoomToSelection', 'appshell/preferences', 'Zoom to Selection'),
	entry('editingZoomToggle', 'appshell/preferences', 'Zoom toggle (magnifying glass)'),
	entry('editingZoomToggleDescription', 'appshell/preferences', 'A special tool in the top bar that toggles between two different zoom states.'),
	entry('effectParamFrequency', 'effects/tone', 'Frequency'),
	entry('effectParamRatio', 'effects', 'Ratio'),
	entry('exportAudio', 'export', 'Export audio'),
	entry('exportEffectPreset', 'action', 'Export preset'),
	entry('gain', 'spectrogram/preferences', 'Gain'),
	entry('generatorFrequency', 'effects-nyquist', 'Frequency (Hz)'),
	entry('generatorPink', 'effects/noise', 'Pink', "not a color, but 'pink noise' having a spectrum with more power in low frequencies"),
	entry('generatorWhite', 'effects/noise', 'White', "not a color, but 'white noise' having a uniform spectrum"),
	entry('importEffectPreset', 'action', 'Import preset'),
	entry('level', 'import-export', 'Level'),
	entry('loopToSelection', 'action', 'Set loop region to selection'),
	entry('metadataComments', 'metadata', 'Comments'),
	entry('metadataTagColumn', 'export', 'Tag'),
	entry('metadataYear', 'metadata', 'Year'),
	entry('metronome', 'action', 'Metronome'),
	entry('monoConversionDontShowAgain', 'global', 'Don’t show again'),
	entry('monoConversionPrompt', 'trackedit', 'This action requires one or more clips to be converted to mono. Would you like to proceed?'),
	entry('monoConversionTitle', 'trackedit', 'Mix down to mono'),
	entry('monoConversionYes', 'global', 'Yes'),
	entry('newProject', 'project', 'New project'),
	entry('openProject', 'action', 'Open…', '', ['stripEllipsis']),
	entry('pan', 'playback', 'Pan'),
	entry('panelHistory', 'appshell', 'History'),
	entry('paste', 'action', 'Paste'),
	entry('pause', 'action', 'Pause'),
	// Audacity 4 replaced the bare `action`/`Play` command with `Play/Pause` and
	// `Play/Stop`; the transport label survives only as the Play menu title, which
	// carries the same reviewed translations and a Turkish mnemonic to strip.
	entry('play', 'appshell-menu-play', 'Play', '', ['stripMnemonic']),
	entry('preferences', 'preferences', 'Preferences'),
	entry('project', 'appshell', 'Project'),
	entry('projectSaving', 'project-file-io', 'Saving project'),
	entry('redo', 'action', 'Redo'),
	entry('repeatLastEffect', 'action', 'Repeat last effect'),
	entry('reverse', 'effects-reverse', 'Reverse'),
	entry('saveProject', 'project/save', 'Save project'),
	entry('selectAll', 'action', 'Select all'),
	entry('selectionFollowsLoop', 'action', 'Creating a loop also selects audio'),
	entry('spectralGain', 'effects-nyquist', 'Gain (dB)'),
	entry('splitIntoNewTrack', 'action', 'Split into new track'),
	entry('statusBar', 'action', '&Status bar', '', ['stripMnemonic']),
	entry('stop', 'action', 'Stop'),
	entry('theme', 'preferences', 'Theme'),
	entry('timecode', 'action', 'Timecode'),
	entry('undo', 'action', 'Undo'),
	entry('zoomIn', 'action', 'Zoom in'),
	entry('zoomOut', 'action', 'Zoom out'),
]);

function entry(key, context, source, comment = '', transforms = []) {
	return { key, context, source, comment, ...(transforms.length ? { transforms } : {}) };
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
