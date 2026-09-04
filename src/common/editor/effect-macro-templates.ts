/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEffectMacroDraft } from './effect-macros.js';
import { createMacroCommandStep } from './macro-command-steps.ts';

export const EFFECT_MACRO_TEMPLATE_IDS = Object.freeze(['restoration', 'fade-ends'] as const);

export type EffectMacroTemplateId = typeof EFFECT_MACRO_TEMPLATE_IDS[number];

export interface EffectMacroTemplateEffect extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: string;
	readonly params: Readonly<Record<string, unknown>>;
	readonly enabled?: boolean;
	readonly context?: Readonly<Record<string, unknown>>;
}

export interface EffectMacroTemplateDraft {
	readonly id: string;
	readonly name: string;
	readonly effects: readonly EffectMacroTemplateEffect[];
}

interface EffectMacroTemplateDraftOptions {
	readonly idFactory?: (prefix: string, index?: number) => string;
}

/** Create an independent editable draft from a built-in Macro Manager template. */
export function createEffectMacroTemplateDraft(
	templateId: EffectMacroTemplateId,
	options: EffectMacroTemplateDraftOptions = {},
): EffectMacroTemplateDraft {
	const template = TEMPLATES[templateId as string];
	if (!template) throw new RangeError(`Unknown effect macro template: ${String(templateId)}.`);
	return createEffectMacroDraft({ ...template(), ...options }) as EffectMacroTemplateDraft;
}

/**
 * Audacity's own "Fade Ends", step for step.
 *
 * It is the smaller of upstream's two built-in macros and the one that shows
 * what a macro is for: the selection moves between the effects, so a single
 * chain can act on the head and the tail of the same recording. The final
 * empty selection is upstream's too, which leaves the cursor at the start
 * rather than on the region the last fade touched.
 *
 * Upstream's other built-in, "MP3 Conversion", is Normalize followed by an MP3
 * export. The export half has no macro command here, so it is not offered
 * rather than shipped half-working.
 */
const TEMPLATES: Readonly<Record<string, () => Readonly<{
	name: string;
	effects: readonly Readonly<Record<string, unknown>>[];
}>>> = Object.freeze({
	restoration: () => ({
		name: 'Restoration',
		effects: [
			{ type: 'audacity-click-removal' },
			{ type: 'audacity-noise-reduction' },
			{ type: 'audacity-filter-curve-eq' },
		],
	}),
	'fade-ends': () => ({
		name: 'Fade ends',
		effects: [
			createMacroCommandStep('Select', { params: { start: 0, end: 1 } }),
			{ type: 'audacity-fade-in' },
			createMacroCommandStep('Select', { params: { start: 0, end: 1, relativeTo: 'project-end' } }),
			{ type: 'audacity-fade-out' },
			createMacroCommandStep('Select', { params: { start: 0, end: 0 } }),
		],
	}),
});

/** Noise Reduction in a macro is portable only when its profile travels with the draft. */
export function effectMacroMissingEmbeddedNoiseProfile(
	effects: readonly Readonly<{
		readonly type?: unknown;
		readonly enabled?: unknown;
		readonly context?: Readonly<Record<string, unknown>>;
	}>[],
): boolean {
	return effects.some((effect) => effect.enabled !== false
		&& effect.type === 'audacity-noise-reduction'
		&& !isRecord(effect.context?.noiseProfile));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
