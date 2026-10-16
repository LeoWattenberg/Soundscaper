/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImageHandoffViewV1 } from '../../../common/editor/photo-library-image-handoff-port-v1.ts';
import { decodeFramescaperBrowserNativeImageV1, type OpenFramescaperBrowserNativeImageV1 } from '../../../common/editor/timeline-image-native-decode-v1.ts';
import { openFramescaperBrowserNativeImageV1 } from '../../../common/editor/timeline-image-browser-native-port.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { readImageMetadataV1 } from '../../../common/editor/imaging/image-metadata-reader-v1.ts';
import { canonicalMediaContentBlob } from '../../../common/editor/storage/media-content-digest.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { IMAGE_IMPORT_LIMITS } from '../../../common/editor/image-import-admission.ts';
import { admitPhotoSourceV1 } from '../../import/photo-source-admission-v1.ts';
import { createPhotoNativeImagePortV1 } from '../../import/photo-native-image-port-v1.ts';
import { parsePhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../../catalog/photo-export-sidecar-v1.ts';
import { id, integer } from '../../catalog/value-validation.ts';
import { PhotoLibrarySessionLifetime } from '../photo-library-session-lifetime.ts';
import { createPhotoImageHandoffSourceForProfileV1, assertHandoffProfile, type HandoffProfile, type PhotoImageHandoffSourceForProfileV1 } from './photo-image-handoff-model-kernel-v1.ts';
import { parsePhotoExportSidecarCurrentV1, serializePhotoExportSidecarCurrentV1 } from '../../catalog/photo-export-sidecar-current-v1.ts';
import { probeRawSourceV1 } from '../../../common/editor/raw/raw-source-v1.ts';
import { admitPhotoHdrHandoffWorkCurrentV1, isPhotoHdrHandoffOriginalCurrentV1 } from './photo-hdr-handoff-policy-current-v1.ts';

const READ = Blob.prototype.arrayBuffer;
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const CHECK = AbortSignal.prototype.throwIfAborted;
const ANY = AbortSignal.any;
const LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!;
const FILL = Uint8Array.prototype.fill;

/** The selected Session retains the full original/resource/facts fence around
 * this decode. No storage, destination, LUT-body or project authority is used. */
export async function decodePhotoImageHandoffSourceForProfileV1(profile: HandoffProfile,
	capture: Pick<PhotoLibraryImageHandoffViewV1, 'factsJson' | 'original' | 'originalBlob' | 'signal'>,
	sourceIdValue: string, dependencies: Readonly<{ openImage?: OpenFramescaperBrowserNativeImageV1 }> = {},
): Promise<Readonly<PhotoImageHandoffSourceForProfileV1>> {
	assertHandoffProfile(profile); const label = 'Selected photo image decode', input = record(capture, label, ['factsJson', 'original', 'originalBlob', 'signal']);
	const sourceId = id(sourceIdValue, 'handoff image source ID'), rawSignal = field(input, 'signal', label);
	if (!(rawSignal instanceof AbortSignal)) throw new TypeError('Photo image decode requires its native lifetime signal.');
	Reflect.apply(CHECK, rawSignal, []);
	const factsJson = field(input, 'factsJson', label);
	if (typeof factsJson !== 'string') throw new TypeError('Photo image decode requires canonical saved facts JSON.');
	const facts = profile === 'legacy2' ? parsePhotoExportSidecarV1(factsJson) : parsePhotoExportSidecarCurrentV1(factsJson);
	if ((profile === 'legacy2' ? serializePhotoExportSidecarV1(facts) : serializePhotoExportSidecarCurrentV1(facts)) !== factsJson || facts.binding.activeVersionId !== facts.version.id) throw new Error('Photo image decode saved facts or active version changed.');
	const originalValue = record(field(input, 'original', label), 'Photo image original', ['exactName', 'contentSha256', 'byteLength', 'mimeType', 'width', 'height', 'hasAlpha']);
	const originalField = (key: string) => field(originalValue, key, 'Photo image original');
	if (originalField('exactName') !== facts.original.fileName || originalField('contentSha256') !== facts.original.contentSha256
		|| originalField('byteLength') !== facts.original.byteLength) throw new Error('Photo image decode original identity binding changed.');
	const original = Object.freeze({ mimeType: originalField('mimeType'), width: integer(originalField('width'), 1, 8192, 'handoff original width'),
		height: integer(originalField('height'), 1, 8192, 'handoff original height'), hasAlpha: originalField('hasAlpha') });
	if (typeof original.mimeType !== 'string' || typeof original.hasAlpha !== 'boolean') throw new TypeError('Photo image decode requires original MIME/alpha facts.');
	const hdr = profile === 'current3' && isPhotoHdrHandoffOriginalCurrentV1(original);
	if (hdr) admitPhotoHdrHandoffWorkCurrentV1(facts.version.develop, original.width, original.height, facts.original.byteLength);
	else if (facts.original.byteLength > IMAGE_IMPORT_LIMITS.maximumFileInputBytes) throw new RangeError('Photo image decode original exceeds its fixed byte capacity.');
	const body = canonicalMediaContentBlob(field(input, 'originalBlob', label));
	if (Reflect.apply(SIZE, body, []) !== facts.original.byteLength) throw new Error('Photo image decode original Blob size changed.');
	const ports = record(dependencies, 'Photo image decode dependencies', ['openImage'], []);
	const method = Object.hasOwn(ports, 'openImage') ? field(ports, 'openImage', 'Photo image decode dependencies') : openFramescaperBrowserNativeImageV1;
	if (typeof method !== 'function') throw new TypeError('Photo image decode requires its native image port.');
	const openImage = Reflect.apply(Function.prototype.bind, method, [dependencies]) as OpenFramescaperBrowserNativeImageV1;
	// This private lifetime forwards native reasons and retires its listeners;
	// caller properties are never inspected by the downstream decoder after yield.
	const lifetime = new PhotoLibrarySessionLifetime();
	try {
		return await lifetime.operation(async signal => {
			const bytes = new Uint8Array(await Reflect.apply(READ, body, []) as ArrayBuffer);
			let packed: Uint8Array | undefined;
			const deadline = new AbortController(), timer = setTimeout(() => { deadline.abort(new DOMException('Photo handoff exceeded its decode deadline.', 'TimeoutError')); }, IMAGE_IMPORT_LIMITS.maximumDecodeMillisecondsPerFile);
			// Both sources are private native signals. Keep the first caller or
			// deadline reason while the existing decoder joins its native work.
			const joined = Reflect.apply(ANY, AbortSignal, [[signal, deadline.signal]]) as AbortSignal;
			const cleanup: { failure?: { reason: unknown } } = {};
			try {
				Reflect.apply(CHECK, joined, []);
				if (bytes.byteLength !== facts.original.byteLength || bytesToHex(sha256(bytes)) !== facts.original.contentSha256) throw new Error('Photo image decode original SHA-256 binding changed.');
				if (hdr) {
					const { decodePhotoHdrImageHandoffPackCurrentV1 } = await import('./photo-image-handoff-hdr-current-v1.ts');
					const result = await decodePhotoHdrImageHandoffPackCurrentV1(bytes, { ...original, mimeType: original.mimeType as string, hasAlpha: original.hasAlpha as boolean }, joined);
					packed = result.publication.bytes; Reflect.apply(CHECK, joined, []);
					return await createPhotoImageHandoffSourceForProfileV1(profile, { sourceId, factsJson,
						original: { ...original, mimeType: original.mimeType as string, hasAlpha: original.hasAlpha as boolean }, pack: result.publication, hdr: result.hdr, signal: joined });
				}
				if (profile === 'current3' && probeRawSourceV1(bytes)) {
					const { decodePhotoRawImageHandoffPackCurrentV1 } = await import('./photo-image-handoff-raw-current-v1.ts');
					const result = await decodePhotoRawImageHandoffPackCurrentV1(bytes,
						{ ...original, mimeType: original.mimeType as string, hasAlpha: original.hasAlpha as boolean }, joined);
					packed = result.publication.bytes; Reflect.apply(CHECK, joined, []);
					return await createPhotoImageHandoffSourceForProfileV1(profile, { sourceId, factsJson,
						original: { ...original, mimeType: original.mimeType as string, hasAlpha: original.hasAlpha as boolean },
						pack: result.publication, raw: result.raw, signal: joined });
				}
				const admission = admitPhotoSourceV1(bytes), metadata = readImageMetadataV1(bytes), orientation = metadata.exif?.orientation ?? 1;
				const swapped = [5, 6, 7, 8].includes(orientation);
				if (original.width !== (swapped ? admission.height : admission.width) || original.height !== (swapped ? admission.width : admission.height)
					|| original.mimeType !== `image/${admission.format}`) throw new Error('Photo image decode original orientation/geometry or MIME binding changed.');
				const nativeOpen = createPhotoNativeImagePortV1(admission, orientation, openImage, joined);
				const result = await decodeFramescaperBrowserNativeImageV1({ bytes,
					fileName: facts.original.fileName.normalize('NFC'), mimeTypeHint: original.mimeType, signal: joined,
					open: async request => {
						const session = await nativeOpen(request);
						// The shared decoder closes before returning its allocated pack.
						// Record this caller's cleanup failure so the pack can still be
						// received and wiped, preserving a separate decode/caller cause.
						return Object.freeze({ metadata: session.metadata, decodeFrame: session.decodeFrame,
							close() { try { session.close(); } catch (reason) { cleanup.failure = { reason }; } } });
					} });
				packed = result.publication.bytes; Reflect.apply(CHECK, joined, []);
				if (cleanup.failure) throw cleanup.failure.reason;
				return await createPhotoImageHandoffSourceForProfileV1(profile, { sourceId, factsJson,
					original: { ...original, mimeType: original.mimeType as string, hasAlpha: original.hasAlpha as boolean }, pack: result.publication, signal: joined });
			} catch (primary) {
				if (cleanup.failure && cleanup.failure.reason !== primary) throw new AggregateError([primary, cleanup.failure.reason], 'Photo image decode and native cleanup failed.', { cause: primary });
				throw primary;
			} finally {
				clearTimeout(timer);
				wipe(bytes); if (packed) wipe(packed);
			}
		}, rawSignal);
	} finally { await lifetime.close(async () => undefined); }
}

function wipe(bytes: Uint8Array): void {
	// A native borrower can detach our transport backing before rejecting.
	if (Reflect.apply(LENGTH, bytes, []) as number > 0) Reflect.apply(FILL, bytes, [0]);
}
