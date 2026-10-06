/* SPDX-License-Identifier: AGPL-3.0-only */

import { audioEffectTypes, audioSelectionEffectLabel, createEffect } from '../../effects.js';

/** Replacements retain the slot identity but start with the new effect's defaults. */
export function mixerEffectReplacement(candidate: string, copy: Readonly<Record<string, string>>) {
	const normalized = candidate.trim().toLowerCase();
	const type = audioEffectTypes().find((entry) => [
		entry, audioSelectionEffectLabel(entry, copy), audioSelectionEffectLabel(entry, 'en'),
	].some((label) => label.trim().toLowerCase() === normalized));
	if (!type) throw new RangeError(`Unsupported mixer effect: ${candidate}.`);
	const effect = createEffect(type);
	return { type, params: effect.params, context: effect.context ?? null, state: effect.state ?? null };
}
