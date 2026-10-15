/* SPDX-License-Identifier: AGPL-3.0-only */

import { withDecodedRawOriginalV1 } from '../../../common/editor/raw/libraw-runtime-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { probeRawSourceV1 } from '../../../common/editor/raw/raw-source-v1.ts';
import { withLinearPixelFrameDisplayV1 } from '../../../common/editor/imaging/pixel-frame-linear-display-v1.ts';
import { createFramescaperImageFramePackV1, type FramescaperImageFramePackPublicationV1 } from '../../../common/editor/timeline-image-frame-pack-v1.ts';
import { FRAMESCAPER_RAW_DECODER_IDENTITY_V1, framescaperRawOriginalPixelsSha256V1,
	normalizeFramescaperRawOriginalReceiptV1, type FramescaperRawOriginalReceiptV1 } from '../../../common/editor/timeline-image-raw-receipt-v1.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
const FILL = Uint8Array.prototype.fill;
const LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!;

/** The caller owns and authenticates encoded Original bytes. Native words and
 * the disposable presentation plane both retire before the caller constructs
 * its immutable handoff Blob. No developed pixels become editing authority. */
export async function decodePhotoRawImageHandoffPackCurrentV1(bytes: Uint8Array<ArrayBuffer>,
	original: Readonly<{ mimeType: string; width: number; height: number; hasAlpha: boolean }>, signal: AbortSignal,
	dependencies: Readonly<{ withRawOriginal?: typeof withDecodedRawOriginalV1 }> = {},
): Promise<Readonly<{ publication: Readonly<FramescaperImageFramePackPublicationV1>; raw: Readonly<FramescaperRawOriginalReceiptV1> }>> {
	Reflect.apply(CHECK, signal, []);
	const ports = record(dependencies, 'RAW handoff decode ports', ['withRawOriginal'], []);
	const method = Object.hasOwn(ports, 'withRawOriginal') ? field(ports, 'withRawOriginal', 'RAW handoff decode ports') : withDecodedRawOriginalV1;
	if (typeof method !== 'function') throw new TypeError('RAW handoff requires its scoped native decoder.');
	const decode = Reflect.apply(Function.prototype.bind, method, [dependencies]) as typeof withDecodedRawOriginalV1;
	const admission = probeRawSourceV1(bytes);
	if (!admission || admission.mimeType !== original.mimeType || original.hasAlpha) throw new RangeError('RAW image handoff requires its actual opaque native Original MIME.');
	// Before decoder allocation: caller Original + worker input copy + pinned
	// 512 MiB WASM maximum + bounded native RGBA16 output + owner/hash reserve.
	const nativeBytes = BigInt(original.width) * BigInt(original.height) * 8n;
	if (nativeBytes > 134_217_728n || BigInt(bytes.buffer.byteLength) + BigInt(bytes.byteLength) + nativeBytes + 544n * 1024n * 1024n > 1024n * 1024n * 1024n) {
		throw new RangeError('RAW image handoff decode exceeds its working byte bound.');
	}
	let publication: Readonly<FramescaperImageFramePackPublicationV1> | undefined;
	try {
		return await decode({ bytes, signal }, async ({ frame, rawFlip }) => {
			Reflect.apply(CHECK, signal, []);
			if (frame.descriptor.width !== original.width || frame.descriptor.height !== original.height) throw new RangeError('RAW image handoff native orientation/geometry differs from the retained Original.');
			const raw = normalizeFramescaperRawOriginalReceiptV1({ schemaVersion: 1, decoder: FRAMESCAPER_RAW_DECODER_IDENTITY_V1,
				descriptor: frame.descriptor, rawFlip, pixelEncoding: 'rgba16be', pixelsSha256: await framescaperRawOriginalPixelsSha256V1(frame, signal) });
			return withLinearPixelFrameDisplayV1({ frame, signal }, display => {
				Reflect.apply(CHECK, signal, []);
				publication = createFramescaperImageFramePackV1({ original: bytes, receipt: { schemaVersion: 1, kind: 'raw-original', raw },
					width: original.width, height: original.height, timingMode: 'fallback',
					frames: [{ presentationTicks: 0n, durationTicks: 5_000_000n, rgba: display.pixels as Uint8Array<ArrayBuffer> }] });
				Reflect.apply(CHECK, signal, []); return Object.freeze({ publication, raw });
			}, 'full');
		});
	} catch (error) {
		if (publication && Number(Reflect.apply(LENGTH, publication.bytes, [])) > 0) Reflect.apply(FILL, publication.bytes, [0]);
		throw error;
	}
}
