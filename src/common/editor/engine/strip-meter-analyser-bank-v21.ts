/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeStripRef, type StripRef } from '../parameter-address.ts';
import { addNode, connect, type AudioNodeArray } from './audio-node-utils.ts';
import { createAnalyser } from './effect-rack.ts';

export interface StripMeterAnalyserBankV21 {
	readonly strip: StripRef;
	readonly output: AudioNode;
	readonly channelLabels: readonly string[];
	readonly analysers: readonly AnalyserNode[];
}

/** Tap one bounded analyser per declared channel without rewriting the signal path. */
export function createStripMeterAnalyserBankV21(
	context: BaseAudioContext,
	nodes: AudioNodeArray,
	input: AudioNode,
	stripValue: unknown,
	channelCountValue: unknown,
): StripMeterAnalyserBankV21 | null {
	const channelCount = channelCountValue;
	if (!Number.isSafeInteger(channelCount) || Number(channelCount) < 1 || Number(channelCount) > 32) {
		throw new RangeError('Production strip meters require 1 through 32 declared channels.');
	}
	if (typeof context.createAnalyser !== 'function'
		|| typeof context.createChannelSplitter !== 'function') return null;
	const width = Number(channelCount);
	const splitter = addNode(nodes, context.createChannelSplitter(width));
	connect(input, splitter);
	const analysers: AnalyserNode[] = [];
	for (let channel = 0; channel < width; channel += 1) {
		const analyser = createAnalyser(context, nodes);
		if (!analyser) throw new Error('Production strip analyser construction failed.');
		connect(splitter, analyser, channel, 0);
		analysers.push(analyser);
	}
	return Object.freeze({
		strip: normalizeStripRef(stripValue),
		output: input,
		channelLabels: channelLabels(width),
		analysers: Object.freeze(analysers),
	});
}

export function channelLabels(channelCount: number): readonly string[] {
	const known: Readonly<Record<number, readonly string[]>> = {
		1: ['M'],
		2: ['L', 'R'],
		3: ['L', 'R', 'C'],
		4: ['L', 'R', 'Ls', 'Rs'],
		5: ['L', 'R', 'C', 'Ls', 'Rs'],
		6: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'],
		8: ['L', 'R', 'C', 'LFE', 'Lss', 'Rss', 'Lrs', 'Rrs'],
	};
	return Object.freeze([...(known[channelCount]
		?? Array.from({ length: channelCount }, (_value, index) => `Ch ${String(index + 1)}`))]);
}
