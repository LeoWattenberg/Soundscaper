/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Wrapping encoded chunks as an elementary stream the shipped FFmpeg can remux.
 *
 * A WebCodecs encoder hands back encoded chunks with no container around them,
 * and `video-remux-ffmpeg.ts` stream-copies a container onto them. What sits
 * between is this: the byte form each codec's demuxer expects.
 *
 * H.264 needs nothing added, because an Annex B chunk already carries its own
 * start codes — which is why the capability probe asks for `annexb` rather than
 * the length-prefixed form. VP9 needs IVF, because a bare VP9 frame carries no
 * length and a demuxer cannot find the next one without being told.
 *
 * Neither container carries timing that anything downstream trusts: IVF's rate
 * fields are written honestly, but the remux states the exact rational rate on
 * the command line, because that is the one number this tier may not round.
 */

const IVF_FILE_HEADER_BYTES = 32;
const IVF_FRAME_HEADER_BYTES = 12;
/** IVF stores extents in 16 bits, which every canvas this product delivers fits. */
const IVF_MAXIMUM_EXTENT = 65_535;
const UNSIGNED_32_BIT_MAXIMUM = 4_294_967_295;

export interface VideoElementaryStreamRequest {
	readonly videoCodec: string;
	readonly width: number;
	readonly height: number;
	readonly frameRate: { readonly num: number; readonly den: number };
	/** Written into the IVF header; H.264 ignores it, having no header to write. */
	readonly frameCount: number;
}

export interface VideoElementaryStreamWriter {
	/** Bytes that precede the first frame, empty for a codec that needs none. */
	header(): Uint8Array;
	/** The bytes one encoded chunk contributes, framing included where required. */
	frame(chunk: Uint8Array, index: number): Uint8Array;
}

export function createVideoElementaryStreamWriter(
	request: VideoElementaryStreamRequest,
): VideoElementaryStreamWriter {
	const width = extent(request?.width, 'width');
	const height = extent(request?.height, 'height');
	const num = positiveInteger(request?.frameRate?.num, 'frame rate numerator');
	const den = positiveInteger(request?.frameRate?.den, 'frame rate denominator');
	const frameCount = unsigned32(request?.frameCount, 'frame count');

	if (request?.videoCodec === 'h264') {
		return Object.freeze({
			header: () => new Uint8Array(0),
			frame: (chunk: Uint8Array) => chunkBytes(chunk),
		});
	}
	if (request?.videoCodec !== 'vp9') {
		throw new RangeError(`No elementary stream form is defined for ${String(request?.videoCodec)}.`);
	}
	return Object.freeze({
		header: () => {
			const bytes = new Uint8Array(IVF_FILE_HEADER_BYTES);
			const view = new DataView(bytes.buffer);
			bytes.set(asciiBytes('DKIF'), 0);
			view.setUint16(4, 0, true);
			view.setUint16(6, IVF_FILE_HEADER_BYTES, true);
			bytes.set(asciiBytes('VP90'), 8);
			view.setUint16(12, width, true);
			view.setUint16(14, height, true);
			// IVF's rate/scale pair, written as the exact rational rather than a
			// decimal approximation of it.
			view.setUint32(16, num, true);
			view.setUint32(20, den, true);
			view.setUint32(24, frameCount, true);
			view.setUint32(28, 0, true);
			return bytes;
		},
		frame: (chunk: Uint8Array, index: number) => {
			const payload = chunkBytes(chunk);
			const position = unsigned32(index, 'frame index');
			const bytes = new Uint8Array(IVF_FRAME_HEADER_BYTES + payload.byteLength);
			const view = new DataView(bytes.buffer);
			view.setUint32(0, payload.byteLength, true);
			// Presentation counted in frames, which is what the rate/scale pair
			// above says one tick is.
			view.setBigUint64(4, BigInt(position), true);
			bytes.set(payload, IVF_FRAME_HEADER_BYTES);
			return bytes;
		},
	});
}

function chunkBytes(chunk: Uint8Array): Uint8Array {
	if (!(chunk instanceof Uint8Array)) throw new TypeError('An encoded chunk must arrive as bytes.');
	if (chunk.byteLength < 1) throw new RangeError('An encoded chunk cannot be empty.');
	return chunk;
}

function asciiBytes(text: string): Uint8Array {
	return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

function extent(value: unknown, name: string): number {
	const extentValue = positiveInteger(value, name);
	if (extentValue > IVF_MAXIMUM_EXTENT) {
		throw new RangeError(`An elementary stream ${name} must be at most ${IVF_MAXIMUM_EXTENT}.`);
	}
	return extentValue;
}

function positiveInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`An elementary stream ${name} must be a positive safe integer.`);
	}
	return value;
}

function unsigned32(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0
		|| value > UNSIGNED_32_BIT_MAXIMUM) {
		throw new RangeError(`An elementary stream ${name} must fit in 32 unsigned bits.`);
	}
	return value;
}
