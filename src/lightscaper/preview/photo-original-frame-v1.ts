/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { IMAGE_IMPORT_LIMITS } from '../../common/editor/image-import-admission.ts';
import { admitPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-admission-v1.ts';
import { readImageMetadataV1 } from '../../common/editor/imaging/image-metadata-reader-v1.ts';
import type { PixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import { openFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-browser-native-port.ts';
import type { FramescaperBrowserNativeImageDecodeSessionV1, OpenFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-native-decode-v1.ts';
import { createPhotoNativeImagePortV1 } from '../import/photo-native-image-port-v1.ts';
import { admitPhotoSourceV1 } from '../import/photo-source-admission-v1.ts';
import { normalizePhotoPreviewOriginalBindingV1, PHOTO_PREVIEW_SOURCE_LIMITS_V1 } from './photo-preview-plan-v1.ts';

export interface PhotoOriginalFrameProvenanceV1 { readonly orientation: number; readonly runtimeVersion: string }

/** Callback-scoped frame custody; no original-bearing pack, storage publication or authored metadata. */
export async function withPhotoOriginalFrameV1<Result>(value: unknown,
	consume: (frame: PixelFrameV1, provenance: Readonly<PhotoOriginalFrameProvenanceV1>) => Promise<Result>,
	dependencies: Readonly<{ openImage?: OpenFramescaperBrowserNativeImageV1 }> = {}): Promise<Result> {
	const input = record(value, 'photo original frame request', ['binding', 'body', 'signal'], ['binding', 'body']);
	const binding = normalizePhotoPreviewOriginalBindingV1(field(input, 'binding', 'photo original frame request'));
	const descriptor = admitPixelFrameV1({ schemaVersion: 1, width: binding.width, height: binding.height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, { limits: PHOTO_PREVIEW_SOURCE_LIMITS_V1 }).descriptor;
	const external = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'photo original frame request') : undefined;
	if (external !== undefined && !(external instanceof AbortSignal)) throw new TypeError('Photo regeneration requires a cancellation signal.');
	if (typeof consume !== 'function') throw new TypeError('Photo regeneration requires a frame consumer.');
	const ports = record(dependencies, 'photo original frame ports', ['openImage'], []);
	const openImage = Object.hasOwn(ports, 'openImage') ? field(ports, 'openImage', 'photo original frame ports') : openFramescaperBrowserNativeImageV1;
	if (typeof openImage !== 'function') throw new TypeError('Photo regeneration requires a native image port.');
	external?.throwIfAborted();
	const body = canonicalMediaContentBlob(field(input, 'body', 'photo original frame request'));
	if (body.size !== binding.byteLength) throw new RangeError('Retained photo Blob length disagrees with its original binding.');
	const deadline = new AbortController(), timer = setTimeout(() => { deadline.abort(new DOMException('Photo regeneration exceeded its decode deadline.', 'TimeoutError')); }, IMAGE_IMPORT_LIMITS.maximumDecodeMillisecondsPerFile);
	const signal = external ? AbortSignal.any([external, deadline.signal]) : deadline.signal;
	let bytes: Uint8Array<ArrayBuffer> | null = null, pixels: Uint8Array<ArrayBuffer> | null = null;
	let provenance: Readonly<PhotoOriginalFrameProvenanceV1>;
	let session: FramescaperBrowserNativeImageDecodeSessionV1 | null = null;
	try {
		try {
			bytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(body)); signal.throwIfAborted();
			if (bytes.length !== binding.byteLength || bytesToHex(sha256(bytes)) !== binding.contentSha256) throw new RangeError('Retained original SHA-256 or byte length disagrees with its binding.');
			const admission = admitPhotoSourceV1(bytes), orientation = readImageMetadataV1(bytes).exif?.orientation ?? 1;
			const swapped = [5, 6, 7, 8].includes(orientation);
			if (binding.width !== (swapped ? admission.height : admission.width) || binding.height !== (swapped ? admission.width : admission.height)) throw new RangeError('Retained original orientation/geometry disagrees with its binding.');
			const open = createPhotoNativeImagePortV1(admission, orientation, openImage as OpenFramescaperBrowserNativeImageV1, signal);
			session = await open({ bytes, format: admission.format, mimeType: `image/${admission.format}`, signal });
			signal.throwIfAborted();
			const decoded = await session.decodeFrame(0, signal);
			pixels = decoded.rgba as Uint8Array<ArrayBuffer>; signal.throwIfAborted();
			if (bytesToHex(sha256(bytes)) !== binding.contentSha256) throw new RangeError('Native decoder replaced the retained original SHA-256 binding.');
			provenance = Object.freeze({ orientation, runtimeVersion: session.metadata.runtimeVersion });
		} finally {
			try { session?.close(); } finally { session = null; bytes?.fill(0); bytes = null; clearTimeout(timer); }
		}
		external?.throwIfAborted();
		if (!pixels) throw new Error('Photo regeneration did not produce an owned frame.');
		const frame = Object.freeze({ descriptor: Object.freeze({ ...descriptor, sampleFormat: 'unorm8' as const }), pixels });
		const result = await consume(frame, provenance); external?.throwIfAborted(); return result;
	} finally { pixels?.fill(0); }
}
