/* SPDX-License-Identifier: AGPL-3.0-only */

const EN = Object.freeze({ enabled: 'Add a text watermark', text: 'Watermark text', color: 'Text color', anchor: 'Text position',
	width: 'Text width (% of available output width)', margin: 'Text margin (% of shorter output edge)', opacity: 'Text opacity (%)',
	help: 'Inter SemiBold: one line, up to 256 characters. Basic Latin, Latin-1, € and common punctuation are supported. Other characters are refused. Text changes only the exported output.',
	'top-left': 'Top left', 'top-center': 'Top center', 'top-right': 'Top right', 'middle-left': 'Middle left', 'middle-center': 'Center', 'middle-right': 'Middle right',
	'bottom-left': 'Bottom left', 'bottom-center': 'Bottom center', 'bottom-right': 'Bottom right' });
const DE = Object.freeze({ enabled: 'Textwasserzeichen hinzufügen', text: 'Wasserzeichentext', color: 'Textfarbe', anchor: 'Textposition',
	width: 'Textbreite (% der verfügbaren Ausgabebreite)', margin: 'Textrand (% der kürzeren Ausgabekante)', opacity: 'Textdeckkraft (%)',
	help: 'Inter SemiBold: eine Zeile mit bis zu 256 Zeichen. Basis-Latein, Latin-1, € und übliche Satzzeichen werden unterstützt. Andere Zeichen werden abgelehnt. Der Text ändert nur die exportierte Ausgabe.',
	'top-left': 'Oben links', 'top-center': 'Oben mittig', 'top-right': 'Oben rechts', 'middle-left': 'Mitte links', 'middle-center': 'Mitte', 'middle-right': 'Mitte rechts',
	'bottom-left': 'Unten links', 'bottom-center': 'Unten mittig', 'bottom-right': 'Unten rechts' });
export function imageExportTextCopy(locale: string) { return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN; }
