/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Immutable, reviewable inventory of Audacity UI registrations at
 * d413849acab318b68c9d73b3ce5ac5324c1bb589. This is source evidence for the
 * browser parity manifest, not a second command registry. Update the hashes
 * and every list together when (and only when) the pinned revision changes.
 *
 * `%1` denotes the ActionQuery template used by upstream for dynamic effect,
 * track-rate, and track-format actions.
 */

export const AUDACITY_PINNED_UI_COMMIT = 'd413849acab318b68c9d73b3ce5ac5324c1bb589';

export const AUDACITY_PINNED_UI_AUDIT = deepFreeze({
	literalRegistrations: 255,
	uniqueLiteralActionIds: 251,
	resolvedRegistrationRecords: 285,
	uniqueResolvedActionIds: 282,
});

export const AUDACITY_PINNED_UI_SOURCES = deepFreeze({
	'src/appshell/internal/applicationuiactions.cpp': {
		sha256: 'f111513e7bb8df4b49f4a4cd1aa78d9e33d7c1df8bf5ed869c145b8d4637bac2',
		actions: [
			'quit', 'restart', 'fullscreen', 'about-audacity', 'about-qt',
			'online-handbook', 'ask-help', 'revert-factory', 'dock-restore-default-layout',
			'toggle-transport', 'toggle-tracks', 'toggle-statusbar', 'preference-dialog',
			'action://copy', 'action://cut', 'action://paste', 'action://undo',
			'action://redo', 'action://delete', 'action://cancel', 'action://trigger',
			'action://enter',
		],
	},
	'src/appshell/qml/Audacity/AppShell/appmenumodel.cpp': {
		sha256: '7ddb0b9eb8060a326bf77176c7757fe0fc607a3a144ccecf1a5271b5786e7efc',
		actions: [],
	},
	'src/au3cloud/internal/clouduiactions.cpp': {
		sha256: 'e7da5134d669a65bea61bc95827d3321034783c3e7b05be7ff4f550385d4f2b7',
		actions: [
			'audacity://cloud/open-project-page',
			'audacity://cloud/open-audio-page',
		],
	},
	'src/project/internal/projectuiactions.cpp': {
		sha256: '831ad5f03ffd103ea9f915753841ea3bc7f2cd4589bc1487c15a7b02cc8c89d6',
		actions: [
			'file-new', 'file-open', 'project-show-in-folder', 'file-open-recent',
			'audacity://cloud/open-audio-file', 'cloud-file-open', 'clear-recent',
			'project-import', 'file-save', 'file-save-as', 'export-audio',
			'export-labels', 'export-midi', 'file-close', 'duplicate', 'insert',
			'trim-clip', 'split-into-new-track', 'paste-new-label',
			'select-all', 'select-all-tracks', 'select-left-of-playback-position',
			'select-right-of-playback-position', 'select-track-start-to-cursor',
			'select-cursor-to-track-end', 'select-track-start-to-end',
			'select-previous-clip-boundary-to-cursor',
			'select-cursor-to-next-clip-boundary', 'select-previous-clip',
			'select-next-clip', 'toggle-spectral-selection', 'zero-cross',
			'collapse-all-tracks', 'expand-all-tracks', 'skip-to-selection-start',
			'skip-to-selection-end', 'toggle-effects', 'open-metadata-editor',
			'toggle-history', 'set-up-timed-recording',
			'toggle-sound-activated-recording', 'set-sound-activation-level',
			'duplicate-track', 'remove-tracks', 'mixdown-to', 'align-end-to-end',
			'align-together', 'align-start-to-zero', 'align-start-to-playhead',
			'align-start-to-selection-end', 'align-end-to-playhead',
			'align-end-to-selection-end', 'sort-by-time', 'sort-by-name',
			'keep-tracks-synchronised', 'plugin-manager', 'add-realtime-effects',
			'favourite-effect-1', 'favourite-effect-2', 'favourite-effect-3',
			'contrast-analyzer', 'plot-spectrum', 'manage-macros',
			'apply-macros-palette', 'macro-fade-ends', 'macro-mp3-conversion',
			'nyquist-plugin-installer', 'nyquist-prompt', 'sample-data-export',
			'sample-data-import', 'raw-data-import', 'reset-configuration',
			'prev-window', 'next-window', 'benchmark', 'regular-interval-labels',
			'tutorials', 'device-info', 'midi-device-info', 'log', 'crash-report',
			'raise-segfault', 'throw-exception', 'violate-assertion', 'menu-tree',
			'frame-statistics', 'link-account', 'file-save-to-cloud',
			'file-share-audio', 'audacity://cloud/update-audio-preview',
			'audacity://cloud/update-audio-preview-for-project', 'project-properties',
		],
	},
	'src/playback/internal/playbackuiactions.cpp': {
		sha256: 'b3d1f43565089e14a175d19bc9181d399acc2aa776c2ad5e78d4e1c19dd20c14',
		actions: [
			'action://playback/toggle-play-pause', 'action://playback/toggle-play-stop',
			'action://playback/toggle-play-from-cursor', 'action://playback/play-selection',
			'action://playback/pause', 'action://playback/stop',
			'action://playback/rewind-start', 'action://playback/rewind-end',
			'toggle-loop-region', 'audio-setup',
			'get-effects', 'audio-settings', 'rescan-devices', 'metronome',
			'playback-time', 'playback-bpm', 'playback-time-signature',
			'action://playback/level', 'action://playback/change-api',
			'action://playback/change-playback-device',
			'action://playback/change-recording-device',
			'action://playback/change-input-channels', 'clear-loop-region',
			'set-loop-region-to-selection', 'set-selection-to-loop',
			'set-loop-region-in-out', 'toggle-selection-follows-loop-region',
			'repeat', 'pan',
		],
	},
	'src/record/internal/recorduiactions.cpp': {
		sha256: 'a13000f174296c20793d88c3b3ca8e77231a6743e798c508e31a8ac930d4d080',
		actions: [
			'action://record/start', 'action://record/pause', 'action://record/stop',
			'action://record/level', 'action://record/toggle-mic-metering',
			'action://record/toggle-input-monitoring',
			'action://record/lead-in-recording', 'record-on-current-track',
			'record-on-new-track',
		],
	},
	'src/effects/effects_base/internal/effectsuiactions.cpp': {
		sha256: '654d316c9f4b907072bdb3828b39fc7b4c890719092d00eaae6a2f81c943f477',
		actions: [
			'repeat-last-effect', 'realtimeeffect-remove',
			'action://effects/presets/apply', 'action://effects/presets/save_as',
			'action://effects/presets/save', 'action://effects/presets/delete',
			'action://effects/presets/import', 'action://effects/presets/export',
			'action://effects/toggle_vendor_ui',
			'action://effects/open?effectId=%1',
			'action://effects/realtime-add?effectId=%1',
			'action://effects/realtime-replace?effectId=%1',
		],
	},
	'src/effects/builtin_collection/internal/builtincollectionloader.cpp': {
		sha256: 'a99c181ef00a3bb7370dddb208b0a0b33c9c9927d577c839eae3ef27e0b5a5d3',
		actions: [],
	},
	'src/projectscene/internal/projectsceneuiactions.cpp': {
		sha256: '1732b58ab688fd41bf7898bdaba128e9f115d97555533c82e6c14d3985707227',
		actions: [
			'clip-gain', 'split-tool', 'zoom-in', 'zoom-out', 'zoom-default',
			'zoom-to-selection', 'zoom-to-fit-project', 'zoom-toggle',
			'center-view-on-playhead', 'action://trackedit/global-view-spectrogram',
			'spectral-box-select', 'spectral-brush', 'snap', 'minutes-seconds-ruler',
			'beats-measures-ruler', 'toggle-vertical-rulers', 'show-master-track',
			'toggle-update-display-while-playing', 'toggle-pinned-play-head',
			'toggle-playback-on-ruler-click-enabled', 'clip-properties',
			'action://delete', 'action://trackedit/clip/change-color-auto',
			'play-position-decrease', 'play-position-increase', 'sel-ext-left',
			'sel-ext-right', 'sel-cntr-left', 'sel-cntr-right', 'curs-sel-start',
			'curs-sel-end', 'clip-pitch-speed',
			'toggle-rms-in-waveform', 'toggle-clipping-in-waveform',
			'action://projectscene/track-view-half-wave', 'open-label-editor',
			'realtime-effect-move-up', 'realtime-effect-move-down',
			'action://trackedit/clip/change-color?colorindex=%1',
			'action://trackedit/track/change-color?colorindex=%1',
		],
	},
	'src/spectrogram/internal/spectrogramuiactions.cpp': {
		sha256: 'b937590f579aae6ba9738f74e3bf1d9bffa57db96f5435e01027091ef8e5da7f',
		actions: ['track-spectrogram-settings'],
	},
	'src/trackedit/internal/trackedituiactions.cpp': {
		sha256: '5449e1e3777f33652a8adf0ada18401dc88c73153a93192ab77de5796c742ba1',
		actions: [
			'rename-item', 'action://trackedit/copy', 'action://trackedit/cut',
			'action://trackedit/undo', 'action://trackedit/redo',
			'action://trackedit/delete', 'select-all', 'clear-selection',
			'cut-leave-gap', 'cut-per-clip-ripple', 'cut-per-track-ripple',
			'cut-all-tracks-ripple', 'delete-leave-gap',
			'delete-per-clip-ripple', 'delete-per-track-ripple',
			'delete-all-tracks-ripple', 'split', 'join', 'disjoin', 'duplicate',
			'track-rename', 'track-duplicate', 'track-delete', 'track-move-up',
			'track-move-down', 'track-move-top', 'track-move-bottom',
			'track-change-rate-custom', 'track-make-stereo', 'track-swap-channels',
			'track-split-stereo-to-lr', 'track-split-stereo-to-center',
			'track-resample', 'action://trackedit/track-view-waveform',
			'action://trackedit/track-view-spectrogram',
			'action://trackedit/track-view-multi',
			'action://trackedit/paste-default', 'action://trackedit/paste-insert',
			'action://trackedit/paste-overlap',
			'action://trackedit/paste-insert-all-tracks-ripple',
			'merge-selected-on-tracks', 'duplicate-selected', 'duplicate-clip',
			'clip-export', 'stretch-clip-to-match-tempo', 'clip-pitch-speed-open',
			'clip-render-pitch-speed', 'clip-reset-pitch-speed', 'new-mono-track',
			'new-stereo-track', 'new-label-track', 'label-add',
			'trim-audio-outside-selection', 'silence-audio-selection',
			'group-clips', 'ungroup-clips', 'track-view-item-move-left',
			'track-view-item-move-right', 'track-view-item-extend-left',
			'track-view-item-extend-right', 'track-view-item-reduce-left',
			'track-view-item-reduce-right', 'track-view-item-move-up',
			'track-view-item-move-down', 'track-view-next-panel',
			'track-view-prev-panel',
			'track-view-above-item', 'track-view-below-item',
			'track-view-first-track', 'track-view-last-track',
			'track-view-replace-selection', 'track-view-toggle-selection',
			'track-view-range-selection',
			'track-view-extend-track-selection-prev',
			'track-view-extend-track-selection-next', 'track-view-item-context-menu',
			'action://trackedit/track/change-format?format=%1',
			'action://trackedit/track/change-rate?rate=%1',
		],
	},
});

