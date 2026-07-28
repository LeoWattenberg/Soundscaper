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
		constructor(_context: BaseAudioContext, name: string, options: AudioWorkletNodeOptions) {
			worklets.push({ name, options });
		}
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

		assert.deepEqual(worklets.map(({ name, options }) => ({
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
