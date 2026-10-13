/* SPDX-License-Identifier: AGPL-3.0-only */

import { photoDevelopBrushMaskCopy } from './lightscaper-develop-brush-mask-copy.ts';

const EN = Object.freeze({
	coordinates: 'Paint coverage from zero on the left/top to one on the right/bottom. The grid maps to the image entering each selected adjustment. The preview and overlay follow later crop and rotation.',
	local: 'Strokes stay local until Apply. The Frame project preserves the installed brush mask.',
	failed: 'The brush mask action failed. Your saved image is unchanged.',
});
const DE: Readonly<Record<keyof typeof EN, string>> = Object.freeze({
	coordinates: 'Male die Abdeckung von null links/oben bis eins rechts/unten. Das Raster bezieht sich auf das Bild am Eingang jeder gewählten Anpassung. Vorschau und Überlagerung folgen anschließendem Zuschnitt und Drehen.',
	local: 'Striche bleiben bis zum Anwenden lokal. Das Frame-Projekt bewahrt die gespeicherte Pinselmaske.',
	failed: 'Die Pinselaktion ist fehlgeschlagen. Das gespeicherte Bild bleibt unverändert.',
});
export function framescaperImageBrushMaskCopyV1(locale: string): Readonly<Record<keyof ReturnType<typeof photoDevelopBrushMaskCopy>, string>> {
	const language = locale.toLowerCase().split('-')[0] === 'de' ? 'de' : 'en';
	return Object.freeze({ ...photoDevelopBrushMaskCopy(language), ...(language === 'de' ? DE : EN) });
}
