/* SPDX-License-Identifier: AGPL-3.0-only */

const EN = Object.freeze({ title: 'Export JPEG', description: 'Save the selected photo’s current version as a full-resolution JPEG at 90% quality. Only opaque images are supported; use PNG for transparency. Original metadata is omitted.',
	save: 'Save JPEG', close: 'Close', preparing: 'Preparing export…', working: 'Exporting…',
	saved: 'JPEG saved: {name}', downloadStarted: 'Download started: {name}. Check your browser’s downloads.',
	cancelled: 'Export cancelled.', failed: 'The JPEG export failed. Close and reopen Export JPEG to try again.',
	summary: '{width} × {height} pixels · {bytes} bytes', fileType: 'JPEG image' });
const DE = Object.freeze({ title: 'JPEG exportieren', description: 'Die aktuelle Version des ausgewählten Fotos als JPEG in voller Auflösung mit 90 % Qualität speichern. Nur vollständig deckende Bilder werden unterstützt; verwenden Sie PNG für Transparenz. Original-Metadaten werden weggelassen.',
	save: 'JPEG speichern', close: 'Schließen', preparing: 'Export wird vorbereitet…', working: 'Wird exportiert…',
	saved: 'JPEG gespeichert: {name}', downloadStarted: 'Download gestartet: {name}. Prüfen Sie die Downloads Ihres Browsers.',
	cancelled: 'Export abgebrochen.', failed: 'Der JPEG-Export ist fehlgeschlagen. Schließen und öffnen Sie den Export erneut.',
	summary: '{width} × {height} Pixel · {bytes} Bytes', fileType: 'JPEG-Bild' });
export function photoJpegExportCopy(locale: string) { return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN; }
