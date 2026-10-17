/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { IMAGE_IMPORT_LIMITS } from '../../common/editor/image-import-admission.ts';
import { withDecodedImageHdrOriginalV1 } from '../../common/editor/imaging/image-hdr-original-v1.ts';
import { planPixelFrameV1, readPixelFrameV1, type PixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import type { PhotoOriginalFrameProvenanceV1 } from './photo-original-frame-v1.ts';
import { isPhotoHdrOriginalBindingCurrentV1, normalizePhotoOriginalBindingCurrentV1,
	PHOTO_HDR_ORIGINAL_SOURCE_LIMITS_CURRENT_V1, type PhotoHdrOriginalBindingCurrentV1 } from './photo-original-binding-current-v1.ts';

export interface PhotoOriginalHdrFramePortsCurrentV1 { readonly withHdrFrame?: typeof withDecodedImageHdrOriginalV1 }
const NativeBytes = Uint8Array, READ = Blob.prototype.arrayBuffer, FILL = NativeBytes.prototype.fill;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const MAXIMUM = 1024n * 1024n * 1024n, RESERVE = 32n * 1024n * 1024n;

/** Decode overlaps the immutable Blob, the reader snapshot, the codec snapshot
 * and RGBA Float32. Both encoded snapshots retire before external development. */
export function admitPhotoOriginalHdrBindingCurrentV1(value: unknown): Readonly<PhotoHdrOriginalBindingCurrentV1> {
	const binding = normalizePhotoOriginalBindingCurrentV1(value);
	if (!isPhotoHdrOriginalBindingCurrentV1(binding)) throw new TypeError('HDR decoding requires the named Current binding.');
	planPixelFrameV1({ schemaVersion: 1, width: binding.width, height: binding.height,
		sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, PHOTO_HDR_ORIGINAL_SOURCE_LIMITS_CURRENT_V1);
	// An authenticated but mismatched body can declare a larger native extent
	// than its catalog binding; its plane exists before the equality check.
	if (3n * BigInt(binding.byteLength) + BigInt(PHOTO_HDR_ORIGINAL_SOURCE_LIMITS_CURRENT_V1.maximumBytes) + RESERVE > MAXIMUM) throw new RangeError('HDR Original decode exceeds its one-GiB physical phase bound.');
	return binding;
}

/** The native HDR codec owns the Float32 plane. This owner authenticates and
 * retires encoded storage before lending that plane to the selected Session. */
export async function withPhotoOriginalHdrFrameCurrentV1<Result>(value: unknown,
	consume: (frame: PixelFrameV1, provenance: Readonly<PhotoOriginalFrameProvenanceV1>) => Promise<Result>,
	dependencies: Readonly<PhotoOriginalHdrFramePortsCurrentV1> = {}): Promise<Result> {
	const ownSignal = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (ownSignal && !Object.hasOwn(ownSignal, 'value')) throw new TypeError('HDR Original signal must be own data.');
	const external = captureRepairSignalV1(ownSignal?.value); checkRepairSignalV1(external);
	const input = record(value, 'HDR Original frame request', ['binding', 'body', 'signal'], ['binding', 'body']);
	const binding = admitPhotoOriginalHdrBindingCurrentV1(field(input, 'binding', 'HDR Original frame request'));
	if (typeof consume !== 'function') throw new TypeError('HDR Original requires a scoped consumer.');
	const ports = record(dependencies, 'HDR Original ports', ['withHdrFrame'], []);
	const decode = Object.hasOwn(ports, 'withHdrFrame') ? field(ports, 'withHdrFrame', 'HDR Original ports') : withDecodedImageHdrOriginalV1;
	if (typeof decode !== 'function') throw new TypeError('HDR Original requires an inert decoder capability.');
	const body = canonicalMediaContentBlob(field(input, 'body', 'HDR Original frame request'));
	if (body.size !== binding.byteLength) throw new RangeError('HDR Original Blob length differs from its binding.');
	const deadline = new AbortController(), signal = external ? AbortSignal.any([external, deadline.signal]) : deadline.signal;
	const timer = setTimeout(() => { deadline.abort(new DOMException('HDR Original exceeded its decode deadline.', 'TimeoutError')); }, IMAGE_IMPORT_LIMITS.maximumDecodeMillisecondsPerFile);
	let backing: ArrayBuffer | undefined, size = 0, retired = false;
	const retire = () => {
		if (!backing || retired) return;
		if (Reflect.apply(SIZE, backing, []) !== size) throw new TypeError('HDR Original encoded backing detached before retirement.');
		Reflect.apply(FILL, new NativeBytes(backing), [0]); retired = true;
	};
	let outcome: { value: Result } | { error: unknown };
	try {
		const loaded: unknown = await Reflect.apply(READ, body, []);
		// Capture physical storage before any rejection so even late cancellation
		// or malformed platform output retires the full allocated backing.
		size = Number(Reflect.apply(SIZE, loaded, [])); backing = loaded as ArrayBuffer;
		checkRepairSignalV1(signal);
		if (Reflect.apply(RESIZABLE, backing, []) || size !== binding.byteLength) throw new RangeError('HDR Original requires an exact fixed encoded backing.');
		const bytes = new NativeBytes(backing);
		if (bytesToHex(sha256(bytes)) !== binding.contentSha256) throw new RangeError('HDR Original SHA-256 differs from its retained binding.');
		outcome = { value: await (Reflect.apply(decode, dependencies, [{ bytes, signal }, async (view: unknown) => {
			checkRepairSignalV1(signal);
			const decoded = record(view, 'decoded HDR Original', ['frame', 'provenance', 'pixelsSha256', 'metadataSha256']);
			const frame = readPixelFrameV1(field(decoded, 'frame', 'decoded HDR Original'), PHOTO_HDR_ORIGINAL_SOURCE_LIMITS_CURRENT_V1);
			if (frame.descriptor.sampleFormat !== 'float32' || frame.descriptor.primaries !== 'srgb' || frame.descriptor.transfer !== 'linear'
				|| frame.descriptor.width !== binding.width || frame.descriptor.height !== binding.height) throw new RangeError('HDR Original native profile or geometry differs from its binding.');
			const pixelsBacking = Reflect.apply(BUFFER, frame.pixels, []) as ArrayBuffer;
			if (Reflect.apply(OFFSET, frame.pixels, []) !== 0 || Reflect.apply(SIZE, pixelsBacking, []) !== frame.pixels.byteLength) throw new TypeError('HDR Original requires a dedicated native plane.');
			for (let at = 3; at < frame.pixels.length; at += 4) if (frame.pixels[at] !== 1) throw new RangeError('HDR Original pixels must remain opaque.');
			if (bytesToHex(sha256(bytes)) !== binding.contentSha256) throw new RangeError('HDR decoding replaced retained encoded authority.');
			retire(); clearTimeout(timer); checkRepairSignalV1(external);
			const result = await consume(frame, Object.freeze({ orientation: 1, runtimeVersion: 'lightscaper-hdr-original-v1' }));
			checkRepairSignalV1(external); return result;
		}]) as Promise<Result>) };
		checkRepairSignalV1(external);
	} catch (error) { outcome = { error }; }
	clearTimeout(timer);
	const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
	try { retire(); } catch (error) { if (!failures.some(value => Object.is(value, error))) failures.push(error); }
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'HDR Original operation and encoded retirement failed.', { cause: failures[0] });
	if ('value' in outcome) return outcome.value;
	throw new Error('HDR Original has no operation outcome.');
}
