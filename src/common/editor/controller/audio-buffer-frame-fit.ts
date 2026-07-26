/* SPDX-License-Identifier: AGPL-3.0-only */

export interface FrameFitAudioBuffer {
	readonly length: number;
	readonly numberOfChannels: number;
	readonly sampleRate: number;
	getChannelData(channel: number): Float32Array;
}

export interface FrameFitAudioContext<Buffer extends FrameFitAudioBuffer> {
	createBuffer(numberOfChannels: number, length: number, sampleRate: number): Buffer;
}

export function fitAudioBufferToFrames<Buffer extends FrameFitAudioBuffer>(
	buffer: Buffer,
	frameCount: number,
	context: FrameFitAudioContext<Buffer>,
): Buffer {
	if (buffer.length === frameCount) return buffer;
	const output = context.createBuffer(buffer.numberOfChannels, frameCount, buffer.sampleRate);
	for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
		output.getChannelData(channel).set(buffer.getChannelData(channel).subarray(0, frameCount));
	}
	return output;
}
