/* SPDX-License-Identifier: AGPL-3.0-only */

/** Write mapped planar WAV samples into the codec bridge's frame-major f32le carrier. */

const LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;

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
	if (options.nonFinite !== 'zero' && options.nonFinite !== 'preserve') {
		throw new RangeError('PCM nonfinite sample handling must be zero or preserve.');
	}
	if (!Number.isSafeInteger(frameCount) || frameCount < 0
		|| !Number.isSafeInteger(destinationFrameOffset) || destinationFrameOffset < 0) {
		throw new RangeError('PCM frame count and destination offset must be non-negative safe integers.');
	}
	if (channels.some((channel) => !(channel instanceof Float32Array) || channel.length < frameCount)) {
		throw new RangeError('Each PCM channel must contain the requested frames.');
	}
	const channelCount = channels.length;
	const bytesPerFrame = channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (destinationFrameOffset > Math.floor(destination.byteLength / bytesPerFrame)
		|| frameCount > Math.floor(destination.byteLength / bytesPerFrame) - destinationFrameOffset) {
		throw new RangeError('PCM frames exceed the destination buffer.');
	}
	if (LITTLE_ENDIAN && destination.byteOffset % Float32Array.BYTES_PER_ELEMENT === 0) {
		const samples = new Float32Array(destination.buffer, destination.byteOffset,
			Math.floor(destination.byteLength / Float32Array.BYTES_PER_ELEMENT));
		let offset = destinationFrameOffset * channelCount;
		if (options.nonFinite === 'preserve') {
			for (let frame = 0; frame < frameCount; frame += 1) {
				for (let channel = 0; channel < channelCount; channel += 1) {
					samples[offset++] = channels[channel]![frame]!;
				}
			}
		} else {
			for (let frame = 0; frame < frameCount; frame += 1) {
				for (let channel = 0; channel < channelCount; channel += 1) {
					const sample = channels[channel]![frame]!;
					samples[offset++] = Number.isFinite(sample) ? sample : 0;
				}
			}
		}
		return;
	}
	const view = new DataView(destination.buffer, destination.byteOffset, destination.byteLength);
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			const sample = channels[channel]![frame]!;
			view.setFloat32(
				((destinationFrameOffset + frame) * channelCount + channel) * Float32Array.BYTES_PER_ELEMENT,
				options.nonFinite === 'zero' && !Number.isFinite(sample) ? 0 : sample,
				true,
			);
		}
	}
}
