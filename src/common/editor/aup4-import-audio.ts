/* SPDX-License-Identifier: AGPL-3.0-only */

import { createStreamingWindowedSincResampler } from './resample.js';
import { scaleSampleFrame } from './timeline-time.ts';
import { AUP4_IMPORT_CHUNK_FRAMES, type Aup4ImportBlock, type Aup4ImportChannel, type Aup4ImportSourcePlan } from './aup4-import-plan.ts';

export type ReadAup4ImportSamples = (
	block: Aup4ImportBlock, offset: number, frames: number,
) => PromiseLike<Float32Array> | Float32Array;

/** One output chunk per pull. No queue or allocation grows with clip duration. */
export async function* streamAup4SourceAudio(
	source: Aup4ImportSourcePlan,
	read: ReadAup4ImportSamples,
	checkCancelled: () => void = () => undefined,
): AsyncGenerator<Float32Array[]> {
	const readers = source.channelPlans.map((channel) => channelReader(
		streamChannel(channel, source.sampleRate, read, checkCancelled), channel.outputFrames,
	));
	try {
		for (let offset = 0; offset < source.frameCount; offset += AUP4_IMPORT_CHUNK_FRAMES) {
			checkCancelled();
			const frames = Math.min(AUP4_IMPORT_CHUNK_FRAMES, source.frameCount - offset);
			const channels: Float32Array[] = [];
			for (const reader of readers) channels.push(await reader.read(frames));
			checkCancelled();
			yield channels;
		}
	} finally {
		for (const reader of readers) await reader.close();
	}
}

async function* streamChannel(
	channel: Aup4ImportChannel, outputRate: number, read: ReadAup4ImportSamples, check: () => void,
): AsyncGenerator<Float32Array> {
	const resampler = channel.sampleRate === outputRate ? null
		: createStreamingWindowedSincResampler(channel.sampleRate, outputRate, 1) as unknown as {
			push(channels: Float32Array[]): Float32Array[]; finish(frames: number): Float32Array[];
		};
	// Upsampling must also bound the output produced by each resampler push.
	const inputFrames = Math.max(1, Math.min(AUP4_IMPORT_CHUNK_FRAMES,
		scaleSampleFrame(AUP4_IMPORT_CHUNK_FRAMES, outputRate, channel.sampleRate, 'enclosingStart')));
	for (const block of channel.blocks) {
		for (let offset = 0; offset < block.frameCount; offset += inputFrames) {
			check();
			const count = Math.min(inputFrames, block.frameCount - offset);
			const samples = block.blockId < 0 ? new Float32Array(count) : await read(block, offset, count);
			check();
			if (samples.length !== count) throw new Error('An Audacity sample block returned an incomplete audio range.');
			const output = resampler ? resampler.push([samples])[0]! : samples;
			if (output.length) yield output;
		}
	}
	if (resampler && channel.frameCount) {
		const tail = resampler.finish(channel.outputFrames)[0]!;
		if (tail.length) yield tail;
	}
}

function channelReader(iterator: AsyncGenerator<Float32Array>, totalFrames: number) {
	let pending: Float32Array = new Float32Array(0);
	let pendingOffset = 0;
	let readFrames = 0;
	return {
		async read(frames: number): Promise<Float32Array> {
			const output = new Float32Array(frames);
			const wanted = Math.min(frames, totalFrames - readFrames);
			let written = 0;
			while (written < wanted) {
				if (pendingOffset === pending.length) {
					const next = await iterator.next();
					if (next.done) throw new Error('An Audacity channel ended before its declared length.');
					pending = next.value;
					pendingOffset = 0;
				}
				const length = Math.min(wanted - written, pending.length - pendingOffset);
				output.set(pending.subarray(pendingOffset, pendingOffset + length), written);
				pendingOffset += length;
				written += length;
			}
			readFrames += written;
			return output;
		},
		async close(): Promise<void> { pending = new Float32Array(0); await iterator.return(undefined); },
	};
}
