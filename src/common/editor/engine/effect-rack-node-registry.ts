/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EffectRackOptions } from './effect-rack.ts';
import type { EngineEffect } from './types.ts';

/**
 * Where a built effect node is filed, and whether the platform can build one.
 *
 * Both the rack and the builders it composes need these, and neither may import the other
 * to get them: the rack imports the builders, so a builder reaching back for a helper
 * would close a runtime cycle that initializes in whichever order the bundler picks.
 */

export function audioWorkletNodeConstructor(): typeof AudioWorkletNode | null {
	return typeof globalThis.AudioWorkletNode === 'function' ? globalThis.AudioWorkletNode : null;
}

export function registerEffectNode(
	effect: EngineEffect,
	processor: AudioNode,
	options: EffectRackOptions,
): string | null {
	if (!options.effectNodes || typeof effect?.id !== 'string' || !effect.id) return null;
	const key = effectGraphKey(options.scope, options.targetId, effect.id);
	options.effectNodes.set(key, processor);
	return key;
}

export function effectGraphKey(scope: unknown, targetId: unknown, effectId: unknown): string {
	const normalizedScope = String(scope || '');
	if (!['track', 'master', 'group', 'send'].includes(normalizedScope)) {
		throw new RangeError(`Unsupported effect scope: ${normalizedScope || '(empty)'}.`);
	}
	if (typeof effectId !== 'string' || !effectId) throw new TypeError('A stable effect ID is required.');
	let normalizedTargetId = 'master';
	if (normalizedScope !== 'master') {
		if (targetId == null || String(targetId) === '') {
			throw new TypeError(`A ${normalizedScope} effect target ID is required.`);
		}
		normalizedTargetId = String(targetId);
	}
	return JSON.stringify([normalizedScope, normalizedTargetId, effectId]);
}
