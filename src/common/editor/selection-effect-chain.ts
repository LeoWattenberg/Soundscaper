/* SPDX-License-Identifier: AGPL-3.0-only */
import { matchAudacitySelectionChannels } from './audacity-selection.js';
import { isBatchableSelectionEffectStep, SELECTION_EFFECT_CHAIN_STEP_LIMIT, type SelectionEffectChainStep } from './selection-effect-chain-contract.ts';

export type SelectionEffectChainApply = (effectType: string, channels: Float32Array[], sampleRate: number,
	params: Readonly<Record<string, unknown>>, context: Readonly<{ onProgress?: (progress: number) => void }>) => Promise<Float32Array[]>;

/** Carry only the current PCM in one worker; keep the serial macro's channel matching after every step. */
export async function runSelectionEffectChain(steps: readonly SelectionEffectChainStep[], initial: Float32Array[], sampleRate: number,
	apply: SelectionEffectChainApply, onProgress?: (progress: number) => void, assertCurrent?: () => void, onStep?: (completed: number) => void): Promise<Float32Array[]> {
	if (!Array.isArray(steps) || !steps.length || steps.length > SELECTION_EFFECT_CHAIN_STEP_LIMIT) throw new RangeError('A selection effect chain requires one to 32 steps.');
	if (steps.some((step) => !isBatchableSelectionEffectStep(step))) throw new RangeError('Unsupported selection effect chain step.');
	let channels = initial;
	for (const [index, step] of steps.entries()) {
		assertCurrent?.();
		const count = channels.length;
		const result = await apply(step.effectType, channels, sampleRate, step.params,
			{ onProgress: (value) => onProgress?.((index + value) / steps.length) });
		assertCurrent?.();
		channels = matchAudacitySelectionChannels(result, count) as Float32Array[];
		onProgress?.((index + 1) / steps.length); onStep?.(index + 1);
	}
	return channels;
}
