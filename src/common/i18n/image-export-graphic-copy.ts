/* SPDX-License-Identifier: AGPL-3.0-only */

const EN = Object.freeze({ enabled: 'Add a graphic watermark', file: 'Graphic file', anchor: 'Position', width: 'Width (% of available output width)',
	margin: 'Margin (% of shorter output edge)', opacity: 'Opacity (%)', help: 'Choose a static SDR image. Placement follows the final output dimensions. The graphic is used only for this export.',
	'top-left': 'Top left', 'top-center': 'Top center', 'top-right': 'Top right', 'middle-left': 'Middle left', 'middle-center': 'Center', 'middle-right': 'Middle right',
	'bottom-left': 'Bottom left', 'bottom-center': 'Bottom center', 'bottom-right': 'Bottom right' });
const DE = Object.freeze({ enabled: 'Grafisches Wasserzeichen hinzufügen', file: 'Grafikdatei', anchor: 'Position', width: 'Breite (% der verfügbaren Ausgabebreite)',
	margin: 'Rand (% der kürzeren Ausgabekante)', opacity: 'Deckkraft (%)', help: 'Wählen Sie ein statisches SDR-Bild. Die Position folgt der endgültigen Ausgabegröße. Die Grafik wird nur für diesen Export verwendet.',
	'top-left': 'Oben links', 'top-center': 'Oben mittig', 'top-right': 'Oben rechts', 'middle-left': 'Mitte links', 'middle-center': 'Mitte', 'middle-right': 'Mitte rechts',
	'bottom-left': 'Unten links', 'bottom-center': 'Unten mittig', 'bottom-right': 'Unten rechts' });
export function imageExportGraphicCopy(locale: string) { return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN; }
