/* SPDX-License-Identifier: AGPL-3.0-only */

const ENTRIES = Object.freeze([
	['localDiagnosticsTitle', 'Local Diagnostics', 'Lokale Diagnose'],
	['localDiagnosticsDescription', 'Create a bounded report of versions, capabilities, typed errors, storage, library, and recovery state.', 'Erstellt einen begrenzten Bericht zu Versionen, Funktionen, typisierten Fehlern, Speicher, Bibliothek und Wiederherstellung.'],
	['localDiagnosticsPrivacy', 'The report stays on this device unless you explicitly export it. It contains no project names, identifiers, file paths, media, transcripts, error messages, or stacks.', 'Der Bericht bleibt auf diesem Gerät, solange du ihn nicht ausdrücklich exportierst. Er enthält keine Projektnamen, Kennungen, Dateipfade, Medien, Transkripte, Fehlermeldungen oder Stapelverläufe.'],
	['localDiagnosticsGenerate', 'Generate local diagnostic report', 'Lokalen Diagnosebericht erstellen'],
	['localDiagnosticsGenerating', 'Generating report', 'Bericht wird erstellt'],
	['localDiagnosticsExport', 'Export local diagnostic report', 'Lokalen Diagnosebericht exportieren'],
	['localDiagnosticsExporting', 'Exporting report', 'Bericht wird exportiert'],
	['localDiagnosticsSaved', 'The local diagnostic report was exported.', 'Der lokale Diagnosebericht wurde exportiert.'],
	['localDiagnosticsError', 'The local diagnostic report could not be created or exported.', 'Der lokale Diagnosebericht konnte nicht erstellt oder exportiert werden.'],
	['localDiagnosticsVersions', 'Versions', 'Versionen'],
	['localDiagnosticsEnvironment', 'Environment', 'Umgebung'],
	['localDiagnosticsCapabilities', 'Capabilities', 'Funktionen'],
	['localDiagnosticsErrors', 'Recent typed errors', 'Letzte typisierte Fehler'],
	['localDiagnosticsStorage', 'Storage and library', 'Speicher und Bibliothek'],
	['localDiagnosticsRecovery', 'Recovery journals', 'Wiederherstellungsjournale'],
	['localDiagnosticsStreaming', 'Streamed playback', 'Gestreamte Wiedergabe'],
	['localDiagnosticsStreamingSummary', '{observation}; {frames} underrun frames.', '{observation}; {frames} Frames mit Unterlauf.'],
	['localDiagnosticsStreamingObserved', 'observed', 'beobachtet'],
	['localDiagnosticsStreamingNotObserved', 'not observed', 'nicht beobachtet'],
	['localDiagnosticsVersionSummary', '{application}; diagnostics schema {diagnostics}; Scape {scape}.', '{application}; Diagnoseschema {diagnostics}; Scape {scape}.'],
	['localDiagnosticsCapabilitySummary', '{available} of {total} capabilities available.', '{available} von {total} Funktionen verfügbar.'],
	['localDiagnosticsErrorSummary', '{count} recent typed errors retained.', '{count} letzte typisierte Fehler gespeichert.'],
	['localDiagnosticsLibrarySummary', '{projects} projects in the library; {open} open.', '{projects} Projekte in der Bibliothek; {open} geöffnet.'],
]);

export const LOCAL_DIAGNOSTICS_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(ENTRIES.map(([key, , de]) => [key, de]))),
});
