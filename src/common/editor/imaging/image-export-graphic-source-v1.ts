/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { IMAGE_IMPORT_LIMITS as LIMITS } from '../image-import-admission.ts';
import { canonicalMediaContentBlob } from '../storage/media-content-digest.ts';
import { openFramescaperBrowserNativeImageV1 } from '../timeline-image-browser-native-port.ts';
import type { FramescaperBrowserNativeImageDecodeSessionV1, OpenFramescaperBrowserNativeImageV1 } from '../timeline-image-native-decode-v1.ts';
import { admitStaticImageSourceV1 } from './static-image-source-admission-v1.ts';
import { createStaticImageNativePortV1 } from './static-image-native-port-v1.ts';
import { readImageMetadataV1 } from './image-metadata-reader-v1.ts';
import { readPixelFrameV1, type PixelFrameV1 } from './pixel-frame-contract-v1.ts';

export interface ImageExportGraphicProvenanceV1 { readonly orientation: number; readonly runtimeVersion: string; }
const CHECK = AbortSignal.prototype.throwIfAborted, MAXIMUM_WORKING_BYTES = 268_435_456;
const BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'buffer')!.get!;
const BYTE_LENGTH = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, FILL = Uint8Array.prototype.fill;
const PIXEL_LIMITS = Object.freeze({ maximumSidePixels: LIMITS.maximumSidePixels, maximumPixels: LIMITS.maximumSdrPixelsPerFrame,
	maximumBytes: LIMITS.maximumSdrPixelsPerFrame * 4 });

/** A selected immutable Blob/File becomes a scoped static sRGB frame without a
 * catalog, original binding, asset pack or storage publication. Native open and
 * decode settle before close; encoded transport is then wiped before consume.
 * The independent canonical pixels remain live through the joined consumer.
 * The captured working ceiling reserves encoded bytes plus both native-returned
 * and canonical JS planes; it does not promise a bound on native codec/canvas
 * memory. The existing native port normalizes hidden RGB at alpha zero. The
 * existing decode deadline ends with native custody; consumer cancellation is
 * external and joined, never a timeout race that abandons outstanding work. */
export async function withImageExportGraphicFrameV1<Result>(value: unknown,
	consume: (frame: Readonly<PixelFrameV1>, provenance: Readonly<ImageExportGraphicProvenanceV1>) => Result | Promise<Result>,
	options: Readonly<{ openImage?: OpenFramescaperBrowserNativeImageV1; maximumWorkingBytes?: number }> = {}): Promise<Result> {
	const input = record(value, 'graphic source request', ['body', 'signal'], ['body']);
	const external = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'graphic source request') as AbortSignal : undefined;
	if (external !== undefined) checkExternal(external);
	if (typeof consume !== 'function') throw new TypeError('Graphic source requires a frame consumer.');
	const ports = record(options, 'graphic source ports', ['openImage', 'maximumWorkingBytes'], []);
	const openImage = Object.hasOwn(ports, 'openImage') ? field(ports, 'openImage', 'graphic source ports') : openFramescaperBrowserNativeImageV1;
	if (typeof openImage !== 'function') throw new TypeError('Graphic source requires a native image port.');
	const maximum = Object.hasOwn(ports, 'maximumWorkingBytes') ? field(ports, 'maximumWorkingBytes', 'graphic source ports') : MAXIMUM_WORKING_BYTES;
	if (typeof maximum !== 'number' || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAXIMUM_WORKING_BYTES) throw new RangeError('Graphic working-byte ceiling is invalid.');
	const body = canonicalMediaContentBlob(field(input, 'body', 'graphic source request'));
	if (body.size < 1 || body.size > LIMITS.maximumFileInputBytes) throw new RangeError('Graphic source is empty or exceeds its byte ceiling.');
	if (body.size > maximum) throw new RangeError('Graphic source exceeds its working capacity.');
	const deadline = new AbortController(), timer = setTimeout(() => { deadline.abort(new DOMException('Graphic source exceeded its decode deadline.', 'TimeoutError')); }, LIMITS.maximumDecodeMillisecondsPerFile);
	const signal = external ? AbortSignal.any([external, deadline.signal]) : deadline.signal;
	let bytes: Uint8Array<ArrayBuffer> | null = null, pixels: Uint8Array<ArrayBuffer> | null = null;
	let session: FramescaperBrowserNativeImageDecodeSessionV1 | null = null;
	let frame: Readonly<PixelFrameV1> | null = null, provenance: Readonly<ImageExportGraphicProvenanceV1> | null = null;
	let primary: { reason: unknown } | null = null, cleanup: { reason: unknown } | null = null;
	try {
		try {
			bytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(body)); Reflect.apply(CHECK, signal, []);
			if (bytes.length !== body.size) throw new RangeError('Graphic source read length changed.');
			const admission = admitStaticImageSourceV1(bytes), metadata = readImageMetadataV1(bytes);
			if (metadata.issues.length) throw new RangeError('Graphic metadata is not admitted.');
			const orientation = metadata.exif?.orientation ?? 1, swapped = [5, 6, 7, 8].includes(orientation);
			const width = swapped ? admission.height : admission.width, height = swapped ? admission.width : admission.height;
			if (bytes.length + 2 * width * height * 4 > maximum) throw new RangeError('Graphic pixel planes exceed their working capacity.');
			const digest = bytesToHex(sha256(bytes));
			const open = createStaticImageNativePortV1(admission, orientation, openImage as OpenFramescaperBrowserNativeImageV1, signal);
			session = await open({ bytes, format: admission.format, mimeType: `image/${admission.format}`, signal });
			Reflect.apply(CHECK, signal, []);
			const decoded = await session.decodeFrame(0, signal);
			pixels = decoded.rgba as Uint8Array<ArrayBuffer>; Reflect.apply(CHECK, signal, []);
			if (bytesToHex(sha256(bytes)) !== digest) throw new RangeError('Graphic native transport digest changed.');
			frame = readPixelFrameV1({ descriptor: { schemaVersion: 1, width, height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels }, PIXEL_LIMITS);
			provenance = Object.freeze({ orientation, runtimeVersion: session.metadata.runtimeVersion });
		} catch (error) { primary = { reason: error }; }
		try { session?.close(); } catch (error) { cleanup = { reason: error }; }
		session = null; wipe(bytes); bytes = null; clearTimeout(timer);
		if (primary && cleanup) throw new AggregateError([primary.reason, cleanup.reason], 'Graphic source decode and cleanup failed.', { cause: primary.reason });
		if (primary) throw primary.reason;
		if (cleanup) throw cleanup.reason;
		if (external !== undefined) checkExternal(external);
		if (!frame || !provenance) throw new Error('Graphic source did not produce a frame.');
		const result = await consume(frame, provenance);
		if (external !== undefined) checkExternal(external);
		return result;
	} finally { clearTimeout(timer); wipe(bytes); wipe(pixels); }
}

function checkExternal(signal: AbortSignal): void {
	Reflect.apply(CHECK, signal, []);
	if (Object.getPrototypeOf(signal) !== AbortSignal.prototype
		|| ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(signal, key))) throw new TypeError('Graphic source requires an unmodified native cancellation signal.');
}
function wipe(value: Uint8Array<ArrayBuffer> | null): void {
	if (!value) return;
	const buffer = Reflect.apply(BUFFER, value, []) as ArrayBuffer;
	// A transferred backing has no attached owned bytes left to erase.
	if ((Reflect.apply(BYTE_LENGTH, buffer, []) as number) !== 0) Reflect.apply(FILL, value, [0]);
}
