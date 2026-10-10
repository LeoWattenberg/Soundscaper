/* SPDX-License-Identifier: AGPL-3.0-only */

const EN = Object.freeze({ title: 'Export JPEG', description: 'Save the selected photo’s current version as a JPEG at 90% quality. Only opaque images are supported; use PNG for transparency. Original metadata is omitted.',
	save: 'Save JPEG', close: 'Close', preparing: 'Preparing export…', working: 'Exporting…',
	saved: 'JPEG saved: {name}', downloadStarted: 'Download started: {name}. Check your browser’s downloads.',
	cancelled: 'Export cancelled.', failed: 'The JPEG export failed. Close and reopen Export JPEG to try again.',
	summary: '{width} × {height} pixels · {bytes} bytes', fileType: 'JPEG image',
	outputSize: 'Output dimensions', originalSize: 'Original dimensions', fitSize: 'Fit within', longEdgeSize: 'Long edge', megapixelsSize: 'Megapixels', percentageSize: 'Percentage',
	width: 'Maximum width (pixels)', height: 'Maximum height (pixels)', pixels: 'Long edge (pixels)', megapixels: 'Megapixels', percentage: 'Percentage', allowUpscale: 'Allow upscaling',
	resample: 'Resampling', nearest: 'Nearest neighbor', bilinear: 'Bilinear', filenameTemplate: 'Filename template',
	filenameHelp: 'Use {name}, {index}, or {index:3}. Double braces write a literal brace. The selected format supplies the extension.', invalidSettings: 'Check the output settings and filename template.',
	outputSharpen: 'Sharpen output after resizing', sharpenAmount: 'Sharpening amount (%)', sharpenThreshold: 'Sharpening threshold (0–255)' });
const DE = Object.freeze({ title: 'JPEG exportieren', description: 'Die aktuelle Version des ausgewählten Fotos als JPEG mit 90 % Qualität speichern. Nur vollständig deckende Bilder werden unterstützt; verwenden Sie PNG für Transparenz. Original-Metadaten werden weggelassen.',
	save: 'JPEG speichern', close: 'Schließen', preparing: 'Export wird vorbereitet…', working: 'Wird exportiert…',
	saved: 'JPEG gespeichert: {name}', downloadStarted: 'Download gestartet: {name}. Prüfen Sie die Downloads Ihres Browsers.',
	cancelled: 'Export abgebrochen.', failed: 'Der JPEG-Export ist fehlgeschlagen. Schließen und öffnen Sie den Export erneut.',
	summary: '{width} × {height} Pixel · {bytes} Bytes', fileType: 'JPEG-Bild',
	outputSize: 'Ausgabegröße', originalSize: 'Originalgröße', fitSize: 'Einpassen', longEdgeSize: 'Lange Kante', megapixelsSize: 'Megapixel', percentageSize: 'Prozent',
	width: 'Maximale Breite (Pixel)', height: 'Maximale Höhe (Pixel)', pixels: 'Lange Kante (Pixel)', megapixels: 'Megapixel', percentage: 'Prozent', allowUpscale: 'Vergrößern erlauben',
	resample: 'Neuberechnung', nearest: 'Nächster Nachbar', bilinear: 'Bilinear', filenameTemplate: 'Dateinamenvorlage',
	filenameHelp: 'Verwenden Sie {name}, {index} oder {index:3}. Doppelte Klammern schreiben eine einzelne Klammer. Das gewählte Format ergänzt die Endung.', invalidSettings: 'Prüfen Sie die Ausgabe-Einstellungen und die Dateinamenvorlage.',
	outputSharpen: 'Ausgabe nach dem Skalieren schärfen', sharpenAmount: 'Stärke der Schärfung (%)', sharpenThreshold: 'Schwellenwert der Schärfung (0–255)' });
export function photoJpegExportCopy(locale: string) { return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN; }
