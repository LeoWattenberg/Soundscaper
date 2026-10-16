/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { prepareFramescaperHdrImageOriginalCurrentV1 } from '../../../common/editor/timeline-image-model-hdr-current-v1.ts';
import { withDecodedImageHdrOriginalV1 } from '../../../common/editor/imaging/image-hdr-original-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { canonicalMediaContentBlob } from '../../../common/editor/storage/media-content-digest.ts';
import { emptyPhotoMetadataV1 } from '../../catalog/photo-metadata.ts';
import { normalizeImageMetadataV1 } from '../../../common/editor/imaging/image-metadata-normalizer-v1.ts';
import type { PhotoFramescaperHandoffOriginalRequestForProfileV1, PhotoFramescaperHandoffOriginalV1 } from './photo-framescaper-handoff-original-kernel-v1.ts';

const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, READ = Blob.prototype.arrayBuffer;
/** Re-prove exact encoded HDR/native hashes before Photo publication. No EXIF,
 * camera decoder identity or byte-cache equality is invented for generated RGB. */
export async function preparePhotoFramescaperHandoffHdrOriginalCurrentV1(value: Readonly<PhotoFramescaperHandoffOriginalRequestForProfileV1>): Promise<Readonly<PhotoFramescaperHandoffOriginalV1>> {
	const input = record(value, 'HDR Photo handoff Original', ['source', 'originalBlob', 'canonicalFrameSha256', 'signal'], ['source', 'originalBlob', 'canonicalFrameSha256']);
	const signal = captureRepairSignalV1(Object.hasOwn(input, 'signal') ? field(input, 'signal', 'HDR Photo handoff Original') : undefined);
	checkRepairSignalV1(signal);
	const { source } = prepareFramescaperHdrImageOriginalCurrentV1(field(input, 'source', 'HDR Photo handoff Original'));
	if (field(input, 'canonicalFrameSha256', 'HDR Photo handoff Original') !== source.hdr.pixelsSha256) throw new Error('HDR receive native payload digest differs from its receipt.');
	const body = canonicalMediaContentBlob(field(input, 'originalBlob', 'HDR Photo handoff Original'));
	if (body.size !== source.original.byteLength) throw new RangeError('HDR receive Original differs from its encoded length.');
	const originalBlob = Object.freeze(Blob.prototype.slice.call(body, 0, body.size, source.original.mimeType!));
	const backing = await Reflect.apply(READ, originalBlob, []) as ArrayBuffer, length = Number(Reflect.apply(SIZE, backing, [])), bytes = new Uint8Array(backing);
	let outcome: { value: Readonly<PhotoFramescaperHandoffOriginalV1> } | { error: unknown };
	try {
		checkRepairSignalV1(signal);
		if (length !== source.original.byteLength || bytesToHex(sha256(bytes)) !== source.original.sha256) throw new Error('HDR receive complete Original SHA or length changed.');
		await withDecodedImageHdrOriginalV1({ bytes, ...(signal ? { signal } : {}) }, view => {
			if (JSON.stringify(view.frame.descriptor) !== JSON.stringify(source.hdr.descriptor) || view.pixelsSha256 !== source.hdr.pixelsSha256
				|| view.metadataSha256 !== source.hdr.metadataSha256) throw new Error('HDR receive native body differs from its receipt.');
		});
		// Generated RGB has no EXIF/IPTC or single-exposure capture facts. Both
		// permanent metadata/import adapters own64MiB raster policies; this named
		// HDR boundary normalizes descriptive facts after actual native proof.
		let displayName = '';
		for (const character of source.provenance.original.exactName.replace(/[\p{Cc}\p{Cf}]/gu, '')) {
			if (displayName.length + character.length > 256) break; displayName += character;
		}
		if (!displayName.trim()) displayName = 'Merged HDR.lshdr';
		const aliased = displayName !== source.provenance.original.exactName;
		const facts = Object.freeze({ metadata: emptyPhotoMetadataV1(displayName),
			extractedMetadata: normalizeImageMetadataV1({ schemaVersion: 1, container: 'unsupported', exif: null, iptc: null, issues: [] }),
			keywordNames: Object.freeze([]), notices: Object.freeze(aliased ? [Object.freeze({ field: 'fileName' as const, reason: 'display-bound' as const })] : []) });
		checkRepairSignalV1(signal); outcome = { value: Object.freeze({ originalBlob, ...facts }) };
	} catch (error) { outcome = { error }; }
	let cleanup: { error: unknown } | undefined;
	try { if (Reflect.apply(SIZE, backing, []) !== length) throw new TypeError('HDR receive Original detached before physical retirement.'); new Uint8Array(backing).fill(0); }
	catch (error) { cleanup = { error }; }
	if ('error' in outcome) { if (cleanup && !Object.is(cleanup.error, outcome.error)) throw new AggregateError([outcome.error, cleanup.error], 'HDR receive and Original retirement failed.', { cause: outcome.error }); throw outcome.error; }
	if (cleanup) throw cleanup.error; return outcome.value;
}
