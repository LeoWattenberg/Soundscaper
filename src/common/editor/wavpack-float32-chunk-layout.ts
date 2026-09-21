/* SPDX-License-Identifier: AGPL-3.0-only */

const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;

/** Copy a frame range from interleaved f32le PCM into WavPack's planar ABI layout. */
export function planarFloat32Chunk(
	input: Uint8Array,
	frameOffset: number,
	frameCount: number,
	channelCount: number,
): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(frameCount * channelCount * FLOAT32_BYTES);
	const source = new DataView(input.buffer, input.byteOffset, input.byteLength);
	const target = new DataView(output.buffer);
	for (let channel = 0; channel < channelCount; channel += 1) {
		for (let frame = 0; frame < frameCount; frame += 1) {
			target.setUint32(
				(channel * frameCount + frame) * FLOAT32_BYTES,
				source.getUint32(
					((frameOffset + frame) * channelCount + channel) * FLOAT32_BYTES,
					true,
				),
				true,
			);
		}
	}
	return output;
}

/** Copy WavPack planar f32le PCM into a frame range of an interleaved destination. */
export function interleavePlanarFloat32Chunk(
	input: Uint8Array,
	output: Uint8Array,
	frameOffset: number,
	frameCount: number,
	channelCount: number,
	invalidGeometryError: () => Error,
): void {
	if (input.byteLength !== frameCount * channelCount * FLOAT32_BYTES) {
		throw invalidGeometryError();
	}
	const source = new DataView(input.buffer, input.byteOffset, input.byteLength);
	const target = new DataView(output.buffer, output.byteOffset, output.byteLength);
	for (let channel = 0; channel < channelCount; channel += 1) {
		for (let frame = 0; frame < frameCount; frame += 1) {
			target.setUint32(
				((frameOffset + frame) * channelCount + channel) * FLOAT32_BYTES,
				source.getUint32(
					(channel * frameCount + frame) * FLOAT32_BYTES,
					true,
				),
				true,
			);
		}
	}
}
