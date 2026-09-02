/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEffectMacroDraft } from './effect-macros.js';

export const EFFECT_MACRO_TEMPLATE_IDS = Object.freeze(['restoration'] as const);

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
	if (templateId !== 'restoration') {
		throw new RangeError(`Unknown effect macro template: ${String(templateId)}.`);
	}
	return createEffectMacroDraft({
		name: 'Restoration',
		effects: [
			{ type: 'audacity-click-removal' },
			{ type: 'audacity-noise-reduction' },
			{ type: 'audacity-filter-curve-eq' },
		],
		...options,
	}) as EffectMacroTemplateDraft;
}

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
