/* SPDX-License-Identifier: AGPL-3.0-only */
import { isBatchableSelectionEffectStep, SELECTION_EFFECT_CHAIN_STEP_LIMIT, type SelectionEffectChainStep } from '../../../../selection-effect-chain-contract.ts';

export interface OfflineChainStep { readonly type: string; readonly params: Readonly<Record<string, unknown>> }
export interface OfflineSelectionChainRequest {
	readonly operation: 'apply-chain'; readonly steps: readonly SelectionEffectChainStep[];
	readonly channels: readonly Float32Array[]; readonly sampleRate: number;
}
export type RunOfflineSelectionChain = (request: OfflineSelectionChainRequest) => Promise<Readonly<{ channels: readonly Float32Array[] }>>;

/** Context and rack barriers keep their individual execution; only private, context-free runs cross one worker boundary. */
export async function runOfflineSelectionSegment<Step extends OfflineChainStep>(steps: readonly Step[], initial: readonly Float32Array[],
	applyOne: (step: Step, channels: readonly Float32Array[]) => Promise<readonly Float32Array[]>, sampleRate: number,
	assertCurrent: () => void, runChain?: RunOfflineSelectionChain): Promise<readonly Float32Array[]> {
	let channels = initial;
	for (let index = 0; index < steps.length;) {
		let end = index;
		if (runChain) while (end < steps.length && end - index < SELECTION_EFFECT_CHAIN_STEP_LIMIT
			&& isBatchableSelectionEffectStep({ effectType: steps[end]!.type, params: steps[end]!.params })) end++;
		if (runChain && end - index > 1) {
			assertCurrent();
			const result = await runChain({ operation: 'apply-chain', channels, sampleRate,
				steps: steps.slice(index, end).map((step) => ({ effectType: step.type, params: step.params })) });
			assertCurrent(); channels = result.channels; index = end;
		} else { channels = await applyOne(steps[index]!, channels); index++; }
	}
	return channels;
}