// These registrations become dynamic `action://effects/open?effectId=…`
// actions. ChangePitch is conditionally registered by upstream when
// USE_SOUNDTOUCH is enabled; it remains in the pinned source inventory while
// the browser implementation deliberately routes Change Pitch to StaffPad.
export const AUDACITY_PINNED_BUILTIN_EFFECT_REGISTRATIONS = deepFreeze([
	'FadeInEffect', 'FadeOutEffect', 'InvertEffect', 'Repair', 'ReverseEffect',
	'TruncateSilenceEffect', 'ChangePitchEffect', 'AmplifyEffect',
	'NormalizeLoudnessEffect', 'GraphicEq', 'FilterCurveEq', 'ClickRemovalEffect',
	'NormalizeEffect', 'RemoveDCOffsetEffect', 'ChirpEffect', 'ToneEffect',
	'ReverbEffect', 'BassTrebleEffect', 'PaulstretchEffect', 'SilenceGenerator',
	'SlidingStretchEffect', 'NoiseGenerator', 'NoiseReductionEffect',
	'DtmfGenerator', 'CompressorEffect', 'LimiterEffect',
]);

export const AUDACITY_PINNED_BUILTIN_EFFECT_POLICY = deepFreeze({
	FadeInEffect: { kind: 'processor', registryId: 'audacity-fade-in' },
	FadeOutEffect: { kind: 'processor', registryId: 'audacity-fade-out' },
	InvertEffect: { kind: 'processor', registryId: 'audacity-invert' },
	Repair: { kind: 'processor', registryId: 'audacity-repair' },
	ReverseEffect: { kind: 'processor', registryId: 'audacity-reverse' },
	TruncateSilenceEffect: { kind: 'processor', registryId: 'audacity-truncate-silence' },
	ChangePitchEffect: { kind: 'processor', registryId: 'audacity-change-pitch', engine: 'staffpad' },
	AmplifyEffect: { kind: 'processor', registryId: 'audacity-amplify' },
	NormalizeLoudnessEffect: { kind: 'processor', registryId: 'audacity-loudness-normalization' },
	GraphicEq: { kind: 'processor', registryId: 'audacity-graphic-eq' },
	FilterCurveEq: { kind: 'processor', registryId: 'audacity-filter-curve-eq' },
	ClickRemovalEffect: { kind: 'processor', registryId: 'audacity-click-removal' },
	NormalizeEffect: { kind: 'processor', registryId: 'audacity-normalize' },
	RemoveDCOffsetEffect: { kind: 'processor', registryId: 'audacity-remove-dc-offset' },
	ChirpEffect: { kind: 'generator', registryId: 'chirp' },
	ToneEffect: { kind: 'generator', registryId: 'tone' },
	ReverbEffect: { kind: 'processor', registryId: 'audacity-reverb' },
	BassTrebleEffect: { kind: 'processor', registryId: 'audacity-bass-treble' },
	PaulstretchEffect: { kind: 'processor', registryId: 'audacity-paulstretch' },
	SilenceGenerator: { kind: 'generator', registryId: 'silence' },
	SlidingStretchEffect: { kind: 'processor', registryId: 'audacity-sliding-stretch', engine: 'staffpad' },
	NoiseGenerator: { kind: 'generator', registryId: 'noise' },
	NoiseReductionEffect: { kind: 'processor', registryId: 'audacity-noise-reduction' },
	DtmfGenerator: { kind: 'generator', registryId: 'dtmf' },
	CompressorEffect: { kind: 'processor', registryId: 'audacity-compressor' },
	LimiterEffect: { kind: 'processor', registryId: 'audacity-limiter' },
});

