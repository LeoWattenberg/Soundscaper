/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { IMAGE_IMPORT_LIMITS } from '../../common/editor/image-import-admission.ts';
import type { PixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { withRawEmbeddedPreviewV1 } from '../../common/editor/raw/libraw-runtime-v1.ts';
import { probeRawSourceV1 } from '../../common/editor/raw/raw-source-v1.ts';
import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import { openFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-browser-native-port.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-native-decode-v1.ts';
import { admitPhotoOriginalFrameBindingCurrentV1, withPhotoPreviewOriginalFrameCurrentV1 } from './photo-original-frame-current-v1.ts';
import { normalizePhotoPreviewOriginalBindingV1 } from './photo-preview-plan-v1.ts';
import { capturePhotoCullingPlaneCurrentV1, decodePhotoCullingJpegCurrentV1,
	type PhotoCullingPhysicalPlaneCurrentV1 } from './internal/photo-culling-native-image-current-v1.ts';

export interface PhotoCullingFrameProvenanceCurrentV1 {
	readonly orientation: number;
	readonly runtimeVersion: string;
	readonly representation: 'camera-embedded' | 'neutral-original';
}
export interface PhotoCullingFramePortsCurrentV1 {
	readonly withRawPreview?: typeof withRawEmbeddedPreviewV1;
	readonly openImage?: OpenFramescaperBrowserNativeImageV1;
	readonly withOriginalFrame?: typeof withPhotoPreviewOriginalFrameCurrentV1;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
const BODY_BYTES = Blob.prototype.arrayBuffer;
const MAXIMUM_CAMERA_WORKING_BYTES = 1024n * 1024n * 1024n;
const MIB = 1024n * 1024n;

/** Opt-in camera presentation only. Original/Develop/export never consume this
 * representation. The producer reports the actual oriented camera extent,
 * which need not match the authenticated Original's active sensor extent. */
export async function withPhotoCullingFrameCurrentV1<Result>(value: unknown,
	consume: (frame: PixelFrameV1, provenance: Readonly<PhotoCullingFrameProvenanceCurrentV1>) => Promise<Result>,
	dependencies: Readonly<PhotoCullingFramePortsCurrentV1> = {}): Promise<Result> {
	const input = record(value, 'Current camera culling request', ['binding', 'body', 'source', 'signal'], ['binding', 'body', 'source']);
	if (field(input, 'source', 'Current camera culling request') !== 'camera-embedded') throw new RangeError('Camera culling source must be camera-embedded.');
	const caller = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'Current camera culling request') as AbortSignal | undefined : undefined;
	check(caller);
	if (typeof consume !== 'function') throw new TypeError('Camera culling requires a scoped frame consumer.');
	const binding = normalizePhotoPreviewOriginalBindingV1(field(input, 'binding', 'Current camera culling request'));
	admitPhotoOriginalFrameBindingCurrentV1(binding);
	// Phasewise conservative charge includes the borrowed Original Blob and two
	// private Original copies, maximum
	// pinned native heap and embedded payload, two maximum JPEG RGBA planes,
	// and a fixed browser/metadata reserve. It makes no exact JS heap claim.
	if (3n * BigInt(binding.byteLength) + (512n + 16n + 128n + 32n) * MIB > MAXIMUM_CAMERA_WORKING_BYTES) {
		throw new RangeError('Camera culling exceeds its 1 GiB decode working limit.');
	}
	const ports = record(dependencies, 'Current camera culling ports', ['withRawPreview', 'openImage', 'withOriginalFrame'], []);
	const preview = Object.hasOwn(ports, 'withRawPreview') ? field(ports, 'withRawPreview', 'Current camera culling ports') : withRawEmbeddedPreviewV1;
	const open = Object.hasOwn(ports, 'openImage') ? field(ports, 'openImage', 'Current camera culling ports') : openFramescaperBrowserNativeImageV1;
	const original = Object.hasOwn(ports, 'withOriginalFrame') ? field(ports, 'withOriginalFrame', 'Current camera culling ports') : withPhotoPreviewOriginalFrameCurrentV1;
	if (typeof preview !== 'function' || typeof open !== 'function' || typeof original !== 'function') throw new TypeError('Camera culling requires own callable native capabilities.');
	const rawPreview = preview as typeof withRawEmbeddedPreviewV1, openImage = open as OpenFramescaperBrowserNativeImageV1;
	const originalFrame = original as typeof withPhotoPreviewOriginalFrameCurrentV1;
	const body = canonicalMediaContentBlob(field(input, 'body', 'Current camera culling request'));
	if (body.size !== binding.byteLength) throw new RangeError('Camera culling Original Blob length disagrees with its binding.');
	const deadline = new AbortController(), timer = setTimeout(() => {
		deadline.abort(new DOMException('Camera culling exceeded its decode deadline.', 'TimeoutError'));
	}, IMAGE_IMPORT_LIMITS.maximumDecodeMillisecondsPerFile);
	const signal = caller ? AbortSignal.any([caller, deadline.signal]) : deadline.signal;
	let bytes: PhotoCullingPhysicalPlaneCurrentV1 | undefined, output: PhotoCullingPhysicalPlaneCurrentV1 | undefined;
	let outcome: { value: Result } | { error: unknown };
	try {
		bytes = capturePhotoCullingPlaneCurrentV1(new Uint8Array(await Reflect.apply(BODY_BYTES, body, []) as ArrayBuffer), binding.byteLength);
		const authenticate = () => {
			check(signal); bytes!.check();
			if (bytes!.bytes.length !== binding.byteLength || bytesToHex(sha256(bytes!.bytes)) !== binding.contentSha256) throw new RangeError('Camera culling Original SHA-256 disagrees with its retained binding.');
		};
		authenticate();
		let camera: Awaited<ReturnType<typeof decodePhotoCullingJpegCurrentV1>> = null;
		if (probeRawSourceV1(bytes.bytes)) {
			camera = await Reflect.apply(rawPreview, dependencies, [{ bytes: bytes.bytes, signal }, (embedded: unknown) =>
				decodePhotoCullingJpegCurrentV1(embedded, openImage, dependencies, signal, owned => { output = owned; })]) as Awaited<ReturnType<typeof decodePhotoCullingJpegCurrentV1>>;
			authenticate();
		}
		// This await has joined the native worker, JPEG decoder and embedded
		// payload before either consumer or the full Original fallback begins.
		bytes.wipe(); bytes = undefined;
		if (camera) {
			clearTimeout(timer); check(caller); output!.check();
			const provenance = Object.freeze({ orientation: camera.orientation, runtimeVersion: camera.runtimeVersion, representation: 'camera-embedded' as const });
			outcome = { value: await consume(camera.frame, provenance) }; check(caller);
		} else {
			const fallbackRequest = { binding, body, signal };
			outcome = { value: await (Reflect.apply(originalFrame, dependencies, [fallbackRequest, async (frame: PixelFrameV1, provenance: Readonly<{ orientation: number; runtimeVersion: string }>) => {
				clearTimeout(timer); check(caller);
				return consume(frame, Object.freeze({ ...provenance, representation: 'neutral-original' as const }));
			}]) as Promise<Result>) }; check(caller);
		}
	} catch (error) { outcome = { error }; }
	clearTimeout(timer);
	const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
	try { bytes?.wipe(); } catch (error) { failures.push(error); }
	try { output?.wipe(); } catch (error) { failures.push(error); }
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Camera culling operation and physical retirement failed.', { cause: failures[0] });
	if ('value' in outcome) return outcome.value;
	throw new Error('Camera culling returned no operation outcome.');
}

function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
