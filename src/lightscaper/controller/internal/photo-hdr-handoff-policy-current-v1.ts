/* SPDX-License-Identifier: AGPL-3.0-only */
import { IMAGE_HDR_ORIGINAL_LIMITS_V1, IMAGE_HDR_ORIGINAL_MIME_TYPE_V1 } from '../../../common/editor/imaging/image-hdr-original-profile-v1.ts';
import { prepareLinearDevelopMetadataCurrentV1 } from '../../../common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { prepareImageDevelopAuthoringCurrentV1 } from '../../../common/editor/imaging/image-develop-authoring-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../../common/editor/photo-library-develop-linear-port-v1.ts';
import { normalizeImageDevelopStateThroughV4 } from '../../../common/editor/imaging/image-develop-state-v4.ts';

export const PHOTO_HDR_HANDOFF_LIMITS_CURRENT_V1 = Object.freeze({ originalBytes: IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumEncodedBytes,
	bodyBytes: 384 * 1024 * 1024, archiveBytes: 512 * 1024 * 1024, workingBytes: 1024 * 1024 * 1024 });
export function isPhotoHdrHandoffOriginalCurrentV1(original: Readonly<{ mimeType: unknown }>): boolean {
	const mime = Object.getOwnPropertyDescriptor(original, 'mimeType');
	if (!mime || !Object.hasOwn(mime, 'value')) throw new TypeError('HDR handoff MIME must be own data.');
	return mime.value === IMAGE_HDR_ORIGINAL_MIME_TYPE_V1;
}
const METADATA_ONLY = Object.freeze({ async withBytes<Result>(): Promise<Result> { throw new TypeError('HDR handoff metadata cannot read resource bodies.'); } });
/** HDR has a separate capacity policy; legacy raster/RAW caps remain exact.
 * Conservative declared peaks can reject valid maximum-size combinations. */
export function admitPhotoHdrHandoffWorkCurrentV1(developValue: unknown, width: number, height: number, originalBytes: number, retainedBytes = 0): void {
	for (const value of [width, height, originalBytes, retainedBytes]) if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('HDR handoff requires bounded scalar geometry and bytes.');
	if (originalBytes < 1 || originalBytes > PHOTO_HDR_HANDOFF_LIMITS_CURRENT_V1.originalBytes) throw new RangeError('HDR handoff Original exceeds its encoded byte capacity.');
	const saved = normalizeImageDevelopStateThroughV4(developValue);
	if (saved.processVersion === 4 && saved.rawDevelopment.mode !== 'canonical') throw new RangeError('Generated HDR cannot select a RAW decoder profile.');
	const develop = prepareImageDevelopAuthoringCurrentV1(saved);
	const prepared = prepareLinearDevelopMetadataCurrentV1({ frame: { descriptor: { schemaVersion: 1, width, height, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' } }, develop },
		PHOTO_DEVELOP_LINEAR_LIMITS_V1, { source: METADATA_ONLY, maskSource: METADATA_ONLY });
	const original = BigInt(originalBytes), retained = BigInt(retainedBytes), reserve = 32n * 1024n * 1024n, pixels = BigInt(width) * BigInt(height);
	// Blob + selected reader bytes + codec snapshot; a mismatched authenticated
	// header can allocate the codec's full native maximum before extent proof.
	const decode = retained + original * 3n + BigInt(IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumDecodedBytes) + reserve;
	const packUpper = original + pixels * 4n + 1024n * 1024n;
	// Source binding later retains its producer pack, Blob/snapshot, selected
	// Original bytes and Blob while native pack proof borrows two encoded copies.
	const binding = retained + packUpper * 3n + original * 4n + BigInt(IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumDecodedBytes) + reserve;
	const render = retained + BigInt(prepared.peakWorkingBytes) + reserve;
	if ([decode, binding, render].some(peak => peak > BigInt(PHOTO_HDR_HANDOFF_LIMITS_CURRENT_V1.workingBytes))) throw new RangeError('HDR handoff exceeds its 1 GiB phase working bound.');
}
