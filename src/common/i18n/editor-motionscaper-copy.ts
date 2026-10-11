/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveEditorCopyScope } from './editor-copy-scope.ts';
import { localeLanguage } from './locale.js';

const ENTRIES = [
	['motionscaperNewComposition', 'New Composition', 'Neue Komposition'],
	['motionscaperUnavailable', 'Composition creation is not available in this build.', 'Das Erstellen von Kompositionen ist in dieser Version noch nicht verfügbar.'],
	['motionscaperWorkspaceEmpty', 'Create a composition from the File menu to begin.', 'Erstelle zum Beginnen eine Komposition über das Menü Datei.'],
	['motionscaperFileMenu', 'File', 'Datei'],
	['motionscaperViewMenu', 'View', 'Ansicht'],
	['motionscaperApplicationMenu', 'Application menu', 'Anwendungsmenü'],
	['motionscaperFullscreen', 'Toggle fullscreen', 'Vollbild umschalten'],
	['motionscaperEditMenu', 'Edit', 'Bearbeiten'],
	['motionscaperOpen', 'Open', 'Öffnen'],
	['motionscaperSave', 'Save', 'Speichern'],
	['motionscaperSaveCopy', 'Save Copy', 'Kopie speichern'],
	['motionscaperLibrary', 'Project Library', 'Projektbibliothek'],
	['motionscaperSettings', 'Composition Settings', 'Kompositionseinstellungen'],
	['motionscaperUndo', 'Undo', 'Rückgängig'],
	['motionscaperRedo', 'Redo', 'Wiederholen'],
	['motionscaperTitleLabel', 'Project title', 'Projekttitel'],
	['motionscaperUntitled', 'Untitled Composition', 'Unbenannte Komposition'],
	['motionscaperWidth', 'Width', 'Breite'],
	['motionscaperHeight', 'Height', 'Höhe'],
	['motionscaperFrameRate', 'Frame rate', 'Bildrate'],
	['motionscaperFrameNumerator', 'Frame rate numerator', 'Zähler der Bildrate'],
	['motionscaperFrameDenominator', 'Frame rate denominator', 'Nenner der Bildrate'],
	['motionscaperDuration', 'Duration in frames', 'Dauer in Bildern'],
	['motionscaperCreate', 'Create', 'Erstellen'],
	['motionscaperApply', 'Apply', 'Anwenden'],
	['motionscaperCancel', 'Cancel', 'Abbrechen'],
	['motionscaperClose', 'Close', 'Schließen'],
	['motionscaperSaved', 'Saved on this device', 'Auf diesem Gerät gespeichert'],
	['motionscaperUnsaved', 'Unsaved changes', 'Ungespeicherte Änderungen'],
	['motionscaperWorking', 'Working', 'Wird bearbeitet'],
	['motionscaperOpenFile', 'Motionscaper project (.mscape)', 'Motionscaper-Projekt (.mscape)'],
	['motionscaperLibraryEmpty', 'No saved compositions on this device.', 'Auf diesem Gerät sind keine Kompositionen gespeichert.'],
	['motionscaperRecover', 'Recover unsaved changes', 'Ungespeicherte Änderungen wiederherstellen'],
	['motionscaperRecoveryAvailable', 'Unsaved changes are available for recovery.', 'Ungespeicherte Änderungen können wiederhergestellt werden.'],
	['motionscaperConflict', 'This project already exists or changed in another window. Open its saved version from Project Library; your current composition is unchanged.', 'Dieses Projekt existiert bereits oder wurde in einem anderen Fenster geändert. Öffne die gespeicherte Version über die Projektbibliothek; deine aktuelle Komposition bleibt unverändert.'],
	['motionscaperUnsupported', 'This file needs a different editor or a newer version of Motionscaper.', 'Diese Datei benötigt einen anderen Editor oder eine neuere Version von Motionscaper.'],
	['motionscaperFailed', 'The operation could not be completed. Your work remains open; try again.', 'Die Aktion konnte nicht abgeschlossen werden. Deine Arbeit bleibt geöffnet; versuche es erneut.'],
	['motionscaperSettingsInvalid', 'Enter a title and positive whole numbers for the composition settings.', 'Gib einen Titel und positive ganze Zahlen für die Kompositionseinstellungen ein.'],
	['motionscaperProjectDimensions', 'Dimensions', 'Abmessungen'],
	['motionscaperLayerMenu', 'Layer', 'Ebene'],
	['motionscaperSolid', 'New Solid', 'Neue Farbfläche'],
	['motionscaperText', 'New Text', 'Neuer Text'],
	['motionscaperRectangle', 'New Rectangle', 'Neues Rechteck'],
	['motionscaperEllipse', 'New Ellipse', 'Neue Ellipse'],
	['motionscaperStar', 'New Star', 'Neuer Stern'],
	['motionscaperLayerName', 'Layer name', 'Ebenenname'],
	['motionscaperPositionX', 'Position X', 'Position X'],
	['motionscaperPositionY', 'Position Y', 'Position Y'],
	['motionscaperColor', 'Fill color', 'Füllfarbe'],
	['motionscaperOpacity', 'Opacity (%)', 'Deckkraft (%)'],
	['motionscaperTextContent', 'Text', 'Text'],
	['motionscaperFontSize', 'Font size', 'Schriftgröße'],
	['motionscaperLayerInvalid', 'Enter a name, valid dimensions and a color for the layer.', 'Gib einen Namen, gültige Abmessungen und eine Farbe für die Ebene ein.'],
	['motionscaperPreview', 'Composition Preview', 'Kompositionsvorschau'],
	['motionscaperFrame', 'Frame', 'Bild'],
	['motionscaperPlay', 'Play', 'Wiedergabe'],
	['motionscaperPause', 'Pause', 'Pause'],
	['motionscaperPreviewReady', 'Preview ready', 'Vorschau bereit'],
	['motionscaperPreviewFailed', 'The composition could not be rendered.', 'Die Komposition konnte nicht gerendert werden.'],
	['motionscaperRetry', 'Retry', 'Erneut versuchen'],
	['motionscaperLayers', 'Layers', 'Ebenen'],
] as const;

export const MOTIONSCAPER_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(ENTRIES.map(([key, , de]) => [key, de]))),
});
export const MOTIONSCAPER_CANONICAL_ENGLISH_COPY = Object.freeze(Object.fromEntries(
	Object.entries(MOTIONSCAPER_COPY_BY_LOCALE.en).map(([key, source]) => [`ui.motionscaper.${key}`, source]),
));

export function resolveMotionscaperCopy(locale: string, overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, string>> {
	return resolveEditorCopyScope('motionscaper', localeLanguage(locale) === 'de'
		? MOTIONSCAPER_COPY_BY_LOCALE.de : MOTIONSCAPER_COPY_BY_LOCALE.en, overrides);
}
