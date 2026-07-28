/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEffect } from '../src/common/editor/engine/effect-rack.ts';
import { ensureProjectWorklets } from '../src/common/editor/engine/effect-worklets.ts';

interface CapturedWorklet {
	readonly name: string;
	readonly options: AudioWorkletNodeOptions;
}

test('Audacity and dynamics worklets retain the requested multichannel rack width', async () => {
	const previousAudioWorkletNode = globalThis.AudioWorkletNode;
	const worklets: CapturedWorklet[] = [];
	class MockAudioWorkletNode {
		readonly port = {
			onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
			start: () => undefined,
		};
		onprocessorerror: (() => void) | null = null;
		constructor(_context: BaseAudioContext, name: string, options: AudioWorkletNodeOptions) {
			worklets.push({ name, options });
			queueMicrotask(() => this.port.onmessage?.({
				data: { type: 'status', status: 'ready' },
			} as MessageEvent<unknown>));
		}
		disconnect(): void {}
	}
	Object.defineProperty(globalThis, 'AudioWorkletNode', {
		configurable: true,
		writable: true,
		value: MockAudioWorkletNode,
	});
	const context = {
		sampleRate: 48_000,
		currentTime: 0,
		audioWorklet: { addModule: async () => undefined },
	} as unknown as BaseAudioContext;
	const input = { connect: () => undefined } as unknown as AudioNode;
	try {
		await ensureProjectWorklets(context, {
			tracks: [{
				id: 'track',
				effects: [
					{ id: 'invert', type: 'audacity-invert' },
					{ id: 'limiter', type: 'limiter' },
				],
			}],
		});
		applyEffect(context, input, { id: 'invert', type: 'audacity-invert' }, [], {
			effectChannelCount: 6,
		});
		applyEffect(context, input, { id: 'limiter', type: 'limiter' }, [], {
			effectChannelCount: 48,
		});

		const renderedWorklets = worklets.slice(-2);
		assert.ok(renderedWorklets[0].options.processorOptions?.pffftWasmModule instanceof WebAssembly.Module);
		assert.deepEqual(renderedWorklets.map(({ name, options }) => ({
			name,
			outputChannelCount: options.outputChannelCount,
		})), [
			{ name: 'kw-audacity-live-effect', outputChannelCount: [6] },
			{ name: 'kw-audio-dynamics', outputChannelCount: [32] },
		]);
	} finally {
		if (previousAudioWorkletNode === undefined) Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
		else Object.defineProperty(globalThis, 'AudioWorkletNode', {
			configurable: true,
			writable: true,
			value: previousAudioWorkletNode,
		});
	}
});

test('project worklet preparation waits for the Audacity processor readiness signal', async () => {
	const previousAudioWorkletNode = globalThis.AudioWorkletNode;
	let resolveProbe!: (node: MockAudioWorkletNode) => void;
	const probeCreated = new Promise<MockAudioWorkletNode>((resolve) => { resolveProbe = resolve; });
	class MockAudioWorkletNode {
		readonly options: AudioWorkletNodeOptions;
		readonly port = {
			onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
			start: () => undefined,
		};
		onprocessorerror: (() => void) | null = null;
		constructor(_context: BaseAudioContext, name: string, options: AudioWorkletNodeOptions) {
			this.options = options;
			if (name === 'kw-audacity-live-effect') resolveProbe(this);
		}
		disconnect(): void {}
	}
	Object.defineProperty(globalThis, 'AudioWorkletNode', {
		configurable: true,
		writable: true,
		value: MockAudioWorkletNode,
	});
	const context = {
		audioWorklet: { addModule: async () => undefined },
	} as unknown as BaseAudioContext;
	let settled = false;
	try {
		const preparation = ensureProjectWorklets(context, {
			tracks: [{ id: 'track', effects: [{ id: 'invert', type: 'audacity-invert' }] }],
		}).then(() => { settled = true; });
		const probe = await probeCreated;
		assert.ok(probe.options.processorOptions?.pffftWasmModule instanceof WebAssembly.Module);
		assert.equal(settled, false);
		probe.port.onmessage?.({
			data: { type: 'status', status: 'ready' },
		} as MessageEvent<unknown>);
		await preparation;
		assert.equal(settled, true);
	} finally {
		if (previousAudioWorkletNode === undefined) Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
		else Object.defineProperty(globalThis, 'AudioWorkletNode', {
			configurable: true,
			writable: true,
			value: previousAudioWorkletNode,
		});
	}
});
