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
	readonly importProgram: string;
	readonly exportProgram: string;
	readonly programImported: string;
	readonly programImportFailed: string;
	readonly reviewHeading: string;
	readonly reviewOrigin: string;
	readonly reviewUnknownOrigin: string;
	readonly reviewRisk: string;
	readonly reviewAcknowledge: string;
	readonly enableProgram: string;
	readonly notTrusted: string;
	readonly programs: string;
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
	importProgram: 'Import program',
	exportProgram: 'Export program',
	programImported: 'Imported. This macro is a program — review it before running it.',
	programImportFailed: 'The program could not be imported: {message}',
	reviewHeading: 'Review this program before running it',
	reviewOrigin: 'This program came from {origin} and has not been run.',
	reviewUnknownOrigin: 'This program came from a file and has not been run.',
	reviewRisk: 'It was written by whoever sent it to you. It runs in a sandbox with no network, '
		+ 'no files and no access to your other projects, but inside this project it can do anything '
		+ 'you can, including deleting audio. Only enable programs from people you trust.',
	reviewAcknowledge: 'I have read this program and want to run it.',
	enableProgram: 'Enable this program',
	notTrusted: 'This program has not been reviewed yet.',
	programs: 'Programs',
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
	importProgram: 'Programm importieren',
	exportProgram: 'Programm exportieren',
	programImported: 'Importiert. Dieses Makro ist ein Programm – prüfen Sie es, bevor Sie es ausführen.',
	programImportFailed: 'Das Programm konnte nicht importiert werden: {message}',
	reviewHeading: 'Prüfen Sie dieses Programm, bevor Sie es ausführen',
	reviewOrigin: 'Dieses Programm stammt aus {origin} und wurde noch nicht ausgeführt.',
	reviewUnknownOrigin: 'Dieses Programm stammt aus einer Datei und wurde noch nicht ausgeführt.',
	reviewRisk: 'Es wurde von der Person geschrieben, die es Ihnen geschickt hat. Es läuft in einer Sandbox '
		+ 'ohne Netzwerk, ohne Dateien und ohne Zugriff auf Ihre anderen Projekte, aber innerhalb dieses '
		+ 'Projekts kann es alles tun, was Sie tun können, auch Audio löschen. Aktivieren Sie nur Programme '
		+ 'von Personen, denen Sie vertrauen.',
	reviewAcknowledge: 'Ich habe dieses Programm gelesen und möchte es ausführen.',
	enableProgram: 'Dieses Programm aktivieren',
	notTrusted: 'Dieses Programm wurde noch nicht geprüft.',
	programs: 'Programme',
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
