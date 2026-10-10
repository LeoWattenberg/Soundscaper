/* SPDX-License-Identifier: AGPL-3.0-only */

/** Explicit SDR delivery: BT.709 matrix, limited-range planar 4:2:0.
 * The encoded R'G'B' transfer is preserved; alpha is discarded without matting.
 * One 8 MiB RGBA plane plus one 3 MiB I420 plane bounds owned JS pixel storage
 * at 11 MiB. Native VideoFrame/codec/muxer storage is outside this bound.
 */
import { VIDEO_CANVAS_MAXIMUM_EXTENT } from './video-canvas-fit.ts';

const MAXIMUM_RGBA_BYTES = 8 * 1024 * 1024;
const MAXIMUM_WORKING_BYTES = 11 * 1024 * 1024;
const TASK_RGBA_BYTES = 65_536;
const VIEW = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(VIEW, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(VIEW, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(VIEW, 'byteLength')!.get!;
const BUFFER_LENGTH = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const ABORT_CHECK = AbortSignal.prototype.throwIfAborted;

export function admitVideoWebCodecsI420Frame(width: number, height: number, rgbaByteLength: number): Readonly<{ byteLength: number; rgbaByteLength: number }> {
	for (const extent of [width,height]) {
		if (!Number.isSafeInteger(extent) || extent < 2 || extent > VIDEO_CANVAS_MAXIMUM_EXTENT || extent % 2 !== 0) throw new RangeError('I420 requires positive even canvas dimensions.');
	}
	const rgba = BigInt(width) * BigInt(height) * 4n;
	const plane = rgba * 3n / 8n;
	if (rgba > BigInt(MAXIMUM_RGBA_BYTES) || rgbaByteLength !== Number(rgba)
		|| rgba + plane > BigInt(MAXIMUM_WORKING_BYTES)) throw new RangeError('I420 frame length or owned pixel workspace exceeds its bound.');
	return Object.freeze({ byteLength: Number(plane), rgbaByteLength: Number(rgba) });
}

/** Write into the caller's one owned reusable plane; borrow, never mutate RGBA. */
export async function convertVideoWebCodecsRgbaToI420(rgbaValue: Uint8Array, outputValue: Uint8Array,
	width: number, height: number, signal?: AbortSignal): Promise<void> {
	const layout = admitVideoWebCodecsI420Frame(width,height,intrinsicLength(rgbaValue));
	const rgba = fixedView(rgbaValue,layout.rgbaByteLength), output = fixedView(outputValue,layout.byteLength);
	if (rgba.buffer === output.buffer) throw new RangeError('I420 output must not alias its borrowed RGBA source.');
	const sourceBuffer = rgba.buffer, outputBuffer = output.buffer;
	const check = () => {
		if (signal) Reflect.apply(ABORT_CHECK,signal,[]);
		if (Reflect.apply(BUFFER_LENGTH,sourceBuffer,[]) === 0 || Reflect.apply(BUFFER_LENGTH,outputBuffer,[]) === 0) throw new RangeError('I420 frame buffer was detached during conversion.');
	};
	const yLength = width * height, chromaLength = yLength / 4;
	let consumed = 0;
	try {
		check();
		for (let row = 0; row < height; row += 2) {
			for (let column = 0; column < width; column += 2) {
				let red = 0, green = 0, blue = 0;
				for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
					const pixel = (row + dy) * width + column + dx, offset = pixel * 4;
					const r = rgba[offset]!, g = rgba[offset+1]!, b = rgba[offset+2]!;
					red += r; green += g; blue += b;
					output[pixel] = Math.round(16 + 219 * luma(r,g,b) / 255);
				}
				red /= 4; green /= 4; blue /= 4;
				const y = luma(red,green,blue), chroma = row / 2 * (width / 2) + column / 2;
				output[yLength + chroma] = Math.round(128 + 224 * (blue-y) / (1.8556 * 255));
				output[yLength + chromaLength + chroma] = Math.round(128 + 224 * (red-y) / (1.5748 * 255));
				consumed += 16;
				if (consumed % TASK_RGBA_BYTES === 0) {
					await new Promise<void>(resolve => { setTimeout(resolve,0); });
					check();
				}
			}
		}
		check();
	} catch (error) {
		wipeVideoWebCodecsOwnedFrame(output);
		throw error;
	}
}

/** Detached owned storage has no remaining bytes; cleanup must not mask failure. */
export function wipeVideoWebCodecsOwnedFrame(value: Uint8Array | undefined): void {
	if (!value) return;
	const buffer = Reflect.apply(BUFFER,value,[]) as ArrayBuffer;
	if (Reflect.apply(BUFFER_LENGTH,buffer,[]) > 0) {
		new Uint8Array(buffer,Number(Reflect.apply(OFFSET,value,[])),Number(Reflect.apply(LENGTH,value,[]))).fill(0);
	}
}

function luma(red: number, green: number, blue: number): number {
	return (2126 * red + 7152 * green + 722 * blue) / 10_000;
}

function intrinsicLength(value: Uint8Array): number {
	if (!ArrayBuffer.isView(value) || Object.getPrototypeOf(value) !== Uint8Array.prototype) throw new TypeError('I420 requires a genuine Uint8Array.');
	return Number(Reflect.apply(LENGTH,value,[]));
}

function fixedView(value: Uint8Array, length: number): Uint8Array<ArrayBuffer> {
	if (intrinsicLength(value) !== length) throw new RangeError('I420 frame view has the wrong byte length.');
	const buffer = Reflect.apply(BUFFER,value,[]) as ArrayBuffer;
	let size: unknown;
	try { size = Reflect.apply(BUFFER_LENGTH,buffer,[]) as unknown; }
	catch { throw new TypeError('I420 requires fixed ArrayBuffer storage.'); }
	if (size === 0 || Reflect.apply(RESIZABLE,buffer,[]) !== false) throw new RangeError('I420 requires attached fixed frame storage.');
	return new Uint8Array(buffer,Number(Reflect.apply(OFFSET,value,[])),length);
}
