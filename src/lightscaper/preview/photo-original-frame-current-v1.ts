/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { IMAGE_IMPORT_LIMITS } from '../../common/editor/image-import-admission.ts';
import { planPixelFrameV1, readPixelFrameV1, type PixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import { withDecodedRawOriginalV1 } from '../../common/editor/raw/libraw-runtime-v1.ts';
import { probeRawSourceV1, rawFlipExifOrientationV1 } from '../../common/editor/raw/raw-source-v1.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-native-decode-v1.ts';
import { normalizePhotoPreviewOriginalBindingV1, type PhotoPreviewOriginalBindingV1 } from './photo-preview-plan-v1.ts';
import { withPhotoOriginalFrameV1, type PhotoOriginalFrameProvenanceV1 } from './photo-original-frame-v1.ts';

export const PHOTO_ORIGINAL_CURRENT_SOURCE_LIMITS_V1 = Object.freeze({ maximumSidePixels: 8192,
	maximumPixels: 16_777_216, maximumBytes: 134_217_728 });
export interface PhotoOriginalFramePortsCurrentV1 {
	readonly openImage?: OpenFramescaperBrowserNativeImageV1;
	readonly withRawFrame?: typeof withDecodedRawOriginalV1;
}
const CHECK = AbortSignal.prototype.throwIfAborted, FILL = Uint8Array.prototype.fill;
function check(signal?: AbortSignal): void { if (signal) Reflect.apply(CHECK, signal, []); }

/** Conservative Current source preflight before loading any retained body. */
export function admitPhotoOriginalFrameBindingCurrentV1(binding: Readonly<PhotoPreviewOriginalBindingV1>): void {
	planPixelFrameV1({ schemaVersion: 1, width: binding.width, height: binding.height,
		sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' }, PHOTO_ORIGINAL_CURRENT_SOURCE_LIMITS_V1);
}

/** Actual RAW pixels remain words through this scoped Original borrower. Static
 * raster sources retain the permanent browser-native V1 reader unchanged. */
export async function withPhotoOriginalFrameCurrentV1<Result>(value: unknown,
	consume: (frame: PixelFrameV1, provenance: Readonly<PhotoOriginalFrameProvenanceV1>) => Promise<Result>,
	dependencies: Readonly<PhotoOriginalFramePortsCurrentV1> = {}): Promise<Result> {
	const input = record(value, 'Current photo original frame request', ['binding', 'body', 'signal'], ['binding', 'body']);
	const binding = normalizePhotoPreviewOriginalBindingV1(field(input, 'binding', 'Current photo original frame request'));
	admitPhotoOriginalFrameBindingCurrentV1(binding);
	const external = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'Current photo original frame request') : undefined;
	if (external !== undefined) Reflect.apply(CHECK, external, []);
	const callerSignal = external as AbortSignal | undefined;
	if (typeof consume !== 'function') throw new TypeError('Current Original requires a scoped consumer.');
	const ports = record(dependencies, 'Current Original ports', ['openImage', 'withRawFrame'], []);
	const raw = Object.hasOwn(ports, 'withRawFrame') ? field(ports, 'withRawFrame', 'Current Original ports') : withDecodedRawOriginalV1;
	const open = Object.hasOwn(ports, 'openImage') ? field(ports, 'openImage', 'Current Original ports') : undefined;
	if (typeof raw !== 'function' || (Object.hasOwn(ports, 'openImage') && typeof open !== 'function')) throw new TypeError('Current Original requires inert native decoder capabilities.');
	const openImage = open as OpenFramescaperBrowserNativeImageV1 | undefined;
	const body = canonicalMediaContentBlob(field(input, 'body', 'Current photo original frame request'));
	if (body.size !== binding.byteLength) throw new RangeError('Retained photo Blob length disagrees with its original binding.');
	const deadline = new AbortController(), timer = setTimeout(() => {
		deadline.abort(new DOMException('Photo regeneration exceeded its decode deadline.', 'TimeoutError'));
	}, IMAGE_IMPORT_LIMITS.maximumDecodeMillisecondsPerFile);
	const signal = callerSignal ? AbortSignal.any([callerSignal, deadline.signal]) : deadline.signal;
	let bytes: Uint8Array<ArrayBuffer> | undefined;
	try {
		bytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(body)); check(signal);
		const currentBytes = bytes;
		const authenticate = () => {
			check(signal);
			if (currentBytes.byteLength !== binding.byteLength || bytesToHex(sha256(currentBytes)) !== binding.contentSha256) {
				throw new RangeError('Retained original SHA-256 or byte length disagrees with its binding.');
			}
		};
		authenticate();
		if (!probeRawSourceV1(currentBytes)) {
			Reflect.apply(FILL, currentBytes, [0]); bytes = undefined; clearTimeout(timer);
			return withPhotoOriginalFrameV1({ binding, body, ...(callerSignal ? { signal: callerSignal } : {}) }, consume,
				openImage ? { openImage: request => Reflect.apply(openImage, dependencies, [request]) as ReturnType<OpenFramescaperBrowserNativeImageV1> } : {});
		}
		return await (Reflect.apply(raw, dependencies, [{ bytes: currentBytes, signal }, async (value: unknown) => {
			const original = record(value, 'native RAW Original', ['frame', 'rawFlip']);
			const frame = readPixelFrameV1(field(original, 'frame', 'native RAW Original'), PHOTO_ORIGINAL_CURRENT_SOURCE_LIMITS_V1);
			if (frame.descriptor.sampleFormat !== 'unorm16' || frame.descriptor.primaries !== 'srgb' || frame.descriptor.transfer !== 'linear') {
				throw new TypeError('Current RAW Original requires native linear sRGB RGBA16.');
			}
			const orientation = rawFlipExifOrientationV1(field(original, 'rawFlip', 'native RAW Original'));
			if (frame.descriptor.width !== binding.width || frame.descriptor.height !== binding.height) throw new RangeError('Retained RAW Original orientation/geometry disagrees with its binding.');
			authenticate(); clearTimeout(timer);
			const result = await consume(frame, Object.freeze({ orientation, runtimeVersion: 'libraw-0.22.2' }));
			check(callerSignal); authenticate(); return result;
		}]) as Promise<Result>);
	} finally { clearTimeout(timer); if (bytes) Reflect.apply(FILL, bytes, [0]); }
}

/** Disposable cache preparation receives encoded display pixels, never feeds
 * them back into Original development. Full geometry preserves its V1 plan. */
export async function withPhotoPreviewOriginalFrameCurrentV1<Result>(value: unknown,
	consume: (frame: PixelFrameV1, provenance: Readonly<PhotoOriginalFrameProvenanceV1>) => Promise<Result>,
	dependencies: Readonly<PhotoOriginalFramePortsCurrentV1> = {}): Promise<Result> {
	if (typeof consume !== 'function') throw new TypeError('Current preview requires a scoped consumer.');
	const input = record(value, 'Current preview source', ['binding', 'body', 'signal'], ['binding', 'body']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'Current preview source') as AbortSignal : undefined;
	return withPhotoOriginalFrameCurrentV1(value, async (frame, provenance) => {
		if (frame.descriptor.sampleFormat === 'unorm8') return consume(frame, provenance);
		const { withLinearPixelFrameDisplayV1 } = await import('../../common/editor/imaging/pixel-frame-linear-display-v1.ts');
		return withLinearPixelFrameDisplayV1({ frame, ...(signal ? { signal } : {}) }, display => consume(display, provenance), 'full');
	}, dependencies);
}
