/* SPDX-License-Identifier: AGPL-3.0-only */
const EN = Object.freeze({ title: 'Export presets', choose: 'Choose export preset', fresh: 'New preset', name: 'Preset name',
	save: 'Save current export settings', apply: 'Apply preset', remove: 'Delete preset', reload: 'Reload presets',
	preparing: 'Loading export presets…', saved: 'Export preset saved.', removed: 'Export preset deleted.',
	failed: 'Export presets could not be read or changed. Reload before trying again.', unavailable: 'Export presets are unavailable for this library.',
	batchSidecar: 'This preset includes a sidecar. Batch sidecar delivery is not available; the current settings were kept.',
	graphic: 'Presets contain no graphic image. Applying a preset clears the graphic selection; select a file again to add a watermark.' });
const DE = Object.freeze({ title: 'Exportvorgaben', choose: 'Exportvorgabe wählen', fresh: 'Neue Vorgabe', name: 'Name der Vorgabe',
	save: 'Aktuelle Exporteinstellungen speichern', apply: 'Vorgabe anwenden', remove: 'Vorgabe löschen', reload: 'Vorgaben neu laden',
	preparing: 'Exportvorgaben werden geladen…', saved: 'Exportvorgabe gespeichert.', removed: 'Exportvorgabe gelöscht.',
	failed: 'Exportvorgaben konnten nicht gelesen oder geändert werden. Vor einem erneuten Versuch neu laden.', unavailable: 'Exportvorgaben sind für diese Bibliothek nicht verfügbar.',
	batchSidecar: 'Diese Vorgabe enthält eine Begleitdatei. Stapelweise Begleitdateien sind nicht verfügbar; die aktuellen Einstellungen wurden beibehalten.',
	graphic: 'Vorgaben enthalten kein Grafikbild. Beim Anwenden wird die Grafikauswahl gelöscht; für ein Wasserzeichen erneut eine Datei wählen.' });
export function photoExportPresetsCopy(locale: string) { return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN; }
