/* SPDX-License-Identifier: AGPL-3.0-only */

export const AUDIO_EDITOR_BUILT_IN_WORKSPACES = Object.freeze([
	'classic',
	'music',
	'modern',
	'audacity',
	'video-editor',
] as const);

export const DEFAULT_TOOLBARS = Object.freeze({
	transport: Object.freeze({ visible: true, order: 0 }),
	tools: Object.freeze({ visible: true, order: 1 }),
	edit: Object.freeze({ visible: true, order: 2 }),
	meter: Object.freeze({ visible: true, order: 3 }),
});

export const DEFAULT_TOOLBAR_BUTTONS = Object.freeze({
	play: true,
	'play-at-speed': true,
	stop: true,
	record: true,
	'jump-start': true,
	'jump-end': true,
	loop: true,
	metronome: false,
	'split-tool': true,
	'waveform-view': true,
	'spectrogram-view': true,
	'spectral-box-select': true,
	'spectral-brush': false,
	'zoom-in': true,
	'zoom-out': true,
	'zoom-fit': true,
	undo: true,
	redo: true,
	cutPerTrackRipple: true,
	cutLeaveGap: false,
	cutAllTracksRipple: false,
	copy: true,
	paste: true,
	split: true,
	deletePerTrackRipple: true,
	deleteLeaveGap: false,
	deleteAllTracksRipple: false,
	'time-display': true,
	monitor: true,
	'playback-volume': true,
	snap: false,
	'workspace-switcher': false,
});

const MODERN_TOOLBAR_BUTTONS = Object.freeze({
	...DEFAULT_TOOLBAR_BUTTONS,
	cutPerTrackRipple: false,
	copy: false,
	paste: false,
	split: false,
	deletePerTrackRipple: false,
});

// Audacity 4.0.0-beta.4 Modern workspace: play, stop, record, rewind, loop |
// split, spectrogram, zoom in/out | timecode | snap | meters, plus the
// "Workspace" dropdown in the action bar.
export const AUDACITY_TOOLBAR_BUTTONS = Object.freeze({
	...MODERN_TOOLBAR_BUTTONS,
	'play-at-speed': false,
	'spectral-box-select': false,
	'spectral-brush': false,
	'zoom-fit': false,
	snap: true,
	'workspace-switcher': true,
});

// The view block is the analogue of Audacity's `.mws` ui_settings: it is applied
// when a preset is activated and never enters the persisted preferences.
export interface WorkspaceViewDefaults {
	readonly verticalRulers?: boolean;
	readonly playbackMeterPosition?: 'flyout' | 'top' | 'side';
	readonly recordingMeterPosition?: 'flyout' | 'top' | 'side';
}

const MODERN_VIEW_DEFAULTS: WorkspaceViewDefaults = Object.freeze({
	verticalRulers: true,
	playbackMeterPosition: 'side',
	recordingMeterPosition: 'side',
});

const AUDACITY_VIEW_DEFAULTS: WorkspaceViewDefaults = Object.freeze({
	verticalRulers: false,
	playbackMeterPosition: 'side',
	recordingMeterPosition: 'flyout',
});

export const DEFAULT_PANELS = Object.freeze({
	'project-bin': Object.freeze({ visible: true, dock: 'left', order: 0, size: 380 }),
	'video-preview': Object.freeze({ visible: true, dock: 'floating', order: 0, size: 560 }),
	// The source monitor belongs to editing from a bin, so it is offered where
	// that is the work and stays available but hidden everywhere else.
	'source-monitor': Object.freeze({ visible: false, dock: 'floating', order: 1, size: 460 }),
	history: Object.freeze({ visible: false, dock: 'right', order: 0, size: 320 }),
	labels: Object.freeze({ visible: false, dock: 'right', order: 1, size: 320 }),
	metadata: Object.freeze({ visible: false, dock: 'right', order: 2, size: 320 }),
	effects: Object.freeze({ visible: false, dock: 'right', order: 3, size: 360 }),
	mixer: Object.freeze({ visible: false, dock: 'bottom', order: 4, size: 460 }),
	markers: Object.freeze({ visible: false, dock: 'right', order: 5, size: 360 }),
	analysis: Object.freeze({ visible: false, dock: 'right', order: 6, size: 380 }),
	spectrum: Object.freeze({ visible: false, dock: 'right', order: 7, size: 380 }),
	clipping: Object.freeze({ visible: false, dock: 'right', order: 8, size: 380 }),
	contrast: Object.freeze({ visible: false, dock: 'right', order: 9, size: 380 }),
	'ebu-r128': Object.freeze({ visible: false, dock: 'right', order: 10, size: 380 }),
	'recording-setup': Object.freeze({ visible: false, dock: 'bottom', order: 11, size: 420 }),
	'web-vcr': Object.freeze({ visible: false, dock: 'bottom', order: 12, size: 640 }),
});

