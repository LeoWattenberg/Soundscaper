/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveEditorCopyScope } from './editor-copy-scope.ts';
import { localeLanguage } from './locale.js';
const ENTRIES = [
	['motionscaperArchiveReview', 'Open Project Conflict', 'Projektkonflikt beim Öffnen'],
	['motionscaperArchiveReviewHint', 'This project identity already exists on this device. Choose which document to open. Cancel leaves the current document and its history unchanged.', 'Diese Projektidentität ist auf diesem Gerät bereits vorhanden. Wähle das zu öffnende Dokument. Abbrechen lässt das aktuelle Dokument und seinen Verlauf unverändert.'],
	['motionscaperArchiveIncoming', 'Selected archive', 'Ausgewähltes Archiv'],
	['motionscaperArchiveSaved', 'Local saved revision', 'Lokal gespeicherte Revision'],
	['motionscaperArchiveRecovery', 'Local unsaved draft', 'Lokaler ungespeicherter Entwurf'],
	['motionscaperArchiveKeep', 'Keep Current Document', 'Aktuelles Dokument behalten'],
	['motionscaperArchiveOpenSaved', 'Open Local Saved Revision', 'Lokal gespeicherte Revision öffnen'],
	['motionscaperArchiveRecover', 'Recover Local Draft', 'Lokalen Entwurf wiederherstellen'],
	['motionscaperArchiveCopy', 'Import Independent Copy', 'Unabhängige Kopie importieren'],
	['motionscaperArchiveCopyHint', 'The copy gets its own project identity and retains every original asset. Native Save will ask for its own destination.', 'Die Kopie erhält eine eigene Projektidentität und behält alle ursprünglichen Medien. Speichern in der Desktop-App fragt nach einem eigenen Ziel.'],
	['motionscaperArchiveReplace', 'Replace Local Draft', 'Lokalen Entwurf ersetzen'],
	['motionscaperArchiveReplaceHint', 'Replacement is one undoable draft edit. The saved revision stays unchanged until Save. The selected file is not overwritten or rebound.', 'Ersetzen ist eine rückgängig machbare Entwurfsänderung. Die gespeicherte Revision bleibt bis zum Speichern unverändert. Die ausgewählte Datei wird weder überschrieben noch neu gebunden.'],
	['motionscaperArchiveAccepted', 'The document is already open. Native binding or cleanup still needs completion; retrying will not import another copy.', 'Das Dokument ist bereits geöffnet. Die native Dateibindung oder Bereinigung muss noch abgeschlossen werden. Ein erneuter Versuch importiert keine weitere Kopie.'],
	['motionscaperArchiveRetry', 'Retry Completion', 'Abschluss erneut versuchen'],
] as const;
export const MOTIONSCAPER_IMPORT_COPY_BY_LOCALE = Object.freeze({ en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))), de: Object.freeze(Object.fromEntries(ENTRIES.map(([key, , de]) => [key, de]))) });
export function resolveMotionscaperImportCopy(locale: string, overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, string>> {
	return resolveEditorCopyScope('motionscaper-import', localeLanguage(locale) === 'de' ? MOTIONSCAPER_IMPORT_COPY_BY_LOCALE.de : MOTIONSCAPER_IMPORT_COPY_BY_LOCALE.en, overrides);
}
