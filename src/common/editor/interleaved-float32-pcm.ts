/* SPDX-License-Identifier: AGPL-3.0-only */

/** Write mapped planar WAV samples into the codec bridge's frame-major f32le carrier. */

export function writeInterleavedFloat32Pcm(
	destination: Uint8Array,
	channels: readonly Float32Array[],
	options: Readonly<{
		readonly destinationFrameOffset?: number;
		readonly frameCount?: number;
		readonly nonFinite: 'zero' | 'preserve';
	}>,
): void {
	const frameCount = options.frameCount ?? channels[0]?.length ?? 0;
	const destinationFrameOffset = options.destinationFrameOffset ?? 0;
	if (channels.length === 0) throw new RangeError('PCM interleaving requires at least one channel.');
	if (!Number.isSafeInteger(frameCount) || frameCount < 0
		|| !Number.isSafeInteger(destinationFrameOffset) || destinationFrameOffset < 0) {
		throw new RangeError('PCM frame count and destination offset must be non-negative safe integers.');
	}
	if (channels.some((channel) => !(channel instanceof Float32Array) || channel.length < frameCount)) {
		throw new RangeError('Each PCM channel must contain the requested frames.');
	}
	const bytesPerFrame = channels.length * Float32Array.BYTES_PER_ELEMENT;
	if (destinationFrameOffset > Math.floor(destination.byteLength / bytesPerFrame)
		|| frameCount > Math.floor(destination.byteLength / bytesPerFrame) - destinationFrameOffset) {
		throw new RangeError('PCM frames exceed the destination buffer.');
	}
	const view = new DataView(destination.buffer, destination.byteOffset, destination.byteLength);
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < channels.length; channel += 1) {
			const sample = channels[channel]?.[frame];
			view.setFloat32(
				((destinationFrameOffset + frame) * channels.length + channel) * Float32Array.BYTES_PER_ELEMENT,
				options.nonFinite === 'zero' && !Number.isFinite(sample) ? 0 : Number(sample),
				true,
			);
		}
	}
}
