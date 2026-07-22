// Reviewed Soundscaper catalog keys mapped to exact Audacity 4 Qt TS identities.
//
// `context`, `source`, and `comment` are all significant. Do not replace this
// with a source-only lookup: the same English source often occurs in unrelated
// Audacity contexts. The set intentionally favors high-value editor commands
// that are complete in both a representative LTR locale and an RTL locale.
export const AUDACITY_QT_MAPPING_VERSION = 2;

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
	entry('newProject', 'project', 'New project'),
	entry('openProject', 'action', 'Open…', '', ['stripEllipsis']),
	entry('pan', 'playback', 'Pan'),
	entry('panelHistory', 'appshell', 'History'),
	entry('paste', 'action', 'Paste'),
	entry('pause', 'action', 'Pause'),
	entry('play', 'action', 'Play'),
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
