/* SPDX-License-Identifier: AGPL-3.0-only */

export interface MacroManagerCopy {
	readonly cancelRun: string;
	readonly runCancelled: string;
}

const ENGLISH: MacroManagerCopy = Object.freeze({
	cancelRun: 'Cancel run',
	runCancelled: 'Macro cancelled.',
});

const GERMAN: MacroManagerCopy = Object.freeze({
	cancelRun: 'Ausführung abbrechen',
	runCancelled: 'Makro abgebrochen.',
});

/**
 * Copy the macro manager owns, kept out of the legacy catalog.
 *
 * `src/common/i18n/catalogs.js` sits exactly on its size ratchet, so a topical
 * module is where new manager strings belong — the same arrangement the built-in
 * template copy already uses.
 */
export function resolveMacroManagerCopy(locale?: string): MacroManagerCopy {
	return locale?.toLowerCase().startsWith('de') ? GERMAN : ENGLISH;
}
