/* SPDX-License-Identifier: AGPL-3.0-only */

export interface MacroManagerCopy {
	readonly cancelRun: string;
	readonly runCancelled: string;
	readonly newProgram: string;
	readonly program: string;
	readonly programName: string;
	readonly runProgram: string;
	readonly programApplied: string;
	readonly sandboxNotice: string;
	readonly tabHint: string;
	readonly failure: string;
	readonly failureAtLine: string;
}

const ENGLISH: MacroManagerCopy = Object.freeze({
	cancelRun: 'Cancel run',
	runCancelled: 'Macro cancelled.',
	newProgram: 'New program',
	program: 'Program',
	programName: 'Program name',
	runProgram: 'Run program',
	programApplied: 'Program applied.',
	sandboxNotice: 'A program runs in a sandbox with no network, no files and no access to your other projects. '
		+ 'Inside this project it can do anything you can, including deleting audio; one undo reverses the whole run.',
	tabHint: 'Tab inserts two spaces. Press Escape and then Tab to leave the program.',
	failure: 'The program failed:',
	failureAtLine: 'The program failed on line {line}:',
});

const GERMAN: MacroManagerCopy = Object.freeze({
	cancelRun: 'Ausführung abbrechen',
	runCancelled: 'Makro abgebrochen.',
	newProgram: 'Neues Programm',
	program: 'Programm',
	programName: 'Programmname',
	runProgram: 'Programm ausführen',
	programApplied: 'Programm angewendet.',
	sandboxNotice: 'Ein Programm läuft in einer Sandbox ohne Netzwerk, ohne Dateien und ohne Zugriff auf Ihre anderen Projekte. '
		+ 'Innerhalb dieses Projekts kann es alles tun, was Sie tun können, auch Audio löschen; ein Rückgängig macht den gesamten Lauf rückgängig.',
	tabHint: 'Tab fügt zwei Leerzeichen ein. Drücken Sie Escape und dann Tab, um das Programm zu verlassen.',
	failure: 'Das Programm ist fehlgeschlagen:',
	failureAtLine: 'Das Programm ist in Zeile {line} fehlgeschlagen:',
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
