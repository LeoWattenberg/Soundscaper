/* SPDX-License-Identifier: AGPL-3.0-only */

type ShortcutBindingTuple = readonly [actionId: string, ...sequences: string[]];

function freezeBindings(
	entries: readonly ShortcutBindingTuple[],
): Readonly<Record<string, readonly string[]>> {
	return Object.freeze(Object.fromEntries(entries.map(([actionId, ...sequences]) => (
		[actionId, Object.freeze(sequences)]
	))));
}

/** Lean runtime projection of the reviewed Audacity compatibility profile. */
export const AUDACITY_SHORTCUT_BINDINGS_BY_ACTION = freezeBindings([
	['track-view-next-panel', 'F6', '`', 'Tab'],
	['track-view-prev-panel', 'Shift+F6', 'Shift+`', 'Shift+Tab', 'Ctrl+Shift+F6'],
	['action://copy', 'Ctrl+C'],
	['action://cut', 'Ctrl+X'],
	['action://paste', 'Ctrl+V'],
	['action://trackedit/undo', 'Ctrl+Z'],
	['action://trackedit/redo', 'Ctrl+Shift+Z'],
	['action://delete', 'Del', 'Backspace'],
	['track-view-item-context-menu', 'Shift+F10', 'Ctrl+Shift+F10', 'Shift+M'],
	['track-view-above-item', 'Up'],
	['track-view-below-item', 'Down'],
	['track-view-first-track', 'Ctrl+Home'],
	['track-view-last-track', 'Ctrl+End'],
	['track-view-toggle-selection', 'Ctrl+Enter', 'Ctrl+Return', 'Return', 'NUMPAD_ENTER'],
	['track-view-range-selection', 'Shift+Enter', 'Shift+Return'],
	['track-view-extend-track-selection-prev', 'Shift+Up'],
	['track-view-extend-track-selection-next', 'Shift+Down'],
	['action://trackedit/paste-overlap', 'Ctrl+Alt+V'],
	['insert', 'Shift+V'],
	['action://trackedit/paste-insert-all-tracks-ripple', 'Ctrl+Alt+Shift+V'],
	['set-up-timed-recording', 'Shift+T'],
	['contrast-analyzer', 'Ctrl+Shift+T'],
	['select-previous-clip', 'Alt+,'],
	['select-next-clip', 'Alt+.'],
	['cut-per-track-ripple', 'Ctrl+Shift+X'],
	['duplicate', 'Ctrl+D'],
	['silence-audio-selection', 'Ctrl+L'],
	['trim-audio-outside-selection', 'Ctrl+T'],
	['split', 'Ctrl+I'],
	['split-into-new-track', 'Ctrl+Alt+I'],
	['join', 'Ctrl+J'],
	['disjoin', 'Ctrl+Alt+J'],
	['split-tool', 'S'],
	['preference-dialog', 'Ctrl+,'],
	['delete-per-track-ripple', 'Shift+Del', 'Shift+Backspace'],
	['delete-all-tracks-ripple', 'Ctrl+Del', 'Ctrl+Backspace'],
	['file-new', 'Ctrl+N'],
	['file-open', 'Ctrl+O'],
	['file-save', 'Ctrl+S'],
	['file-close', 'Ctrl+W'],
	['export-audio', 'Ctrl+Shift+E'],
	['project-import', 'Ctrl+Shift+I'],
	['label-add', 'Ctrl+B', 'Ctrl+.'],
	['add-realtime-effects', 'E'],
	['repeat-last-effect', 'Ctrl+R'],
	['select-all', 'Ctrl+A'],
	['clear-selection', 'Ctrl+Shift+A'],
	['select-all-tracks', 'Ctrl+Shift+K'],
	['select-left-of-playback-position', '['],
	['select-right-of-playback-position', ']'],
	['select-track-start-to-cursor', 'Shift+J', 'Shift+Home'],
	['select-cursor-to-track-end', 'Shift+K', 'Shift+End'],
	['zero-cross', 'Z'],
	['track-view-item-extend-left', 'Shift+Left'],
	['track-view-item-extend-right', 'Shift+Right'],
	['track-view-item-reduce-right', 'Ctrl+Shift+Right'],
	['track-view-item-reduce-left', 'Ctrl+Shift+Left'],
	['action://playback/rewind-start', 'Home'],
	['action://playback/rewind-end', 'End'],
	['play-position-decrease', 'Left'],
	['play-position-increase', 'Right'],
	['cursor-short-jump-left', ','],
	['cursor-short-jump-right', '.'],
	['cursor-long-jump-left', 'Shift+,'],
	['cursor-long-jump-right', 'Shift+.'],
	['mix-render', 'Ctrl+Shift+M'],
	['local://mute-all', 'Ctrl+U'],
	['local://unmute-all', 'Ctrl+Shift+U'],
	['mute-tracks', 'Ctrl+Alt+U'],
	['unmute-tracks', 'Ctrl+Alt+Shift+U'],
	['group-clips', 'Ctrl+G'],
	['ungroup-clips', 'Ctrl+Shift+G'],
	['track-pan-left', 'Alt+Shift+Left'],
	['track-pan-right', 'Alt+Shift+Right'],
	['track-gain-inc', 'Alt+Shift+Up'],
	['track-gain-dec', 'Alt+Shift+Down'],
	['track-mute', 'Shift+U'],
	['track-solo', 'Shift+S'],
	['remove-tracks', 'Shift+C'],
	['action://playback/play', 'P'],
	['record-on-current-track', 'R'],
	['action://record/lead-in-recording', 'Shift+D'],
	['toggle-loop-region', 'L'],
	['clear-loop-region', 'Shift+Alt+L'],
	['set-loop-region-to-selection', 'Shift+L'],
	['set-loop-region-in-out', 'I'],
	['action://playback/toggle-play-stop', 'Space'],
	['action://playback/toggle-play-from-cursor', 'Shift+Space'],
	['zoom-in', 'Ctrl+='],
	['zoom-default', 'Ctrl+2'],
	['zoom-out', 'Ctrl+-'],
	['zoom-to-selection', 'Ctrl+E'],
	['zoom-toggle', 'Shift+Z'],
	['zoom-to-fit-project', 'Ctrl+F'],
	['fit-height', 'Ctrl+Shift+F'],
	['skip-to-selection-start', 'Ctrl+['],
	['skip-to-selection-end', 'Ctrl+]'],
	['select-tool', 'F1'],
	['draw-tool', 'F3'],
	['toggle-spectral-selection', 'Q'],
	['rename-item', 'F2'],
	['clip-pitch-speed', 'Ctrl+Shift+P'],
	['realtime-effect-move-up', 'Alt+Up'],
	['realtime-effect-move-down', 'Alt+Down'],
	['new-mono-track', 'Ctrl+Shift+N'],
	['track-view-item-move-left', 'Ctrl+Left'],
	['track-view-item-move-right', 'Ctrl+Right'],
	['track-view-item-move-up', 'Ctrl+Up'],
	['track-view-item-move-down', 'Ctrl+Down'],
]);

/** Soundscaper defaults intentionally retained outside Audacity's XML inventory. */
export const AUDIO_EDITOR_SUPPLEMENTAL_SHORTCUT_BINDINGS_BY_ACTION: Readonly<Record<string, readonly string[]>> = freezeBindings([
	['fullscreen', 'F11'],
]);

/** Return the imported primary binding used in menus and command search. */
export function audacityPrimaryShortcut(actionId: string): string | null {
	return AUDACITY_SHORTCUT_BINDINGS_BY_ACTION[actionId]?.[0] || null;
}

/** Return the effective primary binding used by runtime metadata and generated references. */
export function audioEditorPrimaryShortcut(actionId: string): string | null {
	return audacityPrimaryShortcut(actionId)
		|| AUDIO_EDITOR_SUPPLEMENTAL_SHORTCUT_BINDINGS_BY_ACTION[actionId]?.[0]
		|| null;
}
