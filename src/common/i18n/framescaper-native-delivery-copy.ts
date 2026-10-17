/* SPDX-License-Identifier: AGPL-3.0-only */
export const FRAMESCAPER_NATIVE_DELIVERY_ENGLISH_COPY = Object.freeze({
	title: 'Export Frame sequence as ProRes 4444',
	description: 'Export the complete primary sequence using its accepted composition revisions and committed stereo mix. The current project is pinned for this export.',
	precision: 'Frame finishing supplies 8-bit managed SDR with straight alpha. Native delivery converts to Rec.709, with 10-bit ProRes encoder input, 16-bit alpha storage and 24-bit PCM audio.',
	unavailable: 'This desktop package has no authenticated ProRes helper. Use the regular video export menu or install a package that includes this capability.',
	width: 'Width', height: 'Height', transparent: 'Transparent background', export: 'Choose destination and export', cancel: 'Cancel export', close: 'Close',
	preparing: 'Preparing retained picture and audio…', progress: 'Picture frames: {completed} / {total}', saved: 'Saved {name}', cancelled: 'Export cancelled.',
	cleanupRequired: 'Native output cleanup is incomplete. Retry cleanup before closing this dialog or starting another export.', retryCleanup: 'Retry Output Cleanup',
	failed: 'Native export failed:', identity: 'Pinned Frame project digest',
});
const EN = FRAMESCAPER_NATIVE_DELIVERY_ENGLISH_COPY;
const DE: Readonly<Record<keyof typeof EN, string>> = Object.freeze({
	title: 'Frame-Sequenz als ProRes 4444 exportieren',
	description: 'Die gesamte Hauptsequenz mit ihren akzeptierten Kompositionsrevisionen und dem bestätigten Stereomix exportieren. Das aktuelle Projekt wird für diesen Export festgehalten.',
	precision: 'Frame-Finishing liefert 8-Bit-SDR mit Farbmanagement und geradem Alpha. Die native Ausgabe wandelt nach Rec.709 mit 10-Bit-ProRes-Encodereingang, 16-Bit-Alphaspeicherung und 24-Bit-PCM-Audio um.',
	unavailable: 'Dieses Desktop-Paket enthält keinen authentifizierten ProRes-Helfer. Den normalen Videoexport verwenden oder ein Paket mit dieser Funktion installieren.',
	width: 'Breite', height: 'Höhe', transparent: 'Transparenter Hintergrund', export: 'Ziel auswählen und exportieren', cancel: 'Export abbrechen', close: 'Schließen',
	preparing: 'Gespeicherte Bilder und Audio vorbereiten…', progress: 'Bilder: {completed} / {total}', saved: '{name} gespeichert', cancelled: 'Export abgebrochen.',
	cleanupRequired: 'Die Bereinigung der nativen Ausgabe ist unvollständig. Wiederhole die Bereinigung, bevor du diesen Dialog schließt oder einen weiteren Export startest.', retryCleanup: 'Ausgabebereinigung wiederholen',
	failed: 'Nativer Export fehlgeschlagen:', identity: 'Festgehaltener Frame-Projektdigest',
});
export function framescaperNativeDeliveryCopy(locale: string): Readonly<Record<keyof typeof EN, string>> { return locale.toLowerCase().startsWith('de') ? DE : EN; }
