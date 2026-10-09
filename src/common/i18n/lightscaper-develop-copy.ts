/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_EFFECT_COPY_BY_LOCALE } from './video-effect-copy.js';

const EN = Object.freeze({ title: 'Develop', version: 'Version', useVersion: 'Use version', history: 'History', snapshots: 'Snapshots',
	snapshotName: 'Snapshot name', saveSnapshot: 'Save snapshot', restoreSnapshot: 'Restore snapshot', deleteSnapshot: 'Delete snapshot',
	copyName: 'Virtual copy name', createCopy: 'Create virtual copy', renameCopy: 'Rename virtual copy', deleteCopy: 'Delete virtual copy',
	save: 'Save settings', discard: 'Discard draft', reload: 'Reload settings', cancel: 'Cancel', close: 'Close', working: 'Working…',
	dirty: 'Unsaved draft', acknowledged: 'Settings saved.', cleanupFailed: 'Settings were saved, but cleanup failed.',
	refreshFailed: 'Settings were saved. The library could not refresh.', editLabel: 'Develop settings', restoreLabel: 'Restore snapshot',
	adjustments: 'Adjustments', choose: 'Choose an adjustment', add: 'Add adjustment', remove: 'Remove adjustment', up: 'Move adjustment up', down: 'Move adjustment down',
	empty: 'No adjustments.', before: 'Before', after: 'After', compare: 'Before / after', split: 'Split view', divider: 'Divider position (%)', previewMode: 'Preview view',
	preview: 'Rendered sRGB proxy', histogram: 'RGB histogram', samples: 'Visible pixels', low: 'Low clipped pixels', high: 'High clipped pixels',
	fullPreview: 'Rendered sRGB original', fitResolution: 'Fit-screen proxy', fullResolution: 'Full resolution (100%)',
	imageViewport: 'Image viewport',
	fullResolutionFailed: 'The full-resolution image could not be rendered.',
	missing: 'The original preview is unavailable.', previewFailed: 'The develop proxy could not be rendered.',
	geometry: 'Crop and perspective (natural output)', description: 'Changes create develop settings; the original stays unchanged. Previews use bounded derivatives. Choose full resolution from Settings to inspect pixels at 100%.',
	unsupported: 'This adjustment is preserved. Its enabled processing is unavailable in this proxy.',
});
const DE: Record<keyof typeof EN, string> = Object.freeze({ title: 'Entwickeln', version: 'Version', useVersion: 'Version verwenden', history: 'Verlauf', snapshots: 'Momentaufnahmen',
	snapshotName: 'Name der Momentaufnahme', saveSnapshot: 'Momentaufnahme speichern', restoreSnapshot: 'Momentaufnahme wiederherstellen', deleteSnapshot: 'Momentaufnahme löschen',
	copyName: 'Name der virtuellen Kopie', createCopy: 'Virtuelle Kopie erstellen', renameCopy: 'Virtuelle Kopie umbenennen', deleteCopy: 'Virtuelle Kopie löschen',
	save: 'Einstellungen speichern', discard: 'Entwurf verwerfen', reload: 'Einstellungen neu laden', cancel: 'Abbrechen', close: 'Schließen', working: 'In Arbeit…',
	dirty: 'Ungespeicherter Entwurf', acknowledged: 'Einstellungen gespeichert.', cleanupFailed: 'Die Einstellungen wurden gespeichert, aber die Bereinigung ist fehlgeschlagen.',
	refreshFailed: 'Die Einstellungen wurden gespeichert. Die Bibliothek konnte nicht aktualisiert werden.', editLabel: 'Entwicklungseinstellungen', restoreLabel: 'Momentaufnahme wiederherstellen',
	adjustments: 'Anpassungen', choose: 'Anpassung auswählen', add: 'Anpassung hinzufügen', remove: 'Anpassung entfernen', up: 'Anpassung nach oben verschieben', down: 'Anpassung nach unten verschieben',
	empty: 'Keine Anpassungen.', before: 'Vorher', after: 'Nachher', compare: 'Vorher / nachher', split: 'Geteilte Ansicht', divider: 'Trennlinie (%)', previewMode: 'Vorschauansicht',
	preview: 'Gerenderte sRGB-Vorschau', histogram: 'RGB-Histogramm', samples: 'Sichtbare Pixel', low: 'Pixel am unteren Grenzwert', high: 'Pixel am oberen Grenzwert',
	fullPreview: 'Gerendertes sRGB-Original', fitResolution: 'Vorschaubild einpassen', fullResolution: 'Volle Auflösung (100 %)',
	imageViewport: 'Bildansicht',
	fullResolutionFailed: 'Das Bild in voller Auflösung konnte nicht gerendert werden.',
	missing: 'Die Originalvorschau ist nicht verfügbar.', previewFailed: 'Die Entwicklungsvorschau konnte nicht gerendert werden.',
	geometry: 'Zuschnitt und Perspektive (natürliche Ausgabegröße)', description: 'Änderungen erzeugen Entwicklungseinstellungen; das Original bleibt unverändert. Die Vorschau nutzt begrenzte Vorschaubilder. Wählen Sie in den Einstellungen die volle Auflösung, um Pixel bei 100 % zu prüfen.',
	unsupported: 'Diese Anpassung bleibt erhalten. Ihre aktivierte Verarbeitung ist in dieser Vorschau nicht verfügbar.',
});
export interface PhotoDevelopCopyV1 extends Record<keyof typeof EN, string> { readonly shared: Readonly<Record<string, string>> }
export function photoDevelopCopy(locale: string): Readonly<PhotoDevelopCopyV1> {
	const language = locale.toLowerCase().split('-')[0] === 'de' ? 'de' : 'en';
	return Object.freeze({ ...(language === 'de' ? DE : EN), shared: VIDEO_EFFECT_COPY_BY_LOCALE[language] });
}
