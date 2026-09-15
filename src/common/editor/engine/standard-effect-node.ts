/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StandardEffectType } from '../first-party-effects/standard/definition.ts';
import { standardEffectStateBytes } from '../first-party-effects/standard/selection-contract.ts';

const loaded = new WeakSet<BaseAudioContext>();
const pending = new WeakMap<BaseAudioContext, Promise<void>>();
export const isStandardEffectWorkletLoaded = (context: BaseAudioContext): boolean => loaded.has(context);

export async function ensureStandardEffectWorklet(context: BaseAudioContext): Promise<void> {
	if (loaded.has(context)) return;
	let operation = pending.get(context);
	if (!operation) {
		operation = (async () => {
			const url = import.meta.env?.DEV || import.meta.env?.PROD
				? (await import('../first-party-effects/standard/worklet.js?worker&url')).default
				: new URL('../first-party-effects/standard/worklet.js', import.meta.url);
			await context.audioWorklet.addModule(String(url));
			loaded.add(context);
		})();
		pending.set(context, operation);
	}
	try { await operation; }
	finally { if (pending.get(context) === operation) pending.delete(context); }
}

interface WorkletNodeConstructor {
	new (context: BaseAudioContext, name: string, options?: Record<string, unknown>): AudioWorkletNode;
}

export function createStandardEffectNode(context: BaseAudioContext, WorkletNode: WorkletNodeConstructor | null,
	type: StandardEffectType, params: Record<string, unknown>, channelCount: number): AudioWorkletNode {
	if (!loaded.has(context) || !WorkletNode) throw new Error('The standard effect processor was not loaded.');
	standardEffectStateBytes(type, params, context.sampleRate, channelCount);
	return new WorkletNode(context, 'kw-standard-effect', {
		numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [channelCount],
		channelCount, channelCountMode: 'explicit', channelInterpretation: 'discrete',
		processorOptions: { type, params, channelCount },
	});
}
