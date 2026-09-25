/* SPDX-License-Identifier: AGPL-3.0-only */

/** Stage capture-rate PCM so expensive export conversion runs after realtime playback. */
export function encodeRealtimePcmSpoolChunk(channels: readonly Float32Array[]): Uint8Array {
	if (!Array.isArray(channels) || channels.length < 1 || channels.length > 32) {
		throw new RangeError('Realtime PCM spool needs 1 to 32 channels.');
	}
	const frames = channels[0]?.length ?? 0;
	if (frames < 1 || frames > 16_384 || channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== frames)) {
		throw new RangeError('Realtime PCM spool channels must have equal, nonempty frame counts.');
	}
	const interleaved = new Float32Array(frames * channels.length);
	for (let frame = 0; frame < frames; frame += 1) {
		for (let channel = 0; channel < channels.length; channel += 1) {
			interleaved[frame * channels.length + channel] = channels[channel]![frame]!;
		}
	}
	return new Uint8Array(interleaved.buffer);
}

export async function* readRealtimePcmSpool(
	blob: Blob,
	channelCount: number,
	chunkFrames: readonly number[],
): AsyncGenerator<readonly Float32Array[]> {
	if (!Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 32
		|| !Array.isArray(chunkFrames)
		|| chunkFrames.some((frames) => !Number.isSafeInteger(frames) || frames < 1 || frames > 16_384)) {
		throw new RangeError('Realtime PCM spool read geometry is invalid.');
	}
	const frameBytes = channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (blob.size !== chunkFrames.reduce((sum, frames) => sum + frames * frameBytes, 0)) {
		throw new RangeError('Realtime PCM spool must contain whole frames matching its captured chunks.');
	}
	let offset = 0;
	for (const framesInChunk of chunkFrames) {
		const chunkBytes = framesInChunk * frameBytes;
		const bytes = await blob.slice(offset, offset + chunkBytes).arrayBuffer();
		offset += chunkBytes;
		const interleaved = new Float32Array(bytes);
		const frames = interleaved.length / channelCount;
		const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
		for (let frame = 0; frame < frames; frame += 1) {
			for (let channel = 0; channel < channelCount; channel += 1) {
				channels[channel]![frame] = interleaved[frame * channelCount + channel]!;
			}
		}
		yield channels;
	}
}
