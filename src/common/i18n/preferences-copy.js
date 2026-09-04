/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Copy for the Preferences dialog's own pages. Audacity's General page names
 * its start modes here; the editor's other preference labels still live in the
 * main catalog.
 */
const ENTRIES = Object.freeze([
	['preferencesAudioSettings', 'Audio settings', 'Audio-Einstellungen'],
	['preferencesPlaybackRecording', 'Playback/Recording', 'Wiedergabe/Aufnahme'],
	['programStart', 'Program start', 'Programmstart'],
	['preferencesEffects', 'Effects', 'Effekte'],
	['effectOptions', 'Effect options', 'Effektoptionen'],
	['effectMenuOrganization', 'Effect menu organization', 'Anordnung des Effektmenüs'],
	['effectGroupByCategory', 'Group by category', 'Nach Kategorie gruppieren'],
	['effectSortByName', 'Sort by effect name', 'Nach Effektnamen sortieren'],
	['zoomPreferences', 'Zoom', 'Zoom'],
	['mouseZoomPrecision', 'Mouse zoom precision', 'Mausrad-Zoomgenauigkeit'],
	['mouseZoomPrecisionNote', 'How many mouse-wheel notches double the timeline zoom.', 'Wie viele Mausradstufen den Zeitachsen-Zoom verdoppeln.'],
	['startupContinueLastSession', 'Continue last session', 'Letzte Sitzung fortsetzen'],
	['startupNewProject', 'Start with new project', 'Mit neuem Projekt beginnen'],
	['startupProject', 'Start with project:', 'Mit Projekt beginnen:'],
	['startupProjectSelect', 'Startup project', 'Startprojekt'],
	['shortcutSortMode', 'Sort commands', 'Befehle sortieren'],
	['shortcutSortCategorized', 'By category', 'Nach Kategorie'],
	['shortcutSortAlphabetical', 'Alphabetical', 'Alphabetisch'],
	['shortcutAddBinding', 'Add shortcut', 'Kürzel hinzufügen'],
	['shortcutRemoveBinding', 'Remove shortcut', 'Kürzel entfernen'],
]);

export const PREFERENCES_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(ENTRIES.map(([key, , de]) => [key, de]))),
});
