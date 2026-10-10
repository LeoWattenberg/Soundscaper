/* SPDX-License-Identifier: AGPL-3.0-only */

const EN = Object.freeze({ title: 'Export PNG', description: 'Save the selected photo’s current version as a PNG. Original metadata is omitted.',
	save: 'Save PNG', close: 'Close', preparing: 'Preparing export…', working: 'Exporting…',
	saved: 'PNG saved: {name}', downloadStarted: 'Download started: {name}. Check your browser’s downloads.',
	cancelled: 'Export cancelled.', failed: 'The PNG export failed. Close and reopen Export PNG to try again.',
	summary: '{width} × {height} pixels · {bytes} bytes', fileType: 'PNG image',
	outputSize: 'Output dimensions', originalSize: 'Original dimensions', fitSize: 'Fit within', longEdgeSize: 'Long edge', megapixelsSize: 'Megapixels', percentageSize: 'Percentage',
	width: 'Maximum width (pixels)', height: 'Maximum height (pixels)', pixels: 'Long edge (pixels)', megapixels: 'Megapixels', percentage: 'Percentage', allowUpscale: 'Allow upscaling',
	resample: 'Resampling', nearest: 'Nearest neighbor', bilinear: 'Bilinear', filenameTemplate: 'Filename template',
	filenameHelp: 'Use {name}, {index}, or {index:3}. Double braces write a literal brace. The selected format supplies the extension.', invalidSettings: 'Check the output settings and filename template.' });
const DE = Object.freeze({ title: 'PNG exportieren', description: 'Die aktuelle Version des ausgewählten Fotos als PNG speichern. Original-Metadaten werden weggelassen.',
	save: 'PNG speichern', close: 'Schließen', preparing: 'Export wird vorbereitet…', working: 'Wird exportiert…',
	saved: 'PNG gespeichert: {name}', downloadStarted: 'Download gestartet: {name}. Prüfen Sie die Downloads Ihres Browsers.',
	cancelled: 'Export abgebrochen.', failed: 'Der PNG-Export ist fehlgeschlagen. Schließen und öffnen Sie den Export erneut.',
	summary: '{width} × {height} Pixel · {bytes} Bytes', fileType: 'PNG-Bild',
	outputSize: 'Ausgabegröße', originalSize: 'Originalgröße', fitSize: 'Einpassen', longEdgeSize: 'Lange Kante', megapixelsSize: 'Megapixel', percentageSize: 'Prozent',
	width: 'Maximale Breite (Pixel)', height: 'Maximale Höhe (Pixel)', pixels: 'Lange Kante (Pixel)', megapixels: 'Megapixel', percentage: 'Prozent', allowUpscale: 'Vergrößern erlauben',
	resample: 'Neuberechnung', nearest: 'Nächster Nachbar', bilinear: 'Bilinear', filenameTemplate: 'Dateinamenvorlage',
	filenameHelp: 'Verwenden Sie {name}, {index} oder {index:3}. Doppelte Klammern schreiben eine einzelne Klammer. Das gewählte Format ergänzt die Endung.', invalidSettings: 'Prüfen Sie die Ausgabe-Einstellungen und die Dateinamenvorlage.' });
export function photoPngExportCopy(locale: string) { return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN; }
