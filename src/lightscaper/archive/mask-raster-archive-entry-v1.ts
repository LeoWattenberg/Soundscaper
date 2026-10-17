/* SPDX-License-Identifier: AGPL-3.0-only */

import { withBrushMaskResourceV1, type BrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import { normalizePhotoMaskRasterArchiveReferenceV1 } from './mask-raster-archive-source-v1.ts';
import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../../common/editor/scape-archive-envelope.ts';
import type { ScapeExpandedByteBudget } from '../../common/editor/scape-expanded-byte-budget.ts';
import { PHOTO_MASK_RASTER_ASSET_KIND_V1, PHOTO_MASK_RASTER_ENCODING_V1 } from '../../common/editor/scape-photo-mask-raster-v1.ts';
import { photoPackByteView } from './pack-byte-chunk.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
const NativeBytes = Uint8Array;
const SET = NativeBytes.prototype.set, FILL = NativeBytes.prototype.fill;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** One <=1MiB + 16 bytes raw body is retained until extraction, independent SCMASK01 body
 * authentication and the private writer settle. Decoded alpha is
 * borrowed through the existing resource owner; this is not a heap bound.
 * No bytes are delivered on request-success or before getData completes. */
export async function readPhotoMaskRasterArchiveEntryV1(entry: ScapeArchiveEntry, descriptor: ScapeAssetDescriptor,
	budget: ScapeExpandedByteBudget, referenceValue: unknown,
	consume: (reference: Readonly<BrushMaskResourceReferenceV1>, bytes: Uint8Array<ArrayBuffer>) => Promise<void>, signal?: AbortSignal): Promise<void> {
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check();
	if (typeof consume !== 'function') throw new TypeError('A scoped provisional mask writer is required.');
	const reference = normalizePhotoMaskRasterArchiveReferenceV1(referenceValue);
	const filename = `assets/masks/${reference.sha256}.scmask`;
	if (entry.filename !== filename || descriptor.entry !== filename || descriptor.sourceId !== reference.storageKey
		|| descriptor.kind !== PHOTO_MASK_RASTER_ASSET_KIND_V1 || descriptor.encoding !== PHOTO_MASK_RASTER_ENCODING_V1
		|| descriptor.sha256 !== reference.sha256 || descriptor.size !== reference.byteLength
		|| entry.uncompressedSize !== reference.byteLength) throw new RangeError('Photo mask asset differs from its exact reference.');
	const getData = entry.getData, charge = budget.consume;
	if (typeof getData !== 'function' || typeof charge !== 'function') throw new TypeError('A captured mask extractor and byte budget are required.');
	check();
	const bytes = new NativeBytes(reference.byteLength), backing = bytes.buffer;
	let live = true, closed = false, size = 0;
	try {
		const target = new WritableStream<Uint8Array>({
			write(chunk) {
				check();
				if (!live || closed) throw new Error('Photo mask extraction is retired.');
				const view = photoPackByteView(chunk);
				if (view.byteLength < 1 || view.byteLength > 4 * 1024 * 1024 || view.byteLength > reference.byteLength - size) {
					throw new RangeError('Photo mask emission exceeds its bounded descriptor.');
				}
				Reflect.apply(charge, budget, [view.byteLength, filename]);
				Reflect.apply(SET, bytes, [view, size]); size += view.byteLength;
			},
			close() { check(); closed = true; },
		});
		await Reflect.apply(getData, entry, [target, { signal, strictness: 'strict' }]);
		check();
		if (!closed || size !== reference.byteLength) throw new RangeError('Photo mask extraction ended before its complete body.');
		await withBrushMaskResourceV1({ reference, bytes, signal }, async resource => { await consume(resource.reference, bytes); });
		check();
	} finally {
		live = false;
		if (Reflect.apply(SIZE, backing, []) !== 0) Reflect.apply(FILL, new NativeBytes(backing), [0]);
	}
}