// Every literal action referenced by appmenumodel.cpp, including entries in
// upstream-disabled/TODO builders, hidden developer menu builders, and the
// builders beta-4 commented out (Export other, Skip to, Align content, Sort
// tracks, Macros, Diagnostics, Audio clips/Spectral selection, and the
// Tutorials, Link account, Trim clip, Paste new label, Collapse/Expand all
// tracks, Manage macros, Contrast analyzer, Plot spectrum, Raw data import
// and Reset configuration items). Commented-out registrations stay listed so
// a later upstream restoration cannot re-enter the menu without review.
export const AUDACITY_PINNED_APP_MENU_ACTIONS = deepFreeze([
	'file-new', 'file-open', 'project-import', 'file-save', 'file-save-to-cloud',
	'file-save-as', 'audacity://cloud/update-audio-preview', 'export-audio',
	'file-share-audio', 'file-close', 'quit',
	'action://trackedit/undo', 'action://trackedit/redo', 'action://cut',
	'action://copy', 'action://paste', 'action://delete', 'duplicate',
	'action://trackedit/paste-overlap', 'action://trackedit/paste-insert',
	'action://trackedit/paste-insert-all-tracks-ripple', 'delete-per-track-ripple',
	'silence-audio-selection', 'open-metadata-editor', 'preference-dialog',
	'select-all', 'clear-selection',
	'select-all-tracks', 'zero-cross', 'toggle-effects', 'open-label-editor',
	'toggle-history', 'fullscreen', 'toggle-clipping-in-waveform',
	'toggle-rms-in-waveform', 'toggle-vertical-rulers', 'dock-restore-default-layout',
	'record-on-current-track', 'record-on-new-track', 'set-up-timed-recording',
	'action://record/lead-in-recording', 'toggle-sound-activated-recording',
	'set-sound-activation-level', 'new-mono-track', 'new-stereo-track',
	'new-label-track', 'track-duplicate', 'remove-tracks', 'mixdown-to',
	'prev-window', 'next-window', 'benchmark', 'regular-interval-labels',
	'tutorials', 'online-handbook', 'link-account', 'about-audacity', 'about-qt',
	'revert-factory', 'check-update', 'diagnostic-show-paths',
	'diagnostic-show-graphicsinfo', 'diagnostic-show-profiler',
	'diagnostic-save-diagnostic-files', 'diagnostic-show-actions',
	'diagnostic-show-navigation-tree', 'diagnostic-show-accessible-tree',
	'diagnostic-accessible-tree-dump', 'testflow-show-scripts',
	'extensions-show-apidump', 'multiwindows-dev-show-info', 'clear-recent',
	'export-labels', 'export-midi', 'rename-item', 'trim-clip', 'split',
	'split-into-new-track', 'disjoin', 'join', 'group-clips', 'ungroup-clips',
	'label-add', 'paste-new-label', 'toggle-spectral-selection',
	'select-previous-clip-boundary-to-cursor',
	'select-cursor-to-next-clip-boundary', 'select-previous-clip', 'select-next-clip',
	'select-left-of-playback-position', 'select-right-of-playback-position',
	'select-track-start-to-cursor', 'select-cursor-to-track-end',
	'select-track-start-to-end', 'toggle-loop-region', 'clear-loop-region',
	'set-loop-region-to-selection', 'set-loop-region-in-out', 'zoom-in', 'zoom-out',
	'zoom-default', 'zoom-to-selection', 'zoom-toggle', 'zoom-to-fit-project',
	'collapse-all-tracks', 'expand-all-tracks', 'skip-to-selection-start',
	'skip-to-selection-end', 'align-end-to-end', 'align-together',
	'align-start-to-zero', 'align-start-to-playhead',
	'align-start-to-selection-end', 'align-end-to-playhead',
	'align-end-to-selection-end', 'sort-by-time', 'sort-by-name',
	'apply-macros-palette', 'macro-fade-ends', 'macro-mp3-conversion',
	'insert-hbox', 'insert-vbox', 'insert-textframe', 'append-hbox', 'append-vbox',
	'append-textframe', 'configure-workspaces', 'show-invisible', 'show-unprintable',
	'show-frames', 'show-pageborders', 'show-irregular', 'show-soundflags',
	'plugin-manager', 'add-realtime-effects', 'repeat-last-effect', 'manage-macros',
	'raw-data-import', 'reset-configuration', 'contrast-analyzer', 'plot-spectrum',
	'file-open-recent',
]);

