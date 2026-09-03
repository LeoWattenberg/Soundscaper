/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Copy for the File > DAWproject submenu and the statuses its two operations
 * publish. The main catalog sits at its maintainability ceiling, so the
 * exchange format's copy lives behind its own seam, as the export menu's does.
 */
const DAWPROJECT_COPY_ENTRIES = Object.freeze([
	['dawprojectMenu', 'DAWproject', 'DAWproject'],
	['openDawproject', 'Open DAWproject (.dawproject)', 'DAWproject (.dawproject) öffnen'],
	['saveDawproject', 'Export DAWproject', 'DAWproject exportieren'],
	['dawprojectReport', 'DAWproject exchange report', 'DAWproject-Austauschbericht'],
	['chooseDawprojectFile', 'Choose a DAWproject file (.dawproject).', 'Wähle eine DAWproject-Datei (.dawproject).'],
	['dawprojectOpened', 'DAWproject imported.', 'DAWproject importiert.'],
	['dawprojectSaving', 'Exporting DAWproject', 'DAWproject wird exportiert'],
	['dawprojectSaved', 'DAWproject exported.', 'DAWproject exportiert.'],
]);

export const DAWPROJECT_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(DAWPROJECT_COPY_ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(DAWPROJECT_COPY_ENTRIES.map(([key, , de]) => [key, de]))),
});
