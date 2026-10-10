/* SPDX-License-Identifier: AGPL-3.0-only */

const EN = Object.freeze({ title: 'Export PNG', description: 'Save the selected photo’s current version as a full-resolution PNG. Original metadata is omitted.',
	save: 'Save PNG', close: 'Close', preparing: 'Preparing export…', working: 'Exporting…',
	saved: 'PNG saved: {name}', downloadStarted: 'Download started: {name}. Check your browser’s downloads.',
	cancelled: 'Export cancelled.', failed: 'The PNG export failed. Close and reopen Export PNG to try again.',
	summary: '{width} × {height} pixels · {bytes} bytes', fileType: 'PNG image' });
const DE = Object.freeze({ title: 'PNG exportieren', description: 'Die aktuelle Version des ausgewählten Fotos als PNG in voller Auflösung speichern. Original-Metadaten werden weggelassen.',
	save: 'PNG speichern', close: 'Schließen', preparing: 'Export wird vorbereitet…', working: 'Wird exportiert…',
	saved: 'PNG gespeichert: {name}', downloadStarted: 'Download gestartet: {name}. Prüfen Sie die Downloads Ihres Browsers.',
	cancelled: 'Export abgebrochen.', failed: 'Der PNG-Export ist fehlgeschlagen. Schließen und öffnen Sie den Export erneut.',
	summary: '{width} × {height} Pixel · {bytes} Bytes', fileType: 'PNG-Bild' });
export function photoPngExportCopy(locale: string) { return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN; }
