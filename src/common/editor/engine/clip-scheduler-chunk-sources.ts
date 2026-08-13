/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	addNode,
	connect,
	type AudioNodeArray,
} from './audio-node-utils.ts';
import { throwIfAborted } from './async-utils.ts';
import type {
	EngineChunkReadValue,
	EngineChunkReadContext,
	EngineChunkSource,
} from './types.ts';

export interface ClipGainChain {
	readonly input: GainNode;
	readonly fadeInGain: GainNode;
	readonly fadeOutGain: GainNode;
	readonly clipGain: GainNode;
}

/** The per-clip fade and gain chain both the streamed and offline routes hang a clip on. */
export function createClipGainChain(
	context: BaseAudioContext,
	trackInput: AudioNode,
	allNodes: AudioNodeArray | Set<AudioNode>,
): ClipGainChain {
	const fadeInGain = addNode(allNodes, context.createGain());
	const fadeOutGain = addNode(allNodes, context.createGain());
	const clipGain = addNode(allNodes, context.createGain());
	connect(fadeInGain, fadeOutGain);
	connect(fadeOutGain, clipGain);
	connect(clipGain, trackInput);
	return { input: fadeInGain, fadeInGain, fadeOutGain, clipGain };
}

/** Present a long source back-to-front without materializing the whole reversal. */
export function createReversedChunkSource(source: EngineChunkSource): EngineChunkSource {
	return Object.freeze({
		channelCount: source.channelCount,
		frameCount: source.frameCount,
		chunkFrames: source.chunkFrames,
		sampleRate: source.sampleRate,
		async readStorageChunk(chunkIndex: number, context: EngineChunkReadContext = {}) {
			const startFrame = chunkIndex * source.chunkFrames;
			const endFrame = Math.min(source.frameCount, startFrame + source.chunkFrames);
			if (startFrame >= endFrame) throw new RangeError(`Source storage chunk ${chunkIndex} does not exist.`);
			const physicalStart = source.frameCount - endFrame;
			const physicalEnd = source.frameCount - startFrame;
			const channels = await readChunkSourceRange(source, physicalStart, physicalEnd, context.signal);
			for (const channel of channels) channel.reverse();
			return channels;
		},
	});
}

export async function readChunkSourceRange(
	source: EngineChunkSource,
	startFrame: number,
	endFrame: number,
	signal?: AbortSignal | null,
): Promise<Float32Array[]> {
	const output = Array.from({ length: source.channelCount }, () => new Float32Array(endFrame - startFrame));
	let outputOffset = 0;
	const firstChunk = Math.floor(startFrame / source.chunkFrames);
	const lastChunk = Math.ceil(endFrame / source.chunkFrames) - 1;
	for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
		throwIfAborted(signal);
		const value = await source.readStorageChunk(chunkIndex, { signal });
		const channels = chunkChannels(value);
		const chunkStart = chunkIndex * source.chunkFrames;
		const from = Math.max(startFrame, chunkStart) - chunkStart;
		const to = Math.min(endFrame, chunkStart + (channels[0]?.length || 0)) - chunkStart;
		for (let channel = 0; channel < source.channelCount; channel += 1) {
			const values = channels[channel];
			if (!values) throw new Error('A long-source storage chunk has missing channels.');
			output[channel].set(values.subarray(from, to), outputOffset);
		}
		outputOffset += to - from;
	}
	if (outputOffset !== endFrame - startFrame) throw new Error('A long-source range is incomplete.');
	return output;
}

export function chunkChannels(value: EngineChunkReadValue): readonly Float32Array[] {
	return Array.isArray(value)
		? value as readonly Float32Array[]
		: (value as Readonly<{ channels: readonly Float32Array[] }>).channels;
}
