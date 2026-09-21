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
	const view = new DataView(destination.buffer, destination.byteOffset, destination.byteLength);
	const frameCount = options.frameCount ?? channels[0]?.length ?? 0;
	const destinationFrameOffset = options.destinationFrameOffset ?? 0;
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
