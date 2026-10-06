/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEffect } from '../../effects.js';
import { resolveSupportedEffectType } from '../inspector/effect-helpers.ts';

/** Replacements retain the slot identity but start with the new effect's defaults. */
export function mixerEffectReplacement(candidate: string, copy: Readonly<Record<string, string>>) {
	const type = resolveSupportedEffectType(candidate, undefined, copy);
	if (!type) throw new RangeError(`Unsupported mixer effect: ${candidate}.`);
	const effect = createEffect(type);
	return { type, params: effect.params, context: effect.context ?? null, state: effect.state ?? null };
}
