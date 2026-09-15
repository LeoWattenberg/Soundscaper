/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateChannels } from '../dynamics/core.ts';
import type { StandardEffectType } from './definition.ts';
import { isStandardFilterEffect } from './filters-definition.ts';
import { createStandardFilterProcessor } from './filters-dsp.ts';
import { createTremoloProcessor } from './tremolo-dsp.ts';
import { createVocoderProcessor } from './vocoder-dsp.ts';
import { createNoiseGateProcessor } from './noise-gate-dsp.ts';
import { createStandardDelayProcessor } from './delay-dsp.ts';
import type { StaffPadWasmRuntime } from '../../staffpad/runtime.js';

export interface StandardEffectOptions {
	readonly type: StandardEffectType;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly params?: Readonly<Record<string, unknown>>;
	readonly staffPadRuntime?: StaffPadWasmRuntime;
}

export interface StandardEffectProcessor {
	readonly latencyFrames?: number;
	reset(): void;
	updateParams(params: Readonly<Record<string, unknown>>): void;
	processBlock(input: readonly Float32Array[], output: readonly Float32Array[], frames: number): void;
	dispose?(): void;
}

export function createStandardEffectProcessor(options: StandardEffectOptions): StandardEffectProcessor {
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
	params: Readonly<Record<string, unknown>> = {}, staffPadRuntime?: StaffPadWasmRuntime): Float32Array[] {
	const frames = validateChannels(channels, sampleRate);
	const processor = createStandardEffectProcessor({ type, sampleRate, channelCount: channels.length, params, staffPadRuntime });
	const output = channels.map(() => new Float32Array(frames));
	const latency = processor.latencyFrames ?? 0;
	const blockSize = 1024;
	const zeros = channels.map(() => new Float32Array(blockSize));
	const scratch = channels.map(() => new Float32Array(blockSize));
	try {
		for (let offset = 0; offset < frames + latency; offset += blockSize) {
			const count = Math.min(blockSize, frames + latency - offset);
			const input = zeros.map((zero, channel) => {
				zero.fill(0);
				zero.set(channels[channel].subarray(offset, Math.min(frames, offset + count)));
				return zero;
			});
			processor.processBlock(input, scratch, count);
			const start = Math.max(0, latency - offset);
			const end = Math.min(count, frames + latency - offset);
			if (end > start) for (let channel = 0; channel < output.length; channel++) output[channel].set(scratch[channel].subarray(start, end), offset + start - latency);
		}
		return output;
	} finally { processor.dispose?.(); }
}