export const DEFAULT_FLOATING_PANEL_GEOMETRY = Object.freeze({
	'project-bin': Object.freeze({ x: 24, y: 24, width: 380, height: 520 }),
	'video-preview': Object.freeze({ x: 72, y: 40, width: 560, height: 390 }),
	'source-monitor': Object.freeze({ x: 96, y: 72, width: 460, height: 420 }),
	history: Object.freeze({ x: 24, y: 24, width: 360, height: 320 }),
	labels: Object.freeze({ x: 48, y: 48, width: 360, height: 360 }),
	metadata: Object.freeze({ x: 72, y: 72, width: 380, height: 360 }),
	effects: Object.freeze({ x: 96, y: 40, width: 400, height: 440 }),
	mixer: Object.freeze({ x: 40, y: 96, width: 560, height: 360 }),
	markers: Object.freeze({ x: 120, y: 64, width: 520, height: 380 }),
	analysis: Object.freeze({ x: 144, y: 88, width: 520, height: 600 }),
	spectrum: Object.freeze({ x: 168, y: 112, width: 520, height: 600 }),
	clipping: Object.freeze({ x: 192, y: 136, width: 520, height: 600 }),
	contrast: Object.freeze({ x: 216, y: 160, width: 520, height: 600 }),
	'ebu-r128': Object.freeze({ x: 240, y: 184, width: 440, height: 460 }),
	'recording-setup': Object.freeze({ x: 88, y: 88, width: 620, height: 520 }),
	'web-vcr': Object.freeze({ x: 112, y: 64, width: 760, height: 620 }),
});

export const AUDIO_EDITOR_WORKSPACE_PRESETS = Object.freeze({
	classic: Object.freeze({
		toolbars: Object.freeze({
			transport: Object.freeze({ visible: true, order: 0 }),
			tools: Object.freeze({ visible: true, order: 1 }),
			edit: Object.freeze({ visible: true, order: 2 }),
			meter: Object.freeze({ visible: true, order: 3 }),
		}),
		toolbarButtons: DEFAULT_TOOLBAR_BUTTONS,
		panels: Object.freeze({
			'project-bin': Object.freeze({ visible: false, dock: 'left', order: 0, size: 380 }),
			history: Object.freeze({ visible: false, dock: 'left', order: 0, size: 300 }),
			labels: Object.freeze({ visible: false, dock: 'right', order: 1, size: 320 }),
			metadata: Object.freeze({ visible: false, dock: 'right', order: 2, size: 320 }),
			effects: Object.freeze({ visible: false, dock: 'right', order: 3, size: 360 }),
			mixer: Object.freeze({ visible: false, dock: 'bottom', order: 4, size: 460 }),
			markers: Object.freeze({ visible: false, dock: 'right', order: 5, size: 360 }),
		}),
	}),
	music: Object.freeze({
		toolbars: Object.freeze({
			transport: Object.freeze({ visible: true, order: 0 }),
			tools: Object.freeze({ visible: true, order: 1 }),
			edit: Object.freeze({ visible: true, order: 2 }),
			meter: Object.freeze({ visible: true, order: 3 }),
		}),
		toolbarButtons: DEFAULT_TOOLBAR_BUTTONS,
		panels: Object.freeze({
			...DEFAULT_PANELS,
			effects: Object.freeze({ visible: true, dock: 'right', order: 0, size: 360 }),
			mixer: Object.freeze({ visible: true, dock: 'bottom', order: 0, size: 460 }),
		}),
	}),
	modern: Object.freeze({
		toolbars: DEFAULT_TOOLBARS,
		toolbarButtons: MODERN_TOOLBAR_BUTTONS,
		panels: DEFAULT_PANELS,
		view: MODERN_VIEW_DEFAULTS,
	}),
	audacity: Object.freeze({
		toolbars: DEFAULT_TOOLBARS,
		toolbarButtons: AUDACITY_TOOLBAR_BUTTONS,
		panels: Object.freeze({
			...DEFAULT_PANELS,
			'project-bin': Object.freeze({ visible: false, dock: 'left', order: 0, size: 380 }),
		}),
		view: AUDACITY_VIEW_DEFAULTS,
	}),
	'video-editor': Object.freeze({
		toolbars: DEFAULT_TOOLBARS,
		toolbarButtons: DEFAULT_TOOLBAR_BUTTONS,
		panels: Object.freeze({
			...DEFAULT_PANELS,
			'project-bin': Object.freeze({ visible: true, dock: 'left', order: 0, size: 380 }),
			'video-preview': Object.freeze({ visible: true, dock: 'right', order: 0, size: 560 }),
			'source-monitor': Object.freeze({ visible: true, dock: 'right', order: 1, size: 460 }),
		}),
	}),
});

export function workspaceViewDefaults(activeId: string): WorkspaceViewDefaults | null {
	if (!Object.hasOwn(AUDIO_EDITOR_WORKSPACE_PRESETS, activeId)) return null;
	const preset = AUDIO_EDITOR_WORKSPACE_PRESETS[activeId as keyof typeof AUDIO_EDITOR_WORKSPACE_PRESETS] as {
		readonly view?: WorkspaceViewDefaults;
	};
	return preset.view ?? null;
}
