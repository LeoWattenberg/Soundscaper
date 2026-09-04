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
	['zoomPreferences', 'Zoom', 'Zoom'],
	['mouseZoomPrecision', 'Mouse zoom precision', 'Mausrad-Zoomgenauigkeit'],
	['mouseZoomPrecisionNote', 'How many mouse-wheel notches double the timeline zoom.', 'Wie viele Mausradstufen den Zeitachsen-Zoom verdoppeln.'],
	['startupContinueLastSession', 'Continue last session', 'Letzte Sitzung fortsetzen'],
	['startupNewProject', 'Start with new project', 'Mit neuem Projekt beginnen'],
	['startupProject', 'Start with project:', 'Mit Projekt beginnen:'],
	['startupProjectSelect', 'Startup project', 'Startprojekt'],
]);

export const PREFERENCES_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(ENTRIES.map(([key, , de]) => [key, de]))),
});
