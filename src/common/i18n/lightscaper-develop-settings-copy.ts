/* SPDX-License-Identifier: AGPL-3.0-only */

import { photoDevelopCopy } from './lightscaper-develop-copy.ts';

const EN = Object.freeze({ menu: 'Settings and presets', copy: 'Copy settings…', paste: 'Paste settings', sync: 'Sync selected photos…',
	auto: 'Auto-sync selected photos…', stopAuto: 'Stop Auto-sync', quick: 'Quick develop selected photos…', presets: 'Develop presets…',
	confirmCopy: 'Copy selected settings', confirmSync: 'Sync selected settings', confirmAuto: 'Enable Auto-sync',
	picker: 'Settings picker', all: 'All adjustment types', geometry: 'Crop, rotation and flips', local: 'Local adjustments and masks', repairs: 'Repair spots', rawDevelopment: 'RAW development',
	selected: 'Selected photo count', targetPolicy: 'Batch changes use the active version of each selected photo. Sync excludes the source photo.',
	autoPolicy: 'Each acknowledged Save synchronizes these selected target versions. Conflicts stop Auto-sync; the source Save stays acknowledged.',
	autoActive: 'Auto-sync is enabled.', copied: 'Settings copied.', batch: 'Batch results', finished: 'Finished', cancelled: 'Cancelled', interrupted: 'Interrupted',
	applied: 'Applied', unchanged: 'Unchanged', conflict: 'Revision conflict', failed: 'Failed', notAttempted: 'Not attempted',
	cleanup: 'An acknowledged write completed, but cleanup failed.', refresh: 'Acknowledged settings were saved. The library could not refresh.',
	presetName: 'Preset name', choosePreset: 'Choose a preset', noPreset: 'No preset selected', full: 'Full settings', partial: 'Partial settings',
	actionFailed: 'The settings action failed. Reload before retrying.',
	savePreset: 'Save current settings as preset', applyPreset: 'Apply selected preset', renamePreset: 'Rename selected preset', deletePreset: 'Delete selected preset',
	reloadPresets: 'Reload presets', presetSaved: 'Preset changes saved.', adjustment: 'Relative adjustment', parameter: 'Parameter', delta: 'Relative change', applyQuick: 'Apply relative change',
	close: 'Close', cancel: 'Cancel', working: 'Working…', pasteLabel: 'Paste settings', syncLabel: 'Sync settings', autoLabel: 'Auto-sync settings', quickLabel: 'Quick develop', presetLabel: 'Apply preset',
});
const DE: Record<keyof typeof EN, string> = Object.freeze({ menu: 'Einstellungen und Vorgaben', copy: 'Einstellungen kopieren…', paste: 'Einstellungen einfügen', sync: 'Ausgewählte Fotos synchronisieren…',
	auto: 'Ausgewählte Fotos automatisch synchronisieren…', stopAuto: 'Automatische Synchronisierung beenden', quick: 'Ausgewählte Fotos schnell entwickeln…', presets: 'Entwicklungsvorgaben…',
	confirmCopy: 'Ausgewählte Einstellungen kopieren', confirmSync: 'Ausgewählte Einstellungen synchronisieren', confirmAuto: 'Automatische Synchronisierung aktivieren',
	picker: 'Einstellungen auswählen', all: 'Alle Anpassungstypen', geometry: 'Zuschnitt, Drehung und Spiegelung', local: 'Lokale Anpassungen und Masken', repairs: 'Reparaturstellen', rawDevelopment: 'RAW-Entwicklung',
	selected: 'Anzahl ausgewählter Fotos', targetPolicy: 'Stapeländerungen verwenden die aktive Version jedes ausgewählten Fotos. Das Quellfoto wird nicht synchronisiert.',
	autoPolicy: 'Nach jedem bestätigten Speichern werden diese ausgewählten Zielversionen synchronisiert. Konflikte beenden die automatische Synchronisierung; das Quellfoto bleibt gespeichert.',
	autoActive: 'Automatische Synchronisierung ist aktiviert.', copied: 'Einstellungen kopiert.', batch: 'Stapelergebnisse', finished: 'Abgeschlossen', cancelled: 'Abgebrochen', interrupted: 'Unterbrochen',
	applied: 'Angewendet', unchanged: 'Unverändert', conflict: 'Versionskonflikt', failed: 'Fehlgeschlagen', notAttempted: 'Nicht versucht',
	cleanup: 'Ein bestätigter Schreibvorgang wurde abgeschlossen, aber die Bereinigung ist fehlgeschlagen.', refresh: 'Die bestätigten Einstellungen wurden gespeichert. Die Bibliothek konnte nicht aktualisiert werden.',
	presetName: 'Name der Vorgabe', choosePreset: 'Vorgabe auswählen', noPreset: 'Keine Vorgabe ausgewählt', full: 'Vollständige Einstellungen', partial: 'Teilweise Einstellungen',
	actionFailed: 'Die Einstellungsaktion ist fehlgeschlagen. Vor einem erneuten Versuch neu laden.',
	savePreset: 'Aktuelle Einstellungen als Vorgabe speichern', applyPreset: 'Ausgewählte Vorgabe anwenden', renamePreset: 'Ausgewählte Vorgabe umbenennen', deletePreset: 'Ausgewählte Vorgabe löschen',
	reloadPresets: 'Vorgaben neu laden', presetSaved: 'Änderungen an Vorgaben gespeichert.', adjustment: 'Relative Anpassung', parameter: 'Parameter', delta: 'Relative Änderung', applyQuick: 'Relative Änderung anwenden',
	close: 'Schließen', cancel: 'Abbrechen', working: 'In Arbeit…', pasteLabel: 'Einstellungen einfügen', syncLabel: 'Einstellungen synchronisieren', autoLabel: 'Einstellungen automatisch synchronisieren', quickLabel: 'Schnellentwicklung', presetLabel: 'Vorgabe anwenden',
});
export type PhotoDevelopSettingsCopyV1 = Readonly<Record<keyof typeof EN, string> & { shared: Readonly<Record<string, string>> }>;
export function photoDevelopSettingsCopy(locale: string, profile: 'legacy2' | 'current3' = 'legacy2'): PhotoDevelopSettingsCopyV1 {
	const german = locale.toLowerCase().split('-')[0] === 'de', text = german ? DE : EN;
	return Object.freeze({ ...text, ...(profile === 'current3' ? { menu: german ? 'Einstellungen' : 'Settings' } : {}), shared: photoDevelopCopy(locale).shared });
}
