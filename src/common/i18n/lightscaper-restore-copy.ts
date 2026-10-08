/* SPDX-License-Identifier: AGPL-3.0-only */

export const LIGHTSCAPER_RESTORE_COPY_EN = Object.freeze({
	title: 'Restore catalog backup…',
	description: 'Open a backup as a separate library. Your current library is kept.',
	file: 'Catalog backup file',
	restore: 'Restore', cancel: 'Cancel', close: 'Close',
	working: 'Restoring catalog…', cancelled: 'Restoration cancelled.',
	failed: 'Catalog restoration failed.',
	acknowledged: 'Restored library: {name}',
	summary: '{photos} photos, {stacks} stacks, {filters} saved filters; {originals} originals ({bytes} bytes).',
	cleanupFailed: 'The library was restored, but cleanup could not finish.',
	publicationReconciled: 'The restored library was confirmed after an interrupted response.',
});
export const LIGHTSCAPER_RESTORE_COPY_DE: Readonly<Record<keyof typeof LIGHTSCAPER_RESTORE_COPY_EN, string>> = Object.freeze({
	title: 'Katalogsicherung wiederherstellen…',
	description: 'Öffne eine Sicherung als separate Bibliothek. Deine aktuelle Bibliothek bleibt erhalten.',
	file: 'Katalogsicherungsdatei',
	restore: 'Wiederherstellen', cancel: 'Abbrechen', close: 'Schließen',
	working: 'Katalog wird wiederhergestellt…', cancelled: 'Wiederherstellung abgebrochen.',
	failed: 'Die Katalogwiederherstellung ist fehlgeschlagen.',
	acknowledged: 'Wiederhergestellte Bibliothek: {name}',
	summary: '{photos} Fotos, {stacks} Stapel, {filters} gespeicherte Filter; {originals} Originale ({bytes} Bytes).',
	cleanupFailed: 'Die Bibliothek wurde wiederhergestellt, aber die Bereinigung konnte nicht abgeschlossen werden.',
	publicationReconciled: 'Die wiederhergestellte Bibliothek wurde nach einer unterbrochenen Antwort bestätigt.',
});
export type PhotoLibraryRestoreCopyV1 = Readonly<Record<keyof typeof LIGHTSCAPER_RESTORE_COPY_EN, string>>;
export function lightscaperRestoreCopy(locale: string): PhotoLibraryRestoreCopyV1 {
	return locale.toLowerCase().split('-')[0] === 'de' ? LIGHTSCAPER_RESTORE_COPY_DE : LIGHTSCAPER_RESTORE_COPY_EN;
}
