/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StandardEffectType } from '../first-party-effects/standard/definition.ts';
import { standardEffectStateBytes } from '../first-party-effects/standard/selection-contract.ts';
import { createAudioWorkletLoadOnce } from '../audio-worklet-load-once.ts';

const standardEffectWorklet = createAudioWorkletLoadOnce(async (context) => {
	const url = import.meta.env?.DEV || import.meta.env?.PROD
		? (await import('../first-party-effects/standard/worklet.js?worker&url')).default
		: new URL('../first-party-effects/standard/worklet.js', import.meta.url);
	await context.audioWorklet.addModule(String(url));
});
const staffPadModules = new WeakMap<BaseAudioContext, WebAssembly.Module>();
const staffPadLoads = new WeakMap<BaseAudioContext, Promise<void>>();
const standardNodes = new WeakSet<AudioWorkletNode>();
export const isStandardEffectWorkletLoaded = (context: BaseAudioContext): boolean => standardEffectWorklet.isLoaded(context);

/** Release native echo sessions before a stopped rack becomes unreachable. */
export function disposeStandardEffectNode(node: AudioNode): void {
	const processor = node as AudioWorkletNode;
	if (!standardNodes.delete(processor)) return;
	try { processor.port.postMessage({ type: 'dispose' }); }
	catch { /* The context may have already closed its message port. */ }
}

export async function ensureStandardDelayRuntime(context: BaseAudioContext): Promise<void> {
	if (staffPadModules.has(context)) return;
	let operation = staffPadLoads.get(context);
	if (!operation) {
		operation = import('../staffpad/runtime.js').then(async runtime => { staffPadModules.set(context, await runtime.loadStaffPadWasmModule()); });
		staffPadLoads.set(context, operation);
	}
	try { await operation; }
	finally { if (staffPadLoads.get(context) === operation) staffPadLoads.delete(context); }
}

export async function ensureStandardEffectWorklet(context: BaseAudioContext): Promise<void> {
	await standardEffectWorklet.ensure(context);
}

interface WorkletNodeConstructor {
	new (context: BaseAudioContext, name: string, options?: Record<string, unknown>): AudioWorkletNode;
}

export function createStandardEffectNode(context: BaseAudioContext, WorkletNode: WorkletNodeConstructor | null,
	type: StandardEffectType, params: Record<string, unknown>, channelCount: number): AudioWorkletNode {
	if (!standardEffectWorklet.isLoaded(context) || !WorkletNode) throw new Error('The standard effect processor was not loaded.');
	standardEffectStateBytes(type, params, context.sampleRate, channelCount);
	const node = new WorkletNode(context, 'kw-standard-effect', {
		numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [channelCount],
		channelCount, channelCountMode: 'explicit', channelInterpretation: 'discrete',
		processorOptions: { type, params, channelCount,
			...(type === 'multi-tap-delay' && staffPadModules.has(context) ? { staffPadWasmModule: staffPadModules.get(context) } : {}) },
	});
	standardNodes.add(node);
	return node;
}
