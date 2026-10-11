/* SPDX-License-Identifier: AGPL-3.0-only */
export const FRAMESCAPER_SUCCESSOR_ENGLISH_COPY = Object.freeze({
	menu: 'Upgrade archive for Framescaper 1.1 development…',
	title: 'Framescaper 1.1 development — archive upgrade',
	description: 'Upgrade a complete Framescaper 1.0 archive into a separate library. Your project identity and original archive are retained. Open the upgraded project in this successor editor. Upgraded archives use schema v2.',
	linksMenu: 'Linked compositions…', linksTitle: 'Linked Motionscaper compositions', openProject: 'Open in successor editor',
	linksDescription: 'Connect a saved composition using a pairing URL. Saved revisions update automatically while connected; accepted revisions and their media remain available offline.',
	connect: 'Create pairing URL', disconnect: 'Disconnect', pairingUrl: 'Pairing URL', pairingHelp: 'Paste this URL in Motionscaper’s Send Composition dialog. Keep both editors and bridge windows open. Closing this dialog keeps the connection active.',
	connectionIdle: 'Disconnected', connectionPending: 'Waiting for Motionscaper…', connectionReady: 'Connected — accepting saved revisions', connectionReceived: 'Saved revision received',
	accepted: 'Accepted revision', pending: 'Pending output change', paused: 'Updates pinned by history', conform: 'Conform pending revision', resume: 'Resume automatic updates', emptyLinks: 'No compositions are linked to this project.',
	choose: 'Choose archive to upgrade', close: 'Close', opening: 'Opening successor library…',
	retained: '{count} upgraded projects retained in the successor library.',
	verifying: 'Verifying complete archive and retaining original bytes…', schema: 'schema v2',
	original: 'Download original v1 archive', upgraded: 'Download upgraded v2 archive',
});
const EN = FRAMESCAPER_SUCCESSOR_ENGLISH_COPY;
const DE: Readonly<Record<keyof typeof EN, string>> = Object.freeze({
	menu: 'Archiv für Framescaper 1.1 Entwicklung aktualisieren…',
	title: 'Framescaper 1.1 Entwicklung — Archiv aktualisieren',
	description: 'Ein vollständiges Framescaper-1.0-Archiv wird in eine separate Bibliothek übernommen. Projektidentität und Originalarchiv bleiben erhalten. Das aktualisierte Projekt kann in diesem Nachfolgeeditor geöffnet werden. Aktualisierte Archive verwenden Schema v2.',
	linksMenu: 'Verknüpfte Kompositionen…', linksTitle: 'Verknüpfte Motionscaper-Kompositionen', openProject: 'Im Nachfolgeeditor öffnen',
	linksDescription: 'Eine gespeicherte Komposition wird über eine Verbindungs-URL verbunden. Gespeicherte Revisionen werden während der Verbindung automatisch übernommen; akzeptierte Revisionen und Medien bleiben offline verfügbar.',
	connect: 'Verbindungs-URL erstellen', disconnect: 'Verbindung trennen', pairingUrl: 'Verbindungs-URL', pairingHelp: 'Diese URL im Motionscaper-Dialog „Komposition senden“ einfügen. Beide Editoren und Brückenfenster geöffnet lassen. Das Schließen dieses Dialogs beendet die Verbindung nicht.',
	connectionIdle: 'Nicht verbunden', connectionPending: 'Warten auf Motionscaper…', connectionReady: 'Verbunden — gespeicherte Revisionen werden übernommen', connectionReceived: 'Gespeicherte Revision empfangen',
	accepted: 'Akzeptierte Revision', pending: 'Ausstehende Ausgabeänderung', paused: 'Aktualisierungen durch Verlauf angehalten', conform: 'Ausstehende Revision anpassen', resume: 'Automatische Aktualisierung fortsetzen', emptyLinks: 'Mit diesem Projekt sind keine Kompositionen verknüpft.',
	choose: 'Archiv zum Aktualisieren auswählen', close: 'Schließen', opening: 'Nachfolgebibliothek wird geöffnet…',
	retained: '{count} aktualisierte Projekte in der Nachfolgebibliothek gespeichert.',
	verifying: 'Vollständiges Archiv wird geprüft und das Original aufbewahrt…', schema: 'Schema v2',
	original: 'Originalarchiv v1 herunterladen', upgraded: 'Aktualisiertes Archiv v2 herunterladen',
});
export function framescaperSuccessorCopy(locale: string): Readonly<Record<keyof typeof EN, string>> {
	return locale.toLowerCase().startsWith('de') ? DE : EN;
}
