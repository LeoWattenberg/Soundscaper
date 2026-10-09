/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperVisualInspectorDraft } from '../framescaper-visual-inspector-model.ts';

export type VisualInspectorNumberField = 'opacity' | 'fontSize' | 'grainSize' | 'seed' | 'windowSeconds';
export type VisualInspectorNumberDrafts = Readonly<Partial<Record<VisualInspectorNumberField, string>>>;

/** Complete native numeric text once at the form's existing Apply boundary. */
export function completeVisualInspectorNumberDraft(
	draft: FramescaperVisualInspectorDraft, values: VisualInspectorNumberDrafts,
): FramescaperVisualInspectorDraft {
	const number = (field: VisualInspectorNumberField, fallback: number): number => {
		const text = values[field];
		if (text === undefined) return fallback;
		const parsed = Number(text);
		if (!text.trim() || !Number.isFinite(parsed)) {
			throw new TypeError('The numeric field requires a complete number.');
		}
		return parsed;
	};
	let generator = draft.generator;
	if (generator?.kind === 'title' || generator?.kind === 'text') {
		generator = { ...generator, fontSize: number('fontSize', generator.fontSize) };
	} else if (generator?.kind === 'noise') {
		generator = { ...generator, grainSize: number('grainSize', generator.grainSize),
			seed: number('seed', generator.seed) };
	} else if (generator?.kind === 'sound-visualizer') {
		generator = { ...generator, windowSeconds: number('windowSeconds', generator.windowSeconds) };
	}
	return { ...draft, opacity: number('opacity', draft.opacity), generator };
}
