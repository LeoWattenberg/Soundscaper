/* SPDX-License-Identifier: AGPL-3.0-only */

import { withCubeLutResourceV1 } from '../../common/editor/imaging/cube-lut-resource-v1.ts';
import { normalizeCubeLutProfileParamsV1 } from '../../common/editor/video-cube-lut-profile-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../../common/editor/video-color-cube-lut-v27.ts';
import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../../common/editor/scape-archive-envelope.ts';
import type { ScapeExpandedByteBudget } from '../../common/editor/scape-expanded-byte-budget.ts';
import { PHOTO_CUBE_LUT_ASSET_KIND, PHOTO_CUBE_LUT_ENCODING } from '../../common/editor/scape-photo-cube-lut.ts';
import { photoPackByteView } from './pack-byte-chunk.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
const NativeBytes = Uint8Array;
const SET = NativeBytes.prototype.set, FILL = NativeBytes.prototype.fill;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** One <=16MiB raw body is retained until extraction, independent V27 body
 * authentication and the private writer settle. Parsed numeric arrays are
 * borrowed through the existing resource owner; this is not a heap bound.
 * No bytes are delivered on request-success or before getData completes. */
export async function readPhotoCubeLutArchiveEntryV1(entry: ScapeArchiveEntry, descriptor: ScapeAssetDescriptor,
	budget: ScapeExpandedByteBudget, referenceValue: unknown,
	consume: (reference: Readonly<VideoCubeLutReferenceV1>, bytes: Uint8Array<ArrayBuffer>) => Promise<void>, signal?: AbortSignal): Promise<void> {
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check();
	if (typeof consume !== 'function') throw new TypeError('A scoped provisional LUT writer is required.');
	const reference = normalizeCubeLutProfileParamsV1({ lut: referenceValue }).lut;
	if (reference === null) throw new TypeError('A Photo LUT asset requires a nonnull reference.');
	const filename = `assets/luts/${reference.sha256}.cube`;
	if (entry.filename !== filename || descriptor.entry !== filename || descriptor.sourceId !== reference.storageKey
		|| descriptor.kind !== PHOTO_CUBE_LUT_ASSET_KIND || descriptor.encoding !== PHOTO_CUBE_LUT_ENCODING
		|| descriptor.sha256 !== reference.sha256 || descriptor.size !== reference.byteLength
		|| entry.uncompressedSize !== reference.byteLength) throw new RangeError('Photo LUT asset differs from its exact reference.');
	const getData = entry.getData, charge = budget.consume;
	if (typeof getData !== 'function' || typeof charge !== 'function') throw new TypeError('A captured LUT extractor and byte budget are required.');
	check();
	const bytes = new NativeBytes(reference.byteLength), backing = bytes.buffer;
	let live = true, closed = false, size = 0;
	try {
		const target = new WritableStream<Uint8Array>({
			write(chunk) {
				check();
				if (!live || closed) throw new Error('Photo LUT extraction is retired.');
				const view = photoPackByteView(chunk);
				if (view.byteLength < 1 || view.byteLength > 4 * 1024 * 1024 || view.byteLength > reference.byteLength - size) {
					throw new RangeError('Photo LUT emission exceeds its bounded descriptor.');
				}
				Reflect.apply(charge, budget, [view.byteLength, filename]);
				Reflect.apply(SET, bytes, [view, size]); size += view.byteLength;
			},
			close() { check(); closed = true; },
		});
		await Reflect.apply(getData, entry, [target, { signal, strictness: 'strict' }]);
		check();
		if (!closed || size !== reference.byteLength) throw new RangeError('Photo LUT extraction ended before its complete body.');
		await withCubeLutResourceV1({ reference, bytes, signal }, async resource => { await consume(resource.reference, bytes); });
		check();
	} finally {
		live = false;
		if (Reflect.apply(SIZE, backing, []) !== 0) Reflect.apply(FILL, new NativeBytes(backing), [0]);
	}
}
