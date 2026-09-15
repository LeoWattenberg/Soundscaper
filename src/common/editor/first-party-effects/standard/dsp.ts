/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateChannels } from '../dynamics/core.ts';
import type { StandardEffectType } from './definition.ts';
import { isStandardFilterEffect } from './filters-definition.ts';
import { createStandardFilterProcessor } from './filters-dsp.ts';
import { createTremoloProcessor } from './tremolo-dsp.ts';
import { createVocoderProcessor } from './vocoder-dsp.ts';
import { createNoiseGateProcessor } from './noise-gate-dsp.ts';
import { createStandardDelayProcessor } from './delay-dsp.ts';

export interface StandardEffectOptions {
	readonly type: StandardEffectType;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly params?: Readonly<Record<string, unknown>>;
}

export function createStandardEffectProcessor(options: StandardEffectOptions) {
	if (isStandardFilterEffect(options.type)) return createStandardFilterProcessor({ ...options, type: options.type, params: options.params ?? {} });
	switch (options.type) {
		case 'tremolo': return createTremoloProcessor(options);
		case 'vocoder': return createVocoderProcessor(options);
		case 'noise-gate': return createNoiseGateProcessor(options);
		case 'multi-tap-delay': return createStandardDelayProcessor(options);
		default: throw new RangeError(`Unsupported standard effect: ${String(options.type)}.`);
	}
}

/** Selection processing uses exactly the state machine hosted in the worklet. */
export function applyStandardEffect(type: StandardEffectType, channels: readonly Float32Array[], sampleRate: number,
	params: Readonly<Record<string, unknown>> = {}): Float32Array[] {
	const frames = validateChannels(channels, sampleRate);
	const processor = createStandardEffectProcessor({ type, sampleRate, channelCount: channels.length, params });
	const output = channels.map(() => new Float32Array(frames));
	processor.processBlock(channels, output, frames);
	return output;
}
