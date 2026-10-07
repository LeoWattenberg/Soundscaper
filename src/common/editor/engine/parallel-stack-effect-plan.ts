/* SPDX-License-Identifier: AGPL-3.0-only */

import { compileParallelStackEffect } from './parallel-stack-effects.ts';
import type { ParallelStackEffect } from './parallel-stack-types.ts';
import type { EngineEffect } from './types.ts';

/** Preserve complete flag inspection before compilation, then reuse its private dense array. */
export function compileParallelStackEffectInventory(
	rack: readonly EngineEffect[],
	sampleRate: number,
	channels: number,
): { effects: ParallelStackEffect[]; hasParametricEq: boolean; latencyFrames: number } {
	const selected = rack.filter(effect => effect.enabled !== false && effect.bypassed !== true);
	// Exotic caller-owned array methods/species keep their original map semantics.
	if (Object.getPrototypeOf(rack) !== Array.prototype || Object.hasOwn(rack, 'filter')
		|| Object.hasOwn(rack, 'constructor') || Object.getPrototypeOf(selected) !== Array.prototype
		|| !Object.isExtensible(selected)) {
		const effects = selected.map(effect => compileParallelStackEffect(effect, sampleRate, channels));
		return { effects, hasParametricEq: effects.some(effect => effect.type === 'parametric-eq'),
			latencyFrames: effects.reduce((sum, effect) => sum + effect.latencyFrames, 0) };
	}
	let hasParametricEq = false;
	let latencyFrames = 0;
	for (let index = 0; index < selected.length; index += 1) {
		const effect = compileParallelStackEffect(selected[index]!, sampleRate, channels);
		selected[index] = effect;
		hasParametricEq ||= effect.type === 'parametric-eq';
		latencyFrames += effect.latencyFrames;
	}
	// Every dense slot has been replaced, or compilation threw before publication.
	return { effects: selected as ParallelStackEffect[], hasParametricEq, latencyFrames };
}
