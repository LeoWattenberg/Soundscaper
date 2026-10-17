/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveEditorCopyScope } from './editor-copy-scope.ts';
import { localeLanguage } from './locale.js';
const ENTRIES = [
	['motionscaperRenderQueue', 'Render Queue', 'Render-Warteschlange'],
	['motionscaperQueueDescription', 'Jobs keep their submitted revision when you edit or switch projects. Closing this dialog keeps rendering; closing this editor cancels unfinished jobs.', 'Aufträge behalten ihre eingereichte Revision bei Änderungen oder Projektwechseln. Das Schließen dieses Dialogs rendert weiter; das Schließen des Editors bricht unfertige Aufträge ab.'],
	['motionscaperQueueLimits', 'Up to 8 jobs, 64 MiB per browser download and 128 MiB retained downloads. Remove finished jobs to free space, or choose a streaming file destination for larger outputs.', 'Bis zu 8 Aufträge, 64 MiB je Browser-Download und 128 MiB gespeicherte Downloads. Fertige Aufträge entfernen oder für größere Ausgaben direkt in eine Datei schreiben.'],
	['motionscaperQueueEmpty', 'No render jobs. Use File → Render to add one.', 'Keine Render-Aufträge. Unter Datei → Rendern einen hinzufügen.'],
	['motionscaperQueueQueued', 'Queued', 'In Warteschlange'],
	['motionscaperQueueRendering', 'Rendering', 'Wird gerendert'],
	['motionscaperQueueCompleted', 'Completed', 'Abgeschlossen'],
	['motionscaperQueueCancelled', 'Cancelled', 'Abgebrochen'],
	['motionscaperQueueFailed', 'Failed', 'Fehlgeschlagen'],
	['motionscaperQueueCleanup', 'Retry Output Cleanup', 'Ausgabe-Bereinigung erneut versuchen'],
	['motionscaperQueueRetry', 'Retry Original Revision', 'Ursprüngliche Revision erneut rendern'],
	['motionscaperQueueDownload', 'Download Again', 'Erneut herunterladen'],
	['motionscaperQueueRemove', 'Remove Job', 'Auftrag entfernen'],
	['motionscaperQueueAttempt', 'Attempt', 'Versuch'],
	['motionscaperQueueRevision', 'Submitted revision', 'Eingereichte Revision'],
	['motionscaperQueueContinues', 'This job continues when you close the dialog. File → Render Queue shows all jobs.', 'Dieser Auftrag läuft nach dem Schließen weiter. Datei → Render-Warteschlange zeigt alle Aufträge.'],
] as const;
export const MOTIONSCAPER_QUEUE_COPY_BY_LOCALE = Object.freeze({ en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))), de: Object.freeze(Object.fromEntries(ENTRIES.map(([key, , de]) => [key, de]))) });
export function resolveMotionscaperQueueCopy(locale: string, overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, string>> {
	return resolveEditorCopyScope('motionscaper-queue', localeLanguage(locale) === 'de' ? MOTIONSCAPER_QUEUE_COPY_BY_LOCALE.de : MOTIONSCAPER_QUEUE_COPY_BY_LOCALE.en, overrides);
}
