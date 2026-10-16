/* SPDX-License-Identifier: AGPL-3.0-only */

const EN = Object.freeze({
	menu: 'Merge HDR…', title: 'Merge HDR', reference: 'Reference exposure', exposure: 'Exposure difference (EV)',
	alignment: 'Alignment', noAlignment: 'None', ward: 'Align translations (Ward MTB)', deghost: 'Deghost',
	deghostOff: 'Off', deghostReference: 'Use reference for moving regions', threshold: 'Deghost threshold', fileName: 'HDR Original filename',
	preview: 'Preview', merge: 'Create HDR Original', close: 'Close', working: 'Reading and merging Originals…',
	previewCaption: 'Clipped sRGB preview. The HDR Original retains linear floating point values above white.',
	failed: 'HDR merge could not complete. Check the selection, exposure values and available storage.',
	invalid: 'Enter finite exposure differences from −16 to +16 EV, a valid threshold, and a safe .lshdr filename.',
	created: 'HDR Original created.',
	followupFailed: 'The HDR Original was saved, but a later operation failed. Close this dialog and reload the application.',
	manualExposure: 'No matching immutable exposure metadata is available. Enter the exposure differences explicitly.',
	metadataExposure: 'Exposure differences were suggested from the Originals’ capture metadata. Review them before creating the result.',
	diagnostics: 'Result diagnostics', motionPixels: 'Motion pixels', unresolvedPixels: 'Unresolved pixels',
});
const DE: Readonly<Record<keyof typeof EN, string>> = Object.freeze({
	menu: 'HDR zusammenfügen…', title: 'HDR zusammenfügen', reference: 'Referenzbelichtung', exposure: 'Belichtungsunterschied (EV)',
	alignment: 'Ausrichtung', noAlignment: 'Keine', ward: 'Verschiebungen ausrichten (Ward MTB)', deghost: 'Geisterbilder entfernen',
	deghostOff: 'Aus', deghostReference: 'Referenz für bewegte Bereiche verwenden', threshold: 'Schwellenwert für Geisterbilder', fileName: 'Dateiname des HDR-Originals',
	preview: 'Vorschau', merge: 'HDR-Original erstellen', close: 'Schließen', working: 'Originale werden gelesen und zusammengefügt…',
	previewCaption: 'Beschnittene sRGB-Vorschau. Das HDR-Original behält lineare Gleitkommawerte oberhalb von Weiß.',
	failed: 'HDR konnte nicht zusammengefügt werden. Auswahl, Belichtungswerte und verfügbaren Speicher prüfen.',
	invalid: 'Endliche Belichtungsunterschiede von −16 bis +16 EV, einen gültigen Schwellenwert und einen sicheren .lshdr-Dateinamen eingeben.',
	created: 'HDR-Original erstellt.',
	followupFailed: 'Das HDR-Original wurde gespeichert, aber ein späterer Vorgang ist fehlgeschlagen. Diesen Dialog schließen und die Anwendung neu laden.',
	manualExposure: 'Es sind keine passenden unveränderlichen Belichtungsmetadaten verfügbar. Die Belichtungsunterschiede ausdrücklich eingeben.',
	metadataExposure: 'Die Belichtungsunterschiede wurden aus den Aufnahmemetadaten der Originale vorgeschlagen. Vor dem Erstellen prüfen.',
	diagnostics: 'Ergebnisdiagnose', motionPixels: 'Bewegte Pixel', unresolvedPixels: 'Nicht aufgelöste Pixel',
});
export function imageHdrMergeCopy(locale: string): Readonly<Record<keyof typeof EN, string>> { return locale === 'de' ? DE : EN; }
