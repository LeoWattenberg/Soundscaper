/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperAudioDataLike } from './framescaper-browser-audio-recorder.ts';
import type { CapturePcmChunk } from '../framescaper-capture-pcm-packetizer.ts';

/** Native AudioData may arrive every 10 ms; spool writes use the nominal PCM chunk size. */
export function createFramescaperAudioDataChunker(input: Readonly<{
	channelCount: number;
	chunkFrames: number;
	inputGain: number;
	onChunk(chunk: CapturePcmChunk): void;
}>) {
	let channels: Float32Array[] | null = null;
	let frames = 0;
	let frameStart = 0;

	function append(data: FramescaperAudioDataLike, start: number): void {
		for (let offset = 0; offset < data.numberOfFrames;) {
			if (!channels) {
				channels = Array.from({ length: input.channelCount }, () => new Float32Array(input.chunkFrames));
				frameStart = start + offset;
			}
			const count = Math.min(input.chunkFrames - frames, data.numberOfFrames - offset);
			channels.forEach((channel, planeIndex) => {
				const target = channel.subarray(frames, frames + count);
				data.copyTo(target, { planeIndex, frameOffset: offset, frameCount: count, format: 'f32-planar' });
				if (input.inputGain !== 1) target.forEach((value, index) => { target[index] = value * input.inputGain; });
			});
			frames += count;
			offset += count;
			if (frames === input.chunkFrames) flush();
		}
	}

	function discard(): void { channels = null; frames = 0; }

	function flush(): void {
		if (!channels || !frames) return;
		const chunk = Object.freeze({
			frameStart, frames,
			channels: Object.freeze(channels.map(channel => frames === input.chunkFrames ? channel : channel.slice(0, frames))),
		});
		discard();
		input.onChunk(chunk);
	}

	return Object.freeze({ append, flush, discard });
}
