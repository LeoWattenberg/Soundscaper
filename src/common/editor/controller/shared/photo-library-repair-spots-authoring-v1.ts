/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import type { PhotoLibraryDevelopOriginalFrameV1, PhotoLibraryDevelopOriginalPortV1 } from '../../photo-library-develop-original-port-v1.ts';
import type { ImageDevelopStateCurrentV1 } from '../../imaging/image-develop-state-current-v1.ts';
import type { PixelFrameV1 } from '../../imaging/pixel-frame-contract-v1.ts';
import type { WithImageRepairSpotsOriginalFrameV1 } from './image-repair-spots-authoring-v1.ts';
import { ImageRepairSpotsAuthoringKernelV1, captureImageRepairSpotsSignalV1, type ImageRepairSpotsAuthoringSnapshotV1 } from './internal/image-repair-spots-authoring-kernel-v1.ts';

export interface PhotoLibraryRepairSpotsAuthoringOptionsV1 {
	readonly original: Readonly<PhotoLibraryDevelopOriginalPortV1>;
	readonly photoId: string;
	readonly expectedRevision: number;
	readonly develop: ImageDevelopStateCurrentV1;
	readonly isCurrent: () => boolean;
	readonly signal?: AbortSignal;
}
export type PhotoLibraryRepairSpotsAuthoringSnapshotV1 = ImageRepairSpotsAuthoringSnapshotV1;
/** Permanent Photo binding admission around the product-neutral local draft. */
export class PhotoLibraryRepairSpotsAuthoringV1 extends ImageRepairSpotsAuthoringKernelV1<Readonly<PhotoLibraryDevelopOriginalFrameV1>> {
	constructor(options: Readonly<PhotoLibraryRepairSpotsAuthoringOptionsV1>) {
		const signalData = Object.getOwnPropertyDescriptor(options, 'signal');
		const signal = captureImageRepairSpotsSignalV1(signalData && Object.hasOwn(signalData, 'value') ? signalData.value : undefined);
		const input = record(options, 'repair authoring options', ['original', 'photoId', 'expectedRevision', 'develop', 'isCurrent', 'signal'], ['original', 'photoId', 'expectedRevision', 'develop', 'isCurrent']);
		if ((Object.hasOwn(input, 'signal') ? field(input, 'signal', 'repair authoring options') : undefined) !== signal) throw new TypeError('Repair authoring cancellation changed during admission.');
		const current = field(input, 'isCurrent', 'repair authoring options');
		if (typeof current !== 'function') throw new TypeError('Repair authoring requires a current entry check.');
		const binding = captureBinding(field(input, 'original', 'repair authoring options'), field(input, 'photoId', 'repair authoring options'), field(input, 'expectedRevision', 'repair authoring options'));
		super({ withOriginalFrame: binding.read, frame: binding.frame,
			develop: field(input, 'develop', 'repair authoring options') as ImageDevelopStateCurrentV1,
			isCurrent: () => Reflect.apply(current, options, []) === true, ...(signal === undefined ? {} : { signal }) });
	}
}
/** Selected Photo authority adapter for the neutral editor; the returned
 * callback never invents a Photo view or grants a catalog/body writer. */
export function capturePhotoLibraryRepairSpotsOriginalFrameV1(options: Readonly<Pick<PhotoLibraryRepairSpotsAuthoringOptionsV1, 'original' | 'photoId' | 'expectedRevision'>>): WithImageRepairSpotsOriginalFrameV1 {
	const input = record(options, 'repair Original binding', ['original', 'photoId', 'expectedRevision']);
	const binding = captureBinding(field(input, 'original', 'repair Original binding'), field(input, 'photoId', 'repair Original binding'), field(input, 'expectedRevision', 'repair Original binding'));
	return <Result>(consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, requestOptions?: Readonly<{ signal?: AbortSignal }>): Promise<Result> => {
		if (typeof consume !== 'function') return Promise.reject(new TypeError('Original display requires a joined consumer.'));
		return binding.read(view => Reflect.apply(consume, undefined, [binding.frame(view)]) as Result | Promise<Result>, requestOptions);
	};
}
function captureBinding(original: unknown, photoIdValue: unknown, revision: unknown) {
	const port = record(original, 'repair Original capability', ['withFrame']), read = field(port, 'withFrame', 'repair Original capability');
	if (typeof read !== 'function') throw new TypeError('Repair authoring requires the selected Original capability.');
	if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || Object.is(revision, -0)) throw new RangeError('Repair authoring requires a canonical Photo revision.');
	const photoId = stableId(photoIdValue), request = Object.freeze({ schemaVersion: 1, photoId, expectedRevision: revision });
	return {
		read: <Result>(consume: (view: Readonly<PhotoLibraryDevelopOriginalFrameV1>) => Result | Promise<Result>, requestOptions?: Readonly<{ signal?: AbortSignal }>) =>
			Reflect.apply(read, original, [request, consume, requestOptions]) as Promise<Result>,
		frame: (view: Readonly<PhotoLibraryDevelopOriginalFrameV1>): Readonly<PixelFrameV1> => {
			const value = record(view, 'repair Original view', ['photoId', 'revision', 'frame']);
			if (field(value, 'photoId', 'repair Original view') !== photoId || field(value, 'revision', 'repair Original view') !== revision) throw new Error('Repair Original changed Photo identity or revision.');
			return field(value, 'frame', 'repair Original view') as Readonly<PixelFrameV1>;
		},
	};
}
function stableId(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError('Repair authoring requires a stable Photo/spot ID.'); return value;
}
