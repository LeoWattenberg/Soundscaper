/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveEditorCopyScope } from './editor-copy-scope.ts';
import { localeLanguage } from './locale.js';
const ENTRIES = [
	['motionscaperTracking', 'Tracking and Stabilization', 'Tracking und Stabilisierung'],
	['motionscaperTrackingHint', 'Track the original video pixels. Choose a point or four corners, analyze a frame range, then review and apply the result. Import smaller footage if the source exceeds 4 million pixels.', 'Verfolge die ursprünglichen Videopixel. Wähle einen Punkt oder vier Ecken, analysiere einen Bildbereich und prüfe und übernimm das Ergebnis. Importiere kleineres Material, wenn die Quelle mehr als 4 Millionen Pixel hat.'],
	['motionscaperTrackingNoSource', 'Import a video from File to analyze its motion. Images and generated layers can receive a track from a video.', 'Importiere ein Video über Datei, um seine Bewegung zu analysieren. Bilder und erzeugte Ebenen können das Tracking eines Videos übernehmen.'],
	['motionscaperTrackingSource', 'Source video layer', 'Quellvideoebene'],
	['motionscaperTrackingMode', 'Tracking mode', 'Tracking-Modus'],
	['motionscaperTrackingMode_point', 'Point', 'Punkt'],
	['motionscaperTrackingMode_planar', 'Plane and corner pin', 'Fläche und Eckpunkte'],
	['motionscaperTrackingMode_stabilize', 'Stabilization', 'Stabilisierung'],
	['motionscaperTrackingAnalysis', 'Stored analysis', 'Gespeicherte Analyse'],
	['motionscaperTrackingNew', 'New analysis', 'Neue Analyse'],
	['motionscaperTrackingAnalyze', 'Analyze', 'Analysieren'],
	['motionscaperTrackingProgress', 'Analyzed frames', 'Analysierte Bilder'],
	['motionscaperTrackingCancelled', 'Analysis cancelled. No result was added.', 'Analyse abgebrochen. Kein Ergebnis wurde hinzugefügt.'],
	['motionscaperTrackingCount', 'Frames to analyze', 'Zu analysierende Bilder'],
	['motionscaperTrackingPyramid', 'Tracking pyramid levels', 'Tracking-Pyramidenstufen'],
	['motionscaperTrackingPoint', 'Tracking point', 'Tracking-Punkt'],
	['motionscaperTrackingPointHint', 'Drag a point or use arrow keys to move it. Shift moves ten pixels. Corner order is top left, top right, bottom right, bottom left.', 'Ziehe einen Punkt oder bewege ihn mit den Pfeiltasten. Umschalt bewegt zehn Pixel. Die Ecken folgen der Reihenfolge oben links, oben rechts, unten rechts, unten links.'],
	['motionscaperTrackingRawFrame', 'Original video frame', 'Ursprüngliches Videobild'],
	['motionscaperTrackingTarget', 'Apply to layer', 'Auf Ebene anwenden'],
	['motionscaperTrackingStrength', 'Stabilization strength', 'Stabilisierungsstärke'],
	['motionscaperTrackingReplace', 'Replace existing animation', 'Vorhandene Animation ersetzen'],
	['motionscaperTrackingApply', 'Apply Tracking', 'Tracking anwenden'],
	['motionscaperTrackingCorrect', 'Correct Frame', 'Bild korrigieren'],
	['motionscaperTrackingRemove', 'Remove Analysis', 'Analyse entfernen'],
	['motionscaperTrackingDetach', 'Detach Application', 'Anwendung lösen'],
	['motionscaperTrackingSamples', 'Review samples', 'Ergebnisse prüfen'],
	['motionscaperTrackingStatus_tracked', 'Tracked', 'Verfolgt'],
	['motionscaperTrackingStatus_manual', 'Manually placed', 'Manuell gesetzt'],
	['motionscaperTrackingStatus_lost', 'Lost: correct this frame before applying.', 'Verloren: Korrigiere dieses Bild vor dem Anwenden.'],
	['motionscaperTrackingUnresolved', 'Unresolved frames', 'Ungeklärte Bilder'],
	['motionscaperTrackingReady', 'The stored result matches its source.', 'Das gespeicherte Ergebnis passt zu seiner Quelle.'],
	['motionscaperTrackingFailed', 'Tracking could not be completed.', 'Tracking konnte nicht abgeschlossen werden.'],
	['motionscaperTrackingApplied', 'Tracking applied. Undo is available.', 'Tracking angewendet. Rückgängig ist verfügbar.'],
] as const;
export const MOTIONSCAPER_TRACKING_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(ENTRIES.map(([key, , de]) => [key, de]))),
});
export function resolveMotionscaperTrackingCopy(locale: string, overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, string>> {
	return resolveEditorCopyScope('motionscaper-tracking', localeLanguage(locale) === 'de' ? MOTIONSCAPER_TRACKING_COPY_BY_LOCALE.de : MOTIONSCAPER_TRACKING_COPY_BY_LOCALE.en, overrides);
}
