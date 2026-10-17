/* SPDX-License-Identifier: AGPL-3.0-only */
const EN = Object.freeze({ menu: 'Soft proof…', title: 'Soft proof', profile: 'Proof color profile', off: 'Off', srgb: 'sRGB', displayP3: 'Display P3',
	depth: 'Proof bit depth', eight: '8-bit', sixteen: '16-bit', apply: 'Apply', close: 'Close',
	help: 'Preview the selected output profile and bit depth on After. Before stays sRGB. This temporary choice is not saved in the photo or presets.',
	unavailable: 'This browser cannot verify Display P3 presentation. Choose sRGB or turn soft proof off.' });
const DE = Object.freeze({ menu: 'Softproof…', title: 'Softproof', profile: 'Softproof-Farbprofil', off: 'Aus', srgb: 'sRGB', displayP3: 'Display P3',
	depth: 'Softproof-Bittiefe', eight: '8 Bit', sixteen: '16 Bit', apply: 'Anwenden', close: 'Schließen',
	help: 'Zeige das gewählte Ausgabeprofil und die Bittiefe unter Nachher. Vorher bleibt sRGB. Diese temporäre Auswahl wird nicht im Foto oder in Vorgaben gespeichert.',
	unavailable: 'Dieser Browser kann die Display-P3-Darstellung nicht verifizieren. Wähle sRGB oder schalte den Softproof aus.' });
export function photoDevelopSoftProofCopy(locale: string) { return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN; }
