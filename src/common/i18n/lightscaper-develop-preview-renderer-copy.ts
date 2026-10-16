/* SPDX-License-Identifier: AGPL-3.0-only */
const EN = Object.freeze({ menu: 'Preview rendering…', title: 'Preview rendering', renderer: 'Preview renderer', cpu: 'CPU',
	gpu: 'Prefer GPU with CPU fallback', apply: 'Apply', close: 'Close',
	help: 'Use GPU rendering when the complete stack and native precision are supported. Otherwise the complete CPU renderer is used. This temporary preview choice does not change the saved photo or exports.' });
const DE = Object.freeze({ menu: 'Vorschauberechnung…', title: 'Vorschauberechnung', renderer: 'Vorschauberechnung', cpu: 'CPU',
	gpu: 'GPU bevorzugen, bei Bedarf CPU verwenden', apply: 'Anwenden', close: 'Schließen',
	help: 'Verwende die GPU, wenn der gesamte Effektstapel und die native Genauigkeit unterstützt werden. Andernfalls wird der gesamte Stapel auf der CPU berechnet. Diese temporäre Vorschauauswahl ändert weder das gespeicherte Foto noch Exporte.' });
export function photoDevelopPreviewRendererCopy(locale: string) { return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN; }
