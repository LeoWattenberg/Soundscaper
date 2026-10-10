/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEffect, effectGraphKey, readParametricEqSpectrumEntry, type EffectAnalyserEntry } from '../src/common/editor/engine/effect-rack.ts';
import { ensureParametricEqWorklet } from '../src/common/editor/engine/effect-worklets.ts';

/** A single Fourier-bin signal, with native speaker downmix at each analyser. */
class SignalNode {
	readonly incoming: { source: SignalNode; output: number }[] = [];
	constructor(readonly kind = 'pass', readonly recording?: readonly number[]) {}
	connect(destination: SignalNode, output = 0): SignalNode {
		destination.incoming.push({ source: this, output });
		return destination;
	}
	disconnect(): void { this.incoming.length = 0; }
	signal(output = 0): readonly number[] {
		if (this.recording) return this.recording;
		const input = this.incoming[0];
		const values = input?.source.signal(input.output) ?? [];
		return this.kind === 'splitter' ? [values[output] ?? 0] : values;
	}
}

class NativeSpectrum extends SignalNode {
	fftSize = 256;
	minDecibels = -100;
	maxDecibels = -30;
	smoothingTimeConstant = 0;
	get frequencyBinCount(): number { return this.fftSize / 2; }
	getFloatFrequencyData(values: Float32Array): void {
		const channels = this.signal();
		const mono = channels.reduce((sum, value) => sum + value, 0) / Math.max(1, channels.length);
		values.fill(-Infinity);
		values[37] = 20 * Math.log10(Math.abs(mono));
	}
}

class NeutralWorklet extends SignalNode {
	constructor(_context: BaseAudioContext, _name: string, _options: AudioWorkletNodeOptions) { super(); }
}

for (const channels of [[.5], [.5, .5], [.5, -.5], [.5, 0], [.5, -.5, 0, 0, 0, 0], [0, 0], [.5, -.5, ...Array<number>(30).fill(0)]]) {
	test(`EQ Input/Output spectra retain ordinary channel amplitudes ${channels.join(', ')}`, async () => {
		const previous = globalThis.AudioWorkletNode;
		globalThis.AudioWorkletNode = NeutralWorklet as unknown as typeof AudioWorkletNode;
		try {
			const context = {
				sampleRate: 48_000,
				audioWorklet: { addModule: async (): Promise<void> => {} },
				createAnalyser: (): AnalyserNode => new NativeSpectrum() as unknown as AnalyserNode,
				createChannelSplitter: (): ChannelSplitterNode => new SignalNode('splitter') as unknown as ChannelSplitterNode,
			} as unknown as BaseAudioContext;
			const module = await ensureParametricEqWorklet(context);
			const source = new SignalNode('recording', channels);
			const analysers = new Map<string, EffectAnalyserEntry>();
			const output = applyEffect(context, source as unknown as AudioNode,
				{ id: 'room-eq', type: 'parametric-eq', params: { bands: [], outputGain: 0 } }, [], {
					scope: 'track', targetId: 'room', effectAnalysis: true,
					effectNodes: new Map(), effectAnalysers: analysers,
					parametricEqWasmModule: module, parametricEqChannelCount: channels.length,
				});
			assert.deepEqual((output as unknown as SignalNode).signal(), channels, 'the side analysis must preserve the actual programme channels');
			const entry = analysers.get(effectGraphKey('track', 'room', 'room-eq'));
			assert.ok(entry, 'the ordinary EQ rack must expose its Input/Output spectra');
			const expected = 10 * Math.log10(channels.reduce((power, amplitude) => power + amplitude ** 2, 0) / channels.length);
			for (const side of ['input', 'output']) {
				const values = new Float32Array(2_048);
				assert.equal(readParametricEqSpectrumEntry(entry, side, values)?.sampleRate, 48_000);
				if (expected === -Infinity) assert.equal(values[37], -Infinity);
				else assert.ok(Math.abs(values[37]! - expected) < .000_01,
					`${side} spectrum must retain channel power: actual ${values[37]}, expected ${expected}`);
				assert.equal(values[36], -Infinity);
			}
		} finally { globalThis.AudioWorkletNode = previous; }
	});
}
