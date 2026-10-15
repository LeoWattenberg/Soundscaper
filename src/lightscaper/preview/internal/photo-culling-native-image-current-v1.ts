/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { readImageMetadataV1 } from '../../../common/editor/imaging/image-metadata-reader-v1.ts';
import { planPixelFrameV1, readPixelFrameV1, type PixelFrameV1 } from '../../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { admitStaticImageSourceV1 } from '../../../common/editor/imaging/static-image-source-admission-v1.ts';
import { rawFlipExifOrientationV1 } from '../../../common/editor/raw/raw-source-v1.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../../../common/editor/timeline-image-native-decode-v1.ts';

export const PHOTO_CULLING_FRAME_LIMITS_CURRENT_V1 = Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 67_108_864 });
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
const CHECK = AbortSignal.prototype.throwIfAborted;
const FILL = Uint8Array.prototype.fill;
export interface PhotoCullingPhysicalPlaneCurrentV1 {
	readonly bytes: Uint8Array<ArrayBuffer>; readonly check: () => void; readonly wipe: () => void;
}

/** Exact private backing is part of the decoder boundary, including cleanup.
 * Pin platform geometry so detaching a scoped output is a retirement failure. */
export function capturePhotoCullingPlaneCurrentV1(value: unknown, maximumBytes: number): PhotoCullingPhysicalPlaneCurrentV1 {
	if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype) throw new TypeError('Camera culling requires intrinsic byte storage.');
	for (const key of ['buffer', 'byteLength', 'byteOffset', 'length']) if (Object.hasOwn(value, key)) throw new TypeError('Camera culling byte geometry must be intrinsic.');
	const buffer = Reflect.apply(BUFFER, value, []) as unknown;
	const length = Reflect.apply(LENGTH, value, []) as unknown;
	if (!(buffer instanceof ArrayBuffer) || typeof length !== 'number' || length < 1 || length > maximumBytes
		|| (RESIZABLE && Reflect.apply(RESIZABLE, buffer, []) === true)
		|| Reflect.apply(OFFSET, value, []) !== 0 || Reflect.apply(SIZE, buffer, []) !== length) throw new TypeError('Camera culling requires bounded fixed private backing.');
	const bytes = new Uint8Array(buffer);
	const check = () => {
		if (Reflect.apply(SIZE, buffer, []) !== length || Reflect.apply(LENGTH, value, []) !== length || Reflect.apply(OFFSET, value, []) !== 0) {
			throw new TypeError('Camera culling storage was detached before physical retirement.');
		}
	};
	return Object.freeze({ bytes, check, wipe: () => { check(); Reflect.apply(FILL, bytes, [0]); } });
}

export interface PhotoCullingDecodedImageCurrentV1 {
	readonly frame: PixelFrameV1;
	readonly orientation: number;
	readonly runtimeVersion: string;
}

/** Browser-native JPEG pixels already include JPEG EXIF. Map through encoded
 * coordinates to the RAW flip, so matching metadata never rotates twice. */
