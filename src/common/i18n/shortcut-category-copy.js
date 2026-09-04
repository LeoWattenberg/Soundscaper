/* SPDX-License-Identifier: AGPL-3.0-only */

import { localeLanguage } from './locale.js';

/**
 * Names for the groups the shortcut editor sorts commands into. A command that
 * the running menubar contains is grouped under that menu's own live label; the
 * rest are grouped by the first place the action inventory records them, and
 * these are the names those places carry.
 */
const ENTRIES = Object.freeze([
	['shortcutCategoryFile', 'File', 'Datei'],
	['shortcutCategoryEdit', 'Edit', 'Bearbeiten'],
	['shortcutCategorySelect', 'Select', 'Auswählen'],
	['shortcutCategoryView', 'View', 'Ansicht'],
	['shortcutCategoryRecord', 'Record', 'Aufnahme'],
	['shortcutCategoryTransport', 'Transport', 'Transport'],
	['shortcutCategoryTracks', 'Tracks', 'Spuren'],
	['shortcutCategoryGenerate', 'Generate', 'Erzeugen'],
	['shortcutCategoryEffect', 'Effect', 'Effekt'],
	['shortcutCategoryAnalyze', 'Analyze', 'Analyse'],
	['shortcutCategoryTools', 'Tools', 'Werkzeuge'],
	['shortcutCategoryHelp', 'Help', 'Hilfe'],
	['shortcutCategoryExtra', 'Extra', 'Extra'],
	['shortcutCategoryNyquist', 'Nyquist', 'Nyquist'],
	['shortcutCategoryApplication', 'Application', 'Anwendung'],
	['shortcutCategoryApplicationMenu', 'Application menu', 'Anwendungsmenü'],
	['shortcutCategoryDeveloperMenu', 'Developer menu', 'Entwicklermenü'],
	['shortcutCategoryDiagnostics', 'Diagnostics', 'Diagnose'],
	['shortcutCategoryAudioSetup', 'Audio setup', 'Audio-Einrichtung'],
	['shortcutCategoryKeyboardNavigation', 'Keyboard navigation', 'Tastaturnavigation'],
	['shortcutCategoryClipContext', 'Clip context menu', 'Clip-Kontextmenü'],
	['shortcutCategoryTrackContext', 'Track context menu', 'Spur-Kontextmenü'],
	['shortcutCategoryClipProperties', 'Clip properties', 'Clip-Eigenschaften'],
	['shortcutCategoryRealtimeEffectContext', 'Realtime effect context menu', 'Echtzeiteffekt-Kontextmenü'],
	['shortcutCategoryRealtimeEffectRack', 'Realtime effect rack', 'Echtzeiteffekt-Rack'],
	['shortcutCategoryEffectDialog', 'Effect dialog', 'Effektdialog'],
	['shortcutCategoryToolsToolbar', 'Tools toolbar', 'Werkzeugleiste'],
	['shortcutCategoryTransportToolbar', 'Transport toolbar', 'Transportleiste'],
	['shortcutCategoryMixerToolbar', 'Mixer toolbar', 'Mischpultleiste'],
	['shortcutCategoryMeterToolbar', 'Meter toolbar', 'Pegelleiste'],
	['shortcutCategoryTimelineRuler', 'Timeline ruler', 'Zeitleiste'],
	['shortcutCategoryCommandInventory', 'Command inventory', 'Befehlsverzeichnis'],
	['shortcutCategoryOther', 'Other commands', 'Weitere Befehle'],
]);

export const SHORTCUT_CATEGORY_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(ENTRIES.map(([key, , de]) => [key, de]))),
});

/** Resolve one category name from a copy catalog or a bare locale. */
export function shortcutCategoryCopyValue(key, copyOrLocale = 'en') {
	const fallback = SHORTCUT_CATEGORY_COPY_BY_LOCALE.en;
	if (copyOrLocale && typeof copyOrLocale === 'object') {
		return copyOrLocale[key] ?? fallback[key] ?? key;
	}
	const catalog = SHORTCUT_CATEGORY_COPY_BY_LOCALE[localeLanguage(copyOrLocale)] || fallback;
	return catalog[key] ?? fallback[key] ?? key;
}