export const AUDACITY_PINNED_APP_MENU_CONTAINERS = deepFreeze([
	'menu-file-open', 'menu-export-other', 'menu-file', 'menu-clip', 'menu-label',
	'menu-edit', 'menu-selection-audio-clips', 'menu-selection-spectral',
	'menu-selection-region', 'menu-looping', 'menu-select', 'menu-zoom', 'menu-skip',
	'menu-workspaces', 'menu-view', 'menu-record', 'menu-align', 'menu-sort',
	'menu-tracks', 'menu-generate', 'menu-effect', 'menu-analyze', 'menu-tools',
	'menu-play', 'menu-scrubbing', 'menu-extra-tools', 'menu-mixer',
	'menu-extra-edit', 'menu-play-at-speed', 'menu-device', 'menu-extraselect',
	'menu-focus', 'menu-cursor', 'menu-track', 'menu-scriptables1',
	'menu-scriptables2', 'menu-images', 'menu-settings', 'menu-extra',
	'menu-diagnostics', 'menu-help', 'menu-system', 'menu-actions',
	'menu-accessibility', 'menu-extensions', 'menu-testflow', 'menu-diagnostic',
	'menu-macros',
]);

const implementedContainer = () => ({ status: 'implemented' });
const disabledContainer = (reason) => ({ status: 'disabled-upstream', reason });
const excludedContainer = (reason) => ({ status: 'excluded', reason });

