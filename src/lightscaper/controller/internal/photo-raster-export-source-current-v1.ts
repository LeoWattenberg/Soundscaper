/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateThroughV4 } from '../../../common/editor/imaging/image-develop-state-v4.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../../../common/editor/photo-library-develop-original-port-v1.ts';
import type { PhotoLibraryDevelopOriginalPortCurrentV1 } from '../../../common/editor/photo-library-develop-original-current-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { prepareImageDevelopRawSourceCurrentV1 } from '../../../common/editor/imaging/image-develop-raw-source-current-v1.ts';
import type { PixelFrameV1 } from '../../../common/editor/imaging/pixel-frame-contract-v1.ts';

type Original = PhotoLibraryDevelopOriginalPortV1['withFrame'];
type Derived = PhotoLibraryDevelopOriginalPortCurrentV1['withDerivedFrame'];

/** The source mode is known only after the saved snapshot read. A missing
 * derived child refuses there, before loading a renderer or borrowing pixels.
 * Both methods have already been captured in the synchronous Save gesture. */
export function capturePhotoRasterExportSourceCurrentV1(request: Readonly<{
	withOriginalFrame: Original; withDerivedFrame?: Derived;
}>, develop: Readonly<ImageDevelopStateThroughV4>): Original {
	if (develop.processVersion !== 4 || develop.rawDevelopment.mode === 'canonical') return request.withOriginalFrame;
	const withDerived = request.withDerivedFrame;
	if (!withDerived) throw new TypeError('RAW source processing requires the named derived Original capability.');
	const profile = develop.rawDevelopment.mode === 'headroom' ? 'linear-headroom-v1' : 'highlight-recovery-v1';
	return (bound, consume, options) => withDerived({ ...bound, profile }, value => {
		const input = record(value, 'Photo raster derived Original', ['photoId', 'revision', 'frame', 'rawFlip', 'profile', 'exposureScale']);
		const photoId = field(input, 'photoId', 'Photo raster derived Original'), revision = field(input, 'revision', 'Photo raster derived Original');
		const rawFlip = field(input, 'rawFlip', 'Photo raster derived Original'), scale = field(input, 'exposureScale', 'Photo raster derived Original');
		if (photoId !== bound.photoId || revision !== bound.expectedRevision || field(input, 'profile', 'Photo raster derived Original') !== profile) {
			throw new Error('Photo raster derived Original identity, revision or profile changed.');
		}
		if (typeof rawFlip !== 'number' || !Number.isInteger(rawFlip) || rawFlip < 0 || rawFlip > 7
			|| typeof scale !== 'number' || !Number.isFinite(scale) || scale < 1 || scale > 65_536) {
			throw new RangeError('Photo raster derived Original metadata exceeds its fixed profile.');
		}
		const frame = field(input, 'frame', 'Photo raster derived Original');
		// This authenticates the live ABI2 plane/profile. It is never a saved
		// recipe projection and the descriptive exposure scale is not reapplied.
		prepareImageDevelopRawSourceCurrentV1(develop, frame);
		return consume(Object.freeze({ photoId, revision, frame: frame as Readonly<PixelFrameV1> }));
	}, options);
}

const MIB = 1024 * 1024, MAXIMUM_WORKING_BYTES = 1024 * MIB;
const BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'buffer')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** The public Original borrow does not expose encoded length. Conservatively
 * retain the qualified RAW bound: Blob, owned snapshot and runtime input (3O),
 * plus its 32 MiB proof/range reserve. Worker/heap retirement precedes this
 * scope. Ordinary byte Originals retain their existing output accounting. */
export function photoRasterRetainedSourceBytesCurrentV1(source: Readonly<PixelFrameV1>): number {
	return source.descriptor.sampleFormat === 'unorm8' ? 0 : 3 * 64 * MIB + 32 * MIB;
}

/** Graphic decoding happens after the RAW worker has retired. Its encoded
 * body and native plane remain borrowed alongside the returned JS plane.
 * The native Develop owner's complete peak includes its input frame already. */
export function preparePhotoRasterNativeRetainedBytesCurrentV1(source: Readonly<PixelFrameV1>, graphic: Readonly<PixelFrameV1> | null, body?: Blob): number {
	const retained = photoRasterRetainedSourceBytesCurrentV1(source);
	const graphicBytes = graphic ? Number(Reflect.apply(SIZE, Reflect.apply(BUFFER, graphic.pixels, []), [])) : 0;
	const encodedBytes = body ? Reflect.apply(Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, body, []) as number : 0;
	if (768 * MIB + retained + encodedBytes + 2 * graphicBytes > MAXIMUM_WORKING_BYTES) {
		throw new RangeError('Native raster source and graphic exceed their aggregate working storage budget.');
	}
	// The output owner separately counts the graphic's actual JS backing.
	return retained + encodedBytes + graphicBytes;
}
