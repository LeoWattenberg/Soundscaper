/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Copy for the DAWproject export entry and the statuses the exchange's two
 * operations publish; opening one runs through the ordinary Open command, so
 * the format needs no label of its own there. The main catalog sits at its
 * maintainability ceiling, so the exchange format's copy lives behind its own
 * seam, as the export menu's does.
 */
const DAWPROJECT_COPY_ENTRIES = Object.freeze([
	['saveDawproject', 'Export DAWproject', 'DAWproject exportieren'],
	['chooseDawprojectFile', 'Choose a DAWproject file (.dawproject).', 'Wähle eine DAWproject-Datei (.dawproject).'],
	['dawprojectOpened', 'DAWproject imported.', 'DAWproject importiert.'],
	['dawprojectSaving', 'Exporting DAWproject', 'DAWproject wird exportiert'],
	['dawprojectSaved', 'DAWproject exported.', 'DAWproject exportiert.'],
]);

export const DAWPROJECT_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(DAWPROJECT_COPY_ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(DAWPROJECT_COPY_ENTRIES.map(([key, , de]) => [key, de]))),
});
