/* SPDX-License-Identifier: AGPL-3.0-only */

import { addNode, connect, type AudioNodeCollection } from './audio-node-utils.ts';
import { clamp, positiveInteger } from './buffer-math.ts';

export const PARAMETRIC_EQ_SPECTRUM_FFT_SIZE = 4_096;

export interface EffectSpectrumMetadata {
	readonly sampleRate: number;
	readonly fftSize: number;
	readonly frequencyBinCount: number;
	readonly minDecibels: number;
	readonly maxDecibels: number;
}

export interface SpectrumAnalyserNode extends AnalyserNode {
	getFloatFrequencyData(target: Float32Array): void;
}

export interface EffectAnalyserEntry {
	readonly input: SpectrumAnalyserNode;
	readonly output: SpectrumAnalyserNode;
	readonly inputChannels?: readonly SpectrumAnalyserNode[];
	readonly outputChannels?: readonly SpectrumAnalyserNode[];
	readonly metadata: EffectSpectrumMetadata;
}

/** Side taps preserve programme channels and avoid the analyser's mono downmix. */
export function createEffectSpectrumBank(
	context: BaseAudioContext,
	source: AudioNode,
	nodes: AudioNodeCollection,
	channelCount: unknown,
): readonly SpectrumAnalyserNode[] {
	if (typeof context.createAnalyser !== 'function') return [];
	const width = typeof context.createChannelSplitter === 'function'
		? clamp(positiveInteger(channelCount, 2), 1, 32) : 1;
	const splitter = typeof context.createChannelSplitter === 'function'
		? addNode(nodes, context.createChannelSplitter(width)) : null;
	if (splitter) connect(source, splitter);
	const channels: SpectrumAnalyserNode[] = [];
	for (let channel = 0; channel < width; channel++) {
		const analyser = addNode(nodes, context.createAnalyser());
		analyser.fftSize = PARAMETRIC_EQ_SPECTRUM_FFT_SIZE;
		analyser.smoothingTimeConstant = 0.75;
		analyser.minDecibels = -120;
		analyser.maxDecibels = 0;
		if (splitter) connect(splitter, analyser, channel, 0);
		else connect(source, analyser);
		channels.push(analyser as SpectrumAnalyserNode);
	}
	return Object.freeze(channels);
}

const channelReadBuffers = new WeakMap<SpectrumAnalyserNode, Float32Array>();

export function readParametricEqSpectrumEntry(
	entry: EffectAnalyserEntry | null | undefined,
	which: unknown,
	target: Float32Array,
): EffectSpectrumMetadata | null {
	if (!(target instanceof Float32Array)) throw new TypeError('A Float32Array spectrum target is required.');
	if (which !== 'input' && which !== 'output') {
		throw new RangeError('Parametric EQ spectrum source must be input or output.');
	}
	const analyser = entry?.[which];
	if (!entry || typeof analyser?.getFloatFrequencyData !== 'function') {
		target.fill(Number.NEGATIVE_INFINITY);
		return null;
	}
	if (target.length !== entry.metadata.frequencyBinCount) {
		throw new RangeError(`Parametric EQ spectrum buffers must contain ${entry.metadata.frequencyBinCount} bins.`);
	}
	const channels = (which === 'input' ? entry.inputChannels : entry.outputChannels) ?? [analyser];
	if (channels.length <= 1) analyser.getFloatFrequencyData(target);
	else {
		target.fill(0);
		for (const channel of channels) {
			let values = channelReadBuffers.get(channel);
			if (!values || values.length !== target.length) {
				values = new Float32Array(target.length);
				channelReadBuffers.set(channel, values);
			}
			channel.getFloatFrequencyData(values);
			for (let bin = 0; bin < target.length; bin++) target[bin] = target[bin]! + 10 ** (values[bin]! / 10);
		}
		for (let bin = 0; bin < target.length; bin++) target[bin] = 10 * Math.log10(target[bin]! / channels.length);
	}
	return entry.metadata;
}
