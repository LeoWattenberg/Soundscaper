/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveEditorCopyScope } from './editor-copy-scope.ts';
import { localeLanguage } from './locale.js';
const ENTRIES = [
	['motionscaperAfterEffectsBridge', 'After Effects Bridge', 'After-Effects-Austausch'],
	['motionscaperAeQualification', 'Development bridge. No installed After Effects version is qualified yet. Preserve your original project and compare the result with After Effects.', 'Austausch in Entwicklung. Bisher ist keine installierte After-Effects-Version qualifiziert. Bewahre dein Originalprojekt auf und vergleiche das Ergebnis mit After Effects.'],
	['motionscaperAeInstructions', 'Extract the downloaded scripts into one folder. In installed After Effects, open your source project, then choose File > Scripts > Run Script File and run Motionscaper-Export.jsx. Select motionae.json and every file in its media folder here.', 'Entpacke die heruntergeladenen Skripte in einen Ordner. Öffne dein Quellprojekt im installierten After Effects und führe über Datei > Skripten > Skriptdatei ausführen Motionscaper-Export.jsx aus. Wähle hier motionae.json und alle Dateien aus dessen Medienordner.'],
	['motionscaperAeSampling', 'The separate Motionscaper-Export-Sampled.jsx script asks before evaluating numeric animation and expressions at composition frames. Subframe motion and motion blur require further qualification.', 'Das separate Skript Motionscaper-Export-Sampled.jsx fragt vor dem Auswerten numerischer Animation und Expressions an Kompositionsbildern. Bewegung zwischen Bildern und Bewegungsunschärfe müssen weiter qualifiziert werden.'],
	['motionscaperAeRendered', 'For a whole-composition PNG sequence, select the composition in AE and run Motionscaper-Export-Rendered.jsx. It requires an empty render queue and your own full-size 8-bit RGB+Alpha PNG template. The current carrier accepts at most 256 frames and no audio. Installed-AE cancellation, settings, color and alpha fidelity remain unqualified.', 'Für eine PNG-Sequenz der gesamten Komposition wähle diese in AE aus und führe Motionscaper-Export-Rendered.jsx aus. Erforderlich sind eine leere Renderliste und deine eigene PNG-Vorlage mit voller Größe, 8 Bit und RGB+Alpha. Der aktuelle Träger akzeptiert höchstens 256 Bilder und kein Audio. Abbruch, Einstellungen, Farb- und Alphatreue im installierten AE sind noch nicht qualifiziert.'],
	['motionscaperAeOriginalProject', 'Open this project in installed After Effects and run the bridge exporter. Motionscaper does not read AEP or AEPX directly.', 'Öffne dieses Projekt im installierten After Effects und führe den Austausch-Exporter aus. Motionscaper liest AEP oder AEPX nicht direkt.'],
	['motionscaperAeDownload', 'Download Bridge Scripts', 'Austausch-Skripte herunterladen'],
	['motionscaperAeManifest', 'AE exchange manifest', 'AE-Austauschmanifest'],
	['motionscaperAeMedia', 'Package media files', 'Mediendateien des Pakets'],
	['motionscaperAeLimits', 'Select every original media file, including unused sources. Import accepts supported images, audio and video up to 64 MiB per file and 256 MiB total. Missing or unsupported original media prevents import.', 'Wähle jede Originalmediendatei, einschließlich ungenutzter Quellen. Unterstützte Bilder, Audio und Videos sind bis 64 MiB pro Datei und insgesamt 256 MiB importierbar. Fehlende oder nicht unterstützte Originalmedien verhindern den Import.'],
	['motionscaperAeReview', 'Review Import', 'Import prüfen'],
	['motionscaperAeReport', 'Conversion report', 'Konvertierungsbericht'],
	['motionscaperAeReportScope', 'Source', 'Quelle'],
	['motionscaperAeReportMapping', 'Mapping', 'Zuordnung'],
	['motionscaperAeReportDetail', 'Detail', 'Details'],
	['motionscaperAeStatus_editable', 'Editable', 'Bearbeitbar'],
	['motionscaperAeStatus_sampled', 'Sampled', 'Abgetastet'],
	['motionscaperAeStatus_rendered', 'Rendered', 'Gerendert'],
	['motionscaperAeStatus_unsupported', 'Unsupported', 'Nicht unterstützt'],
	['motionscaperAeAcknowledge', 'I have reviewed the report and accept this partial conversion. Unsupported layer content may appear as named null layers.', 'Ich habe den Bericht geprüft und akzeptiere diese teilweise Konvertierung. Nicht unterstützte Ebeneninhalte können als benannte Nullebenen erscheinen.'],
	['motionscaperAeCustody', 'The original exchange, this report and every retained media file will remain in the new project through Save and .mscape export. Original files remain untouched.', 'Der ursprüngliche Austausch, dieser Bericht und jede übernommene Mediendatei bleiben beim Speichern und beim .mscape-Export im neuen Projekt erhalten. Originaldateien bleiben unverändert.'],
	['motionscaperAeDownloadReport', 'Download Report and Original Exchange', 'Bericht und ursprünglichen Austausch herunterladen'],
	['motionscaperAeImport', 'Import New Project', 'Neues Projekt importieren'],
	['motionscaperAeOpenImported', 'Open Imported Project', 'Importiertes Projekt öffnen'],
	['motionscaperAePrevious', 'Previous Report Page', 'Vorherige Berichtsseite'],
	['motionscaperAeNext', 'Next Report Page', 'Nächste Berichtsseite'],
	['motionscaperAeWorking', 'Preparing or publishing the selected transfer.', 'Der ausgewählte Austausch wird vorbereitet oder gespeichert.'],
	['motionscaperAeCancelled', 'Transfer cancelled. No new project was published.', 'Austausch abgebrochen. Kein neues Projekt wurde gespeichert.'],
	['motionscaperAeFailed', 'The bridge operation could not be completed.', 'Der Austauschvorgang konnte nicht abgeschlossen werden.'],
] as const;
export const MOTIONSCAPER_AE_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(ENTRIES.map(([key, , de]) => [key, de]))),
});
export function resolveMotionscaperAeCopy(locale: string, overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, string>> {
	return resolveEditorCopyScope('motionscaper-ae', localeLanguage(locale) === 'de' ? MOTIONSCAPER_AE_COPY_BY_LOCALE.de : MOTIONSCAPER_AE_COPY_BY_LOCALE.en, overrides);
}
