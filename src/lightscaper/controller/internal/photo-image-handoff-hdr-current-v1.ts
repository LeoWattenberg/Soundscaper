/* SPDX-License-Identifier: AGPL-3.0-only */
import { withDecodedImageHdrOriginalV1 } from '../../../common/editor/imaging/image-hdr-original-v1.ts';
import { withLinearPixelFrameDisplayV1 } from '../../../common/editor/imaging/pixel-frame-linear-display-v1.ts';
import { createFramescaperImageFramePackWithWarningsV1, type FramescaperImageFramePackPublicationV1 } from '../../../common/editor/timeline-image-frame-pack-v1.ts';
import { normalizeFramescaperHdrOriginalReceiptV1, type FramescaperHdrOriginalReceiptV1 } from '../../../common/editor/timeline-image-hdr-receipt-v1.ts';
import { PHOTO_HDR_HANDOFF_LIMITS_CURRENT_V1 } from './photo-hdr-handoff-policy-current-v1.ts';

/** Actual generated Original decoding, not a browser raster substitute. Native
 * floats and base display retire before the caller binds its selected recipe. */
export async function decodePhotoHdrImageHandoffPackCurrentV1(bytes: Uint8Array<ArrayBuffer>,
	original: Readonly<{ mimeType: string; width: number; height: number; hasAlpha: boolean }>, signal: AbortSignal,
): Promise<Readonly<{ publication: Readonly<FramescaperImageFramePackPublicationV1>; hdr: Readonly<FramescaperHdrOriginalReceiptV1> }>> {
	signal.throwIfAborted();
	if (original.mimeType !== 'image/x-lightscaper-hdr' || original.hasAlpha) throw new TypeError('HDR handoff requires its opaque generated Original.');
	let publication: Readonly<FramescaperImageFramePackPublicationV1> | undefined;
	try {
		return await withDecodedImageHdrOriginalV1({ bytes, signal }, view => {
			if (view.frame.descriptor.width !== original.width || view.frame.descriptor.height !== original.height) throw new RangeError('HDR handoff native extent differs from its saved Original.');
			const hdr = normalizeFramescaperHdrOriginalReceiptV1({ schemaVersion: 1, format: 'lightscaper-hdr', bodyVersion: 1,
				descriptor: view.frame.descriptor, pixelEncoding: 'rgb32f-le', pixelsSha256: view.pixelsSha256, metadataSha256: view.metadataSha256 });
			return withLinearPixelFrameDisplayV1({ frame: view.frame, signal }, async display => {
				signal.throwIfAborted();
				publication = await createFramescaperImageFramePackWithWarningsV1({ original: bytes, receipt: { schemaVersion: 1, kind: 'hdr-original', hdr },
					width: original.width, height: original.height, timingMode: 'fallback',
					frames: [{ presentationTicks: 0n, durationTicks: 5_000_000n, rgba: display.pixels as Uint8Array<ArrayBuffer> }] },
				{ maximumOriginalBytes: PHOTO_HDR_HANDOFF_LIMITS_CURRENT_V1.originalBytes, maximumAssetBytes: PHOTO_HDR_HANDOFF_LIMITS_CURRENT_V1.bodyBytes });
				signal.throwIfAborted(); return Object.freeze({ publication, hdr });
			}, 'full');
		});
	} catch (error) { publication?.bytes.fill(0); throw error; }
}
