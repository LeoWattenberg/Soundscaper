/* SPDX-License-Identifier: AGPL-3.0-only */

import { isBitcrusherWorkletLoaded } from './effect-worklets.ts';

export { BITCRUSHER_EFFECT_TYPE } from '../first-party-effects/bitcrusher/definition.js';

type UnknownRecord = Record<string, unknown>;

interface WorkletNodeConstructor {
	new (context: BaseAudioContext, name: string, options?: UnknownRecord): AudioNode;
}

export const BITCRUSHER_WORKLET_NAME = 'kw-audio-bitcrusher';

/**
 * Build the real-time bitcrusher node.
 *
 * The processor carries its own decimation phase and dither state, so the
 * node is created once per rack build and updated over its port rather than
 * being rebuilt when a parameter moves.
 */
export function createBitcrusherEffectNode(
	context: BaseAudioContext,
	WorkletNode: WorkletNodeConstructor | null,
	params: UnknownRecord,
	channelCount: number,
): AudioNode {
	if (!isBitcrusherWorkletLoaded(context)) throw new Error('The bitcrusher processor was not loaded.');
	if (!WorkletNode) throw new Error('This browser cannot run the bitcrusher.');
	return new WorkletNode(context, BITCRUSHER_WORKLET_NAME, {
		numberOfInputs: 1,
		numberOfOutputs: 1,
		outputChannelCount: [channelCount],
		processorOptions: { params, channelCount },
	});
}
