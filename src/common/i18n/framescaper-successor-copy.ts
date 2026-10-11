/* SPDX-License-Identifier: AGPL-3.0-only */
const EN = Object.freeze({
	menu: 'Upgrade archive for Framescaper 1.1 development…',
	title: 'Framescaper 1.1 development — archive upgrade',
	description: 'Upgrade a complete Framescaper 1.0 archive into a separate library. Your project identity and original archive are retained. Upgraded archives use schema v2; open them with the successor editor when its linked-composition runtime is available.',
	choose: 'Choose archive to upgrade', close: 'Close', opening: 'Opening successor library…',
	retained: '{count} upgraded projects retained in the successor library.',
	verifying: 'Verifying complete archive and retaining original bytes…', schema: 'schema v2',
	original: 'Download original v1 archive', upgraded: 'Download upgraded v2 archive',
});
const DE: Readonly<Record<keyof typeof EN, string>> = Object.freeze({
	menu: 'Archiv für Framescaper 1.1 Entwicklung aktualisieren…',
	title: 'Framescaper 1.1 Entwicklung — Archiv aktualisieren',
	description: 'Ein vollständiges Framescaper-1.0-Archiv wird in eine separate Bibliothek übernommen. Projektidentität und Originalarchiv bleiben erhalten. Aktualisierte Archive verwenden Schema v2; der Nachfolgeeditor kann sie öffnen, sobald seine Laufzeit für verknüpfte Kompositionen verfügbar ist.',
	choose: 'Archiv zum Aktualisieren auswählen', close: 'Schließen', opening: 'Nachfolgebibliothek wird geöffnet…',
	retained: '{count} aktualisierte Projekte in der Nachfolgebibliothek gespeichert.',
	verifying: 'Vollständiges Archiv wird geprüft und das Original aufbewahrt…', schema: 'Schema v2',
	original: 'Originalarchiv v1 herunterladen', upgraded: 'Aktualisiertes Archiv v2 herunterladen',
});
export function framescaperSuccessorCopy(locale: string): Readonly<Record<keyof typeof EN, string>> {
	return locale.toLowerCase().startsWith('de') ? DE : EN;
}
