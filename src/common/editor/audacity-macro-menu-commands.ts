/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Audacity's bare macro commands — the tier that carries no parameters, where a
 * macro line is just a command name. The names are Audacity's own, taken from
 * the CommandManager registrations at Audacity 3.7.7 commit
 * 5ef610ed23260d6d648175735bb16b32536eb30b. Audacity is distributed under GPL
 * version 3; this TypeScript adaptation was created for kw.media in 2026.
 */

/**
 * Each command names the editor action it runs.
 *
 * The path is into `controller.actions`, deliberately, because that is the
 * surface that actually does something. The action manifest's own handler paths
 * include a tier that only publishes a request for the interface to open a
 * dialog — `export-audio` resolves to "open the export dialog" and returns a
 * surface id, having exported nothing. Naming the controller path instead means
 * a command that cannot be run headlessly simply has nowhere to be written down.
 *
 * What is deliberately absent, and why:
 *
 * - `Undo` and `Redo`. A macro folds its own commits into one entry; a step that
 *   walked that history would fight the transaction around it and could reach
 *   past the macro into the user's own.
 * - `Play`, `Stop`, `Record` and the devices. Nothing to wait for, and a
 *   recording step would block on hardware inside a transaction that cannot roll
 *   it back.
 * - `New`, `Open`, `Save`, `Close`, `Export*`, `Import*`, `Preferences`. The
 *   blast radius of a macro is the one project that was open when it started.
 * - The dialogs and the view toggles, which change what is shown rather than
 *   what the project is.
 */
export interface AudacityMacroMenuCommand {
	/** Audacity's own command name, as it appears in a macro file. */
	readonly command: string;
	/** The path into `controller.actions` that runs it. */
	readonly path: string;
}

export const AUDACITY_MACRO_MENU_COMMANDS: readonly AudacityMacroMenuCommand[] = Object.freeze([
	// Selection
	{ command: 'SelectAll', path: 'timeline.selectAllTracks' },
	{ command: 'SelectNone', path: 'timeline.clearSelection' },
	{ command: 'SelCursorStoredCursor', path: 'timeline.selectTrackStartToCursor' },
	{ command: 'SelTrackStartToEnd', path: 'timeline.selectTrackStartToEnd' },
	{ command: 'SelCursorToTrackEnd', path: 'timeline.selectCursorToTrackEnd' },
	{ command: 'SelPrevClip', path: 'timeline.selectPreviousClip' },
	{ command: 'SelNextClip', path: 'timeline.selectNextClip' },
	{ command: 'ZeroCross', path: 'timeline.zeroCross' },

	// Editing
	{ command: 'Cut', path: 'edit.cut' },
	{ command: 'Copy', path: 'edit.copy' },
	{ command: 'Paste', path: 'edit.paste' },
	{ command: 'Delete', path: 'edit.delete' },
	{ command: 'Duplicate', path: 'edit.duplicate' },
	{ command: 'Split', path: 'edit.split' },
	{ command: 'SplitNew', path: 'edit.splitIntoNewTrack' },
	{ command: 'Join', path: 'edit.join' },
	{ command: 'Disjoin', path: 'edit.disjoin' },
	{ command: 'Trim', path: 'edit.trimOutsideSelection' },
	{ command: 'Silence', path: 'edit.silenceSelection' },
	{ command: 'SplitCut', path: 'edit.cutLeaveGap' },
	{ command: 'SplitDelete', path: 'edit.deleteLeaveGap' },

	// Tracks
	{ command: 'NewMonoTrack', path: 'track.addMono' },
	{ command: 'NewStereoTrack', path: 'track.addStereo' },
	{ command: 'NewLabelTrack', path: 'track.addLabel' },
	{ command: 'RemoveTracks', path: 'track.remove' },
	{ command: 'MixAndRender', path: 'track.mixAndRender' },
	{ command: 'SortByName', path: 'track.sortByName' },
	{ command: 'SortByTime', path: 'track.sortByTime' },

	// Labels
	{ command: 'AddLabel', path: 'labels.add' },

	// Analysis
	{ command: 'FindClipping', path: 'analysis.findClipping' },
	{ command: 'ContrastAnalyser', path: 'analysis.contrast' },
	{ command: 'PlotSpectrum', path: 'analysis.plotSpectrum' },
	{ command: 'RepeatLastEffect', path: 'effects.repeatLast' },
]);

const BY_COMMAND = new Map(AUDACITY_MACRO_MENU_COMMANDS.map((entry) => [entry.command, entry]));

export function audacityMacroMenuCommand(command: unknown): AudacityMacroMenuCommand | null {
	return typeof command === 'string' ? BY_COMMAND.get(command) ?? null : null;
}

export function audacityMacroMenuCommandNames(): readonly string[] {
	return AUDACITY_MACRO_MENU_COMMANDS.map(({ command }) => command);
}
