/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Immutable, reviewable inventory of Audacity UI registrations at
 * 908ad0a526e5bfdab68de780e893cebe172d27eb. This is source evidence for the
 * browser parity manifest, not a second command registry. Update the hashes
 * and every list together when (and only when) the pinned revision changes.
 *
 * `%1` denotes the ActionQuery template used by upstream for dynamic effect,
 * track-rate, and track-format actions.
 */

export const AUDACITY_PINNED_UI_COMMIT = '908ad0a526e5bfdab68de780e893cebe172d27eb';

export const AUDACITY_PINNED_UI_AUDIT = deepFreeze({
	literalRegistrations: 255,
	uniqueLiteralActionIds: 251,
	resolvedRegistrationRecords: 280,
	uniqueResolvedActionIds: 277,
});

export const AUDACITY_PINNED_UI_SOURCES = deepFreeze({
	'src/appshell/internal/applicationuiactions.cpp': {
		sha256: 'fe77f9fa72345de14bb533f4e9d46298e76f83b19792143637a3dd6539aab607',
		actions: [
			'quit', 'restart', 'fullscreen', 'about-audacity', 'about-qt',
			'online-handbook', 'ask-help', 'revert-factory', 'dock-restore-default-layout',
			'toggle-transport', 'toggle-tracks', 'toggle-statusbar', 'preference-dialog',
			'action://copy', 'action://cut', 'action://paste', 'action://undo',
			'action://redo', 'action://delete', 'action://cancel', 'action://trigger',
		],
	},
	'src/appshell/qml/Audacity/AppShell/appmenumodel.cpp': {
		sha256: '22b523e2762eca1b9cb94830227c0d0f46de998bd8ca90cf5581b308c99c73f2',
		actions: [],
	},
	'src/au3cloud/internal/clouduiactions.cpp': {
		sha256: 'ba6f66ac53b5c8ab322124b6f6efef1db271a21cc6b38de8f9c350b716b6efd2',
		actions: [
			'audacity://cloud/open-project-page',
			'audacity://cloud/open-audio-page',
		],
	},
	'src/project/internal/projectuiactions.cpp': {
		sha256: '7c91e0c74571fe4036c092092608bc47d20d763902268e6e0cfe7eeff9ba64f0',
		actions: [
			'file-new', 'file-open', 'project-show-in-folder', 'file-open-recent',
			'audacity://cloud/open-audio-file', 'cloud-file-open', 'clear-recent',
			'project-import', 'file-save', 'file-save-as', 'export-audio',
			'export-labels', 'export-midi', 'file-close', 'duplicate', 'insert',
			'rename-item', 'trim-clip', 'split-into-new-track', 'paste-new-label',
			'select-all', 'select-all-tracks', 'select-left-of-playback-position',
			'select-right-of-playback-position', 'select-track-start-to-cursor',
			'select-cursor-to-track-end', 'select-track-start-to-end',
			'select-previous-clip-boundary-to-cursor',
			'select-cursor-to-next-clip-boundary', 'select-previous-clip',
			'select-next-clip', 'toggle-spectral-selection', 'zero-cross',
			'decrease-all-track-heights', 'increase-all-track-heights', 'skip-to-selection-start',
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
			'file-share-audio', 'project-properties',
		],
	},
	'src/playback/internal/playbackuiactions.cpp': {
		sha256: 'cb80b18bcf16c39aea9f79ad43cc7c96595a52013a67c1294b673242da520ca6',
		actions: [
			'action://playback/play', 'action://playback/pause',
			'action://playback/stop', 'action://playback/rewind-start',
			'action://playback/rewind-end', 'toggle-loop-region', 'audio-setup',
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
		sha256: 'f12bc73d516e06e897bad1c64ee75a6d8a0844b349fc02815c4e86e208e3c535',
		actions: [
			'action://record/start', 'action://record/pause', 'action://record/stop',
			'action://record/level', 'action://record/toggle-mic-metering',
			'action://record/toggle-input-monitoring',
			'action://record/lead-in-recording', 'record-on-current-track',
			'record-on-new-track',
		],
	},
	'src/effects/effects_base/internal/effectsuiactions.cpp': {
		sha256: '5114433ce3cdc46ff966220df573b6c085abae501040f21dc810a2d3737ea789',
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
		sha256: '760adf4a5d47e24c3a3c7d3a372c07748741042dfb3b2fe6792f02767d456a7a',
		actions: [
			'clip-gain', 'split-tool', 'zoom-in', 'zoom-out', 'zoom-default',
			'zoom-to-selection', 'zoom-to-fit-project', 'zoom-toggle',
			'center-view-on-playhead', 'action://trackedit/global-view-spectrogram',
			'spectral-box-select', 'spectral-brush', 'snap', 'minutes-seconds-ruler',
			'beats-measures-ruler', 'toggle-vertical-rulers', 'show-master-track',
			'toggle-update-display-while-playing', 'toggle-pinned-play-head',
			'toggle-playback-on-ruler-click-enabled', 'clip-properties', 'clip-rename',
			'action://delete', 'action://trackedit/clip/change-color-auto',
			'play-position-decrease', 'play-position-increase', 'sel-ext-left',
			'sel-ext-right', 'sel-cntr-left', 'sel-cntr-right', 'clip-pitch-speed',
			'toggle-rms-in-waveform', 'toggle-clipping-in-waveform',
			'action://projectscene/track-view-half-wave', 'open-label-editor',
			'realtime-effect-move-up', 'realtime-effect-move-down',
			'action://trackedit/clip/change-color?colorindex=%1',
			'action://trackedit/track/change-color?colorindex=%1',
		],
	},
	'src/spectrogram/internal/spectrogramuiactions.cpp': {
		sha256: '8f7724f05ce65a216bcb2fd9e91300309bafc03298a1673d39638fc881f03c85',
		actions: ['track-spectrogram-settings'],
	},
	'src/trackedit/internal/trackedituiactions.cpp': {
		sha256: 'f8d29c4d7bae163154cc2d38841ceb701a4129009a3041086fb39af091f3b868',
		actions: [
			'action://trackedit/copy', 'action://trackedit/cut',
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
			'track-view-prev-panel', 'track-view-next-item', 'track-view-prev-item',
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
// upstream-disabled/TODO and hidden developer menu builders.
export const AUDACITY_PINNED_APP_MENU_ACTIONS = deepFreeze([
	'file-new', 'file-open', 'project-import', 'file-save', 'file-save-to-cloud',
	'file-save-as', 'export-audio', 'file-share-audio', 'file-close', 'quit',
	'action://trackedit/undo', 'action://trackedit/redo', 'action://cut',
	'action://copy', 'action://paste', 'action://delete', 'duplicate',
	'action://trackedit/paste-overlap', 'action://trackedit/paste-insert',
	'action://trackedit/paste-insert-all-tracks-ripple', 'delete-per-track-ripple',
	'open-metadata-editor', 'preference-dialog', 'select-all', 'clear-selection',
	'select-all-tracks', 'zero-cross', 'toggle-effects', 'open-label-editor',
	'toggle-history', 'fullscreen', 'toggle-clipping-in-waveform',
	'toggle-rms-in-waveform', 'toggle-vertical-rulers', 'dock-restore-default-layout',
	'record-on-current-track', 'record-on-new-track', 'set-up-timed-recording',
	'action://record/lead-in-recording', 'toggle-sound-activated-recording',
	'set-sound-activation-level', 'new-mono-track', 'new-stereo-track',
	'new-label-track', 'duplicate-track', 'remove-tracks', 'mixdown-to',
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
	'decrease-all-track-heights', 'increase-all-track-heights', 'skip-to-selection-start',
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
	'menu-selection-audio-clips': disabledContainer('The pinned menu disables the unfinished audio-clip selection submenu.'),
	'menu-selection-spectral': disabledContainer('The pinned menu disables the unfinished spectral selection submenu.'),
	'menu-selection-region': implementedContainer(),
	'menu-looping': implementedContainer(),
	'menu-select': implementedContainer(),
	'menu-zoom': implementedContainer(),
	'menu-skip': disabledContainer('The pinned menu creates Skip to as a disabled submenu.'),
	'menu-workspaces': implementedContainer(),
	'menu-view': implementedContainer(),
	'menu-record': implementedContainer(),
	'menu-align': disabledContainer('The pinned menu creates Align content as a disabled submenu.'),
	'menu-sort': disabledContainer('The pinned menu creates Sort tracks as a disabled submenu.'),
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
	'menu-diagnostics': excludedContainer('Diagnostic and developer menus are excluded.'),
	'menu-help': implementedContainer(),
	'menu-system': excludedContainer('Diagnostic and developer menus are excluded.'),
	'menu-actions': excludedContainer('Diagnostic and developer menus are excluded.'),
	'menu-accessibility': excludedContainer('Diagnostic and developer menus are excluded.'),
	'menu-extensions': excludedContainer('Diagnostic and developer menus are excluded.'),
	'menu-testflow': excludedContainer('Diagnostic and developer menus are excluded.'),
	'menu-diagnostic': excludedContainer('Diagnostic and developer menus are excluded.'),
	'menu-macros': disabledContainer('The pinned menu creates Macros as a disabled submenu.'),
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
