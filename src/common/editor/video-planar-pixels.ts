/* SPDX-License-Identifier: AGPL-3.0-only */
import { decodeMotionChannel, encodeMotionChannel } from './motion-surface.ts';

/** The actual bytes produced by a compositor, before opaque video encoding. */
export interface VideoRgbaOutput {
	readonly encoding: 'srgb' | 'rec709';
	readonly alphaMode: 'straight';
	readonly precision: 'unorm8';
}
const LEGACY_RGBA_OUTPUT: VideoRgbaOutput = Object.freeze({ encoding: 'srgb', alphaMode: 'straight', precision: 'unorm8' });
export const VIDEO_I420_COLOR_SPACE = Object.freeze({ primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false });

/** Snapshot a closed, data-only contract. Legacy canvas RGBA is explicitly sRGB. */
export function normalizeVideoRgbaOutput(value: unknown): VideoRgbaOutput {
	if (value === undefined) return LEGACY_RGBA_OUTPUT;
	if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)
		|| Reflect.ownKeys(value).length !== 3) throw new TypeError('Invalid video RGBA output contract.');
	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const key of ['encoding', 'alphaMode', 'precision']) if (!descriptors[key] || !Object.hasOwn(descriptors[key], 'value')) throw new TypeError('Video RGBA output requires own data fields.');
	const encoding: unknown = descriptors.encoding!.value;
	if ((encoding !== 'srgb' && encoding !== 'rec709') || descriptors.alphaMode!.value !== 'straight' || descriptors.precision!.value !== 'unorm8') throw new TypeError('Unsupported video RGBA output contract.');
	return Object.freeze({ encoding, alphaMode: 'straight', precision: 'unorm8' });
}

export function videoI420ByteLength(width: number, height: number): number {
	const length = width * height + 2 * Math.ceil(width / 2) * Math.ceil(height / 2);
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
		|| !Number.isSafeInteger(width * height * 4) || !Number.isSafeInteger(length)) throw new RangeError('Invalid video planar dimensions.');
	return length;
}

/** One shared BT.709 limited matrix and encoded-coordinate 2x2 box chroma kernel.
 * The reader supplies three normalized Rec.709-encoded channels in scratch RGB.
 * No Motion surface or product-specific canvas ceiling is imposed here.
 */
export function videoI420Pixels(width: number, height: number, readRgb: (pixel: number, rgb: Float64Array) => void,
	target = new Uint8Array(videoI420ByteLength(width, height))): Uint8Array<ArrayBuffer> {
	if (target.byteLength !== videoI420ByteLength(width, height)) throw new RangeError('Video planar target length differs from its canvas.');
	const chromaWidth = Math.ceil(width / 2), uOffset = width * height, vOffset = uOffset + chromaWidth * Math.ceil(height / 2);
	const rgb = new Float64Array(3);
	for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
		let u = 0, v = 0, count = 0;
		for (let dy = 0; dy < 2 && y + dy < height; dy++) for (let dx = 0; dx < 2 && x + dx < width; dx++) {
			const at = (y + dy) * width + x + dx; readRgb(at, rgb);
			const r = rgb[0]!, g = rgb[1]!, b = rgb[2]!;
			const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
			target[at] = code(16 + 219 * luma, 16, 235);
			u += (b - luma) / 1.8556; v += (r - luma) / 1.5748; count++;
		}
		const chroma = (y / 2) * chromaWidth + x / 2;
		target[uOffset + chroma] = code(128 + 224 * u / count, 16, 240);
		target[vOffset + chroma] = code(128 + 224 * v / count, 16, 240);
	}
	return target;
}

/** Compositors already paint the authored background. Remaining transparency is
 * flattened over black in linear light for opaque H.264/VP9, exactly once.
 * Reuse one I420 allocation alongside the existing RGBA frame; no float frame.
 */
export function videoRgbaI420Pixels(rgba: Uint8Array, width: number, height: number, output: VideoRgbaOutput,
	target?: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
	const contract = normalizeVideoRgbaOutput(output);
	videoI420ByteLength(width, height);
	if (!(rgba instanceof Uint8Array) || rgba.byteLength !== width * height * 4) throw new RangeError('Video RGBA bytes differ from their canvas.');
	return videoI420Pixels(width, height, (pixel, rgb) => {
		const at = pixel * 4, alpha = rgba[at + 3]! / 255;
		for (let c = 0; c < 3; c++) rgb[c] = alpha === 0 ? 0 : contract.encoding === 'rec709' && alpha === 1 ? rgba[at + c]! / 255
			: encodeMotionChannel(decodeMotionChannel(rgba[at + c]! / 255, contract.encoding) * alpha, 'rec709');
	}, target);
}
function code(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, Math.round(value))); }