// Menu containers are not dispatchable actions and therefore do not belong in
// AUDACITY_ACTION_MANIFEST. They still need an explicit parity disposition so
// a new or renamed upstream submenu cannot escape review.
export const AUDACITY_PINNED_APP_MENU_CONTAINER_POLICY = deepFreeze({
	'menu-file-open': implementedContainer(),
	'menu-export-other': implementedContainer(),
	'menu-file': implementedContainer(),
	'menu-clip': implementedContainer(),
	'menu-label': implementedContainer(),
	'menu-edit': implementedContainer(),
	'menu-selection-audio-clips': implementedContainer(),
	'menu-selection-spectral': implementedContainer(),
	'menu-selection-region': implementedContainer(),
	'menu-looping': implementedContainer(),
	'menu-select': implementedContainer(),
	'menu-zoom': implementedContainer(),
	'menu-skip': implementedContainer(),
	'menu-workspaces': implementedContainer(),
	'menu-view': implementedContainer(),
	'menu-record': implementedContainer(),
	'menu-align': disabledContainer('The pinned menu comments out the Align content submenu.'),
	'menu-sort': disabledContainer('The pinned menu comments out the Sort tracks submenu.'),
	'menu-tracks': implementedContainer(),
	'menu-generate': implementedContainer(),
	'menu-effect': implementedContainer(),
	'menu-analyze': implementedContainer(),
	'menu-tools': implementedContainer(),
	'menu-play': excludedContainer('Hidden Extra/developer menu scaffolding is excluded.'),
	'menu-scrubbing': excludedContainer('Hidden Extra/developer menu scaffolding is excluded.'),
	'menu-extra-tools': excludedContainer('Hidden Extra/developer menu scaffolding is excluded.'),
	'menu-mixer': excludedContainer('Hidden Extra/developer menu scaffolding is excluded.'),
	'menu-extra-edit': excludedContainer('Hidden Extra/developer menu scaffolding is excluded.'),
	'menu-play-at-speed': excludedContainer('Hidden Extra/developer menu scaffolding is excluded.'),
	'menu-device': excludedContainer('OS audio-device menus are excluded.'),
	'menu-extraselect': excludedContainer('Hidden Extra/developer menu scaffolding is excluded.'),
	'menu-focus': excludedContainer('Hidden Extra/developer menu scaffolding is excluded.'),
	'menu-cursor': excludedContainer('Hidden Extra/developer menu scaffolding is excluded.'),
	'menu-track': excludedContainer('Hidden Extra/developer menu scaffolding is excluded.'),
	'menu-scriptables1': excludedContainer('Hidden Extra/developer menu scaffolding is excluded.'),
	'menu-scriptables2': excludedContainer('Hidden Extra/developer menu scaffolding is excluded.'),
	'menu-images': excludedContainer('Hidden Extra/developer menu scaffolding is excluded.'),
	'menu-settings': excludedContainer('Hidden Extra/developer menu scaffolding is excluded.'),
	'menu-extra': excludedContainer('The hidden Extra menu is excluded.'),
	'menu-diagnostics': implementedContainer(),
	'menu-help': implementedContainer(),
	'menu-system': excludedContainer('Diagnostic and developer menus are excluded.'),
	'menu-actions': excludedContainer('Diagnostic and developer menus are excluded.'),
	'menu-accessibility': excludedContainer('Diagnostic and developer menus are excluded.'),
	'menu-extensions': excludedContainer('Diagnostic and developer menus are excluded.'),
	'menu-testflow': excludedContainer('Diagnostic and developer menus are excluded.'),
	'menu-diagnostic': excludedContainer('Diagnostic and developer menus are excluded.'),
	'menu-macros': disabledContainer('The pinned menu comments out the Macros submenu.'),
});

export const AUDACITY_PINNED_UI_ACTIONS = deepFreeze(
	Object.entries(AUDACITY_PINNED_UI_SOURCES).flatMap(([source, record]) => (
		record.actions.map((id) => ({ id, source }))
	)),
);

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) deepFreeze(child);
	return value;
}