export async function decodePhotoCullingJpegCurrentV1(value: unknown, open: OpenFramescaperBrowserNativeImageV1,
	receiver: object, signal: AbortSignal, ownOutput: (plane: PhotoCullingPhysicalPlaneCurrentV1) => void): Promise<PhotoCullingDecodedImageCurrentV1 | null> {
	if (value === null) return null;
	const input = record(value, 'camera embedded preview', ['type', 'width', 'height', 'channels', 'bits', 'rawFlip', 'bytes']);
	const get = (name: string) => field(input, name, 'camera embedded preview');
	const width = integer(get('width'), 1, 8192), height = integer(get('height'), 1, 8192);
	const channels = integer(get('channels'), 1, 3), bits = integer(get('bits'), 8, 16);
	const orientation = rawFlipExifOrientationV1(get('rawFlip'));
	planPixelFrameV1(descriptor(width, height), PHOTO_CULLING_FRAME_LIMITS_CURRENT_V1);
	if ((channels !== 1 && channels !== 3) || (bits !== 8 && bits !== 16)) throw new RangeError('Camera preview sample declarations are unsupported.');
	const preview = capturePhotoCullingPlaneCurrentV1(get('bytes'), 16 * 1024 * 1024);
	if (get('type') === 'bitmap') {
		if (preview.bytes.length !== width * height * channels * (bits / 8)) throw new RangeError('Camera embedded bitmap geometry disagrees with its bytes.');
		// Unqualified bitmap transfer/color interpretation is explicitly refused
		// as a representation, allowing only the sequential neutral fallback.
		return null;
	}
	if (get('type') !== 'jpeg' || bits !== 8) throw new RangeError('Camera embedded preview representation is unsupported.');
	const admitted = admitStaticImageSourceV1(preview.bytes);
	if (admitted.format !== 'jpeg' || admitted.width !== width || admitted.height !== height) throw new RangeError('Camera JPEG extent disagrees with the native preview header.');
	const metadata = readImageMetadataV1(preview.bytes);
	if (metadata.issues.length) throw new RangeError('Camera JPEG metadata is malformed or ambiguous.');
	const exif = metadata.exif?.orientation ?? 1;
	const nativeWidth = exif >= 5 ? height : width, nativeHeight = exif >= 5 ? width : height;
	const outputWidth = orientation >= 5 ? height : width, outputHeight = orientation >= 5 ? width : height;
	const outputPlan = planPixelFrameV1(descriptor(outputWidth, outputHeight), PHOTO_CULLING_FRAME_LIMITS_CURRENT_V1);
	let release: (() => unknown) | undefined, session: unknown, pixels: PhotoCullingPhysicalPlaneCurrentV1 | undefined;
	let result: PhotoCullingDecodedImageCurrentV1 | undefined;
	const failures: unknown[] = [];
	try {
		Reflect.apply(CHECK, signal, []); preview.check();
		session = await Reflect.apply(open, receiver, [{ bytes: preview.bytes, format: 'jpeg', mimeType: 'image/jpeg', signal }]) as unknown;
		release = ownMethod(session, 'close');
		const ports = record(session, 'camera JPEG session', ['metadata', 'decodeFrame', 'close']);
		const decode = ownMethod(session, 'decodeFrame');
		const native = record(field(ports, 'metadata', 'camera JPEG session'), 'camera JPEG metadata', ['width', 'height', 'frameCount', 'topology', 'runtimeVersion']);
		const n = (name: string) => field(native, name, 'camera JPEG metadata');
		if (n('width') !== nativeWidth || n('height') !== nativeHeight || n('frameCount') !== 1 || n('topology') !== 'single') throw new RangeError('Camera JPEG browser orientation or static extent disagrees with its encoded header.');
		const version = n('runtimeVersion');
		if (typeof version !== 'string' || version.length < 1 || version.length > 128) throw new TypeError('Camera JPEG runtime version must be bounded text.');
		Reflect.apply(CHECK, signal, []); preview.check();
		const decoded = record(await Reflect.apply(decode, session, [0, signal]), 'camera JPEG decoded frame', ['rgba', 'durationMicroseconds']);
		pixels = capturePhotoCullingPlaneCurrentV1(field(decoded, 'rgba', 'camera JPEG decoded frame'), PHOTO_CULLING_FRAME_LIMITS_CURRENT_V1.maximumBytes);
		readPixelFrameV1({ descriptor: descriptor(nativeWidth, nativeHeight), pixels: pixels.bytes }, PHOTO_CULLING_FRAME_LIMITS_CURRENT_V1);
		Reflect.apply(CHECK, signal, []); preview.check(); pixels.check();
		const output = capturePhotoCullingPlaneCurrentV1(new Uint8Array(outputPlan.byteLength), outputPlan.byteLength); ownOutput(output);
		let visited = 0;
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const source = mappedOffset(exif, x, y, width, height), target = mappedOffset(orientation, x, y, width, height);
			const alpha = pixels.bytes[source + 3]!;
			output.bytes[target] = alpha ? pixels.bytes[source]! : 0; output.bytes[target + 1] = alpha ? pixels.bytes[source + 1]! : 0;
			output.bytes[target + 2] = alpha ? pixels.bytes[source + 2]! : 0; output.bytes[target + 3] = alpha;
			if (++visited % 65_536 === 0) {
				await new Promise<void>(done => { setTimeout(done, 0); });
				Reflect.apply(CHECK, signal, []); preview.check(); pixels.check(); output.check();
			}
		}
		result = Object.freeze({ frame: readPixelFrameV1({ descriptor: outputPlan.descriptor, pixels: output.bytes }, PHOTO_CULLING_FRAME_LIMITS_CURRENT_V1),
			orientation, runtimeVersion: `libraw-0.22.2/${version}` });
	} catch (error) { failures.push(error); }
	try { if (release) await Reflect.apply(release, session, []); } catch (error) { failures.push(error); }
	try { pixels?.wipe(); } catch (error) { failures.push(error); }
	try { preview.check(); } catch (error) { failures.push(error); }
	if (failures.length === 0) { try { Reflect.apply(CHECK, signal, []); } catch (error) { failures.push(error); } }
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Camera JPEG operation and retirement failed.', { cause: failures[0] });
	if (!result) throw new Error('Camera JPEG decoder returned no owned image.');
	return result;
}

function descriptor(width: number, height: number) {
	return { schemaVersion: 1 as const, width, height, sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const };
}
function integer(value: unknown, low: number, high: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < low || value > high) throw new RangeError('Camera preview requires bounded integer metadata.'); return value;
}
function ownMethod(value: unknown, key: string): (...args: unknown[]) => unknown {
	if (typeof value !== 'object' || value === null) throw new TypeError('Camera JPEG session requires own data capabilities.');
	const method = Object.getOwnPropertyDescriptor(value, key);
	if (!method || !Object.hasOwn(method, 'value') || typeof method.value !== 'function') throw new TypeError('Camera JPEG session requires own callable capabilities.');
	return method.value as (...args: unknown[]) => unknown;
}
function mappedOffset(orientation: number, x: number, y: number, width: number, height: number): number {
	if (orientation === 1) return (y * width + x) * 4;
	if (orientation === 2) return (y * width + width - 1 - x) * 4;
	if (orientation === 3) return ((height - 1 - y) * width + width - 1 - x) * 4;
	if (orientation === 4) return ((height - 1 - y) * width + x) * 4;
	if (orientation === 5) return (x * height + y) * 4;
	if (orientation === 6) return (x * height + height - 1 - y) * 4;
	if (orientation === 7) return ((width - 1 - x) * height + height - 1 - y) * 4;
	return ((width - 1 - x) * height + y) * 4;
}
