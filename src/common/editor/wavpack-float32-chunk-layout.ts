/* SPDX-License-Identifier: AGPL-3.0-only */

const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;

/** Copy a frame range from interleaved f32le PCM into WavPack's planar ABI layout. */
export function planarFloat32Chunk(
	input: Uint8Array,
	frameOffset: number,
	frameCount: number,
	channelCount: number,
): Uint8Array<ArrayBuffer> {
	const geometry = chunkGeometry(frameOffset, frameCount, channelCount);
	if (!geometry || input.byteLength % geometry.frameBytes !== 0
		|| geometry.endFrame > input.byteLength / geometry.frameBytes) {
		throw new RangeError('Invalid interleaved Float32 PCM geometry.');
	}
	const output = new Uint8Array(geometry.chunkBytes);
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
	const geometry = chunkGeometry(frameOffset, frameCount, channelCount);
	if (!geometry || input.byteLength !== geometry.chunkBytes
		|| output.byteLength % geometry.frameBytes !== 0
		|| geometry.endFrame > output.byteLength / geometry.frameBytes) {
		throw invalidGeometryError();
	}
	const stableInput = byteRangesOverlap(input, output) ? Uint8Array.from(input) : input;
	const source = new DataView(stableInput.buffer, stableInput.byteOffset, stableInput.byteLength);
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

interface Float32ChunkGeometry {
	readonly chunkBytes: number;
	readonly endFrame: number;
	readonly frameBytes: number;
}

function chunkGeometry(
	frameOffset: number,
	frameCount: number,
	channelCount: number,
): Float32ChunkGeometry | null {
	if (!Number.isSafeInteger(frameOffset) || frameOffset < 0 || Object.is(frameOffset, -0)
		|| !Number.isSafeInteger(frameCount) || frameCount < 0 || Object.is(frameCount, -0)
		|| !Number.isSafeInteger(channelCount) || channelCount < 1 || Object.is(channelCount, -0)) return null;
	const endFrame = frameOffset + frameCount;
	const frameBytes = channelCount * FLOAT32_BYTES;
	const chunkBytes = frameCount * frameBytes;
	if (!Number.isSafeInteger(endFrame)
		|| !Number.isSafeInteger(frameBytes)
		|| !Number.isSafeInteger(chunkBytes)) return null;
	return { chunkBytes, endFrame, frameBytes };
}

function byteRangesOverlap(first: Uint8Array, second: Uint8Array): boolean {
	return first.buffer === second.buffer
		&& first.byteOffset < second.byteOffset + second.byteLength
		&& second.byteOffset < first.byteOffset + first.byteLength;
}
