/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveEditorCopyScope } from './editor-copy-scope.ts';
import { localeLanguage } from './locale.js';
const ENTRIES = [
	['motionscaperCanvas', 'Composition Canvas', 'Kompositions-Canvas'],
	['motionscaperCanvasDescription', 'Select a layer by its source bounds or from the list. Drag to move; the square scales and the circle rotates around its authored anchor. Arrow keys move the focused handle by one composition pixel; Shift moves ten. Escape cancels a drag.', 'Eine Ebene über ihre Quellgrenzen oder die Liste auswählen. Ziehen verschiebt sie; das Quadrat skaliert und der Kreis dreht um ihren Anker. Pfeiltasten bewegen den fokussierten Griff um ein Kompositionspixel, mit Umschalt um zehn. Escape verwirft das Ziehen.'],
	['motionscaperCanvasLimits', 'Direct handles edit static 2D transforms. Animated or expression-driven transforms and 3D parenting stay in Properties and Keyframes or 3D Scene and Quality. Selection bounds include the source control area, not per-pixel transparency.', 'Griffe bearbeiten statische 2D-Transformationen. Animierte oder ausdrucksgesteuerte Transformationen und 3D-Eltern bleiben unter Eigenschaften und Keyframes oder 3D-Szene und Qualität. Die Auswahl nutzt den Quellbereich, keine pixelgenaue Transparenz.'],
	['motionscaperCanvasLayer', 'Canvas layer', 'Canvas-Ebene'],
	['motionscaperCanvasSelect', 'Select a layer', 'Ebene auswählen'],
	['motionscaperCanvasMove', 'Move selected layer', 'Ausgewählte Ebene verschieben'],
	['motionscaperCanvasScale', 'Scale selected layer', 'Ausgewählte Ebene skalieren'],
	['motionscaperCanvasRotate', 'Rotate selected layer', 'Ausgewählte Ebene drehen'],
	['motionscaperCanvasInactive', 'This layer has no editable 2D bounds at the selected frame.', 'Diese Ebene hat am ausgewählten Frame keine bearbeitbaren 2D-Grenzen.'],
	['motionscaperCanvasFrameInvalid', 'Enter a frame within this composition, including a fraction such as 1/2.', 'Einen Frame innerhalb dieser Komposition eingeben, auch als Bruch wie 1/2.'],
	['motionscaperCanvasDraft', 'Drag preview — release to publish one undoable edit', 'Zieh-Vorschau — Loslassen veröffentlicht einen rückgängig machbaren Schritt'],
] as const;
export const MOTIONSCAPER_CANVAS_COPY_BY_LOCALE = Object.freeze({ en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))), de: Object.freeze(Object.fromEntries(ENTRIES.map(([key, , de]) => [key, de]))) });
export function resolveMotionscaperCanvasCopy(locale: string, overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, string>> {
	return resolveEditorCopyScope('motionscaper-canvas', localeLanguage(locale) === 'de' ? MOTIONSCAPER_CANVAS_COPY_BY_LOCALE.de : MOTIONSCAPER_CANVAS_COPY_BY_LOCALE.en, overrides);
}
