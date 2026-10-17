/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import type { PixelFrameV1 } from '../../imaging/pixel-frame-contract-v1.ts';
import type { ImageDevelopStateCurrentV1 } from '../../imaging/image-develop-state-current-v1.ts';
import { ImageRepairSpotsAuthoringKernelV1, captureImageRepairSpotsSignalV1, type ImageRepairSpotsAuthoringSnapshotV1 } from './internal/image-repair-spots-authoring-kernel-v1.ts';

export type { ImageRepairSpotsAuthoringSnapshotV1 };
export type WithImageRepairSpotsOriginalFrameV1 = <Result>(consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) => Promise<Result>;
export interface ImageRepairSpotsAuthoringOptionsV1 {
	readonly withOriginalFrame: WithImageRepairSpotsOriginalFrameV1;
	readonly develop: ImageDevelopStateCurrentV1;
	readonly isCurrent: () => boolean;
	readonly signal?: AbortSignal;
}
/** Local Original-space draft; its caller owns source identity and publication. */
export class ImageRepairSpotsAuthoringV1 extends ImageRepairSpotsAuthoringKernelV1<Readonly<PixelFrameV1>> {
	constructor(options: Readonly<ImageRepairSpotsAuthoringOptionsV1>) {
		super(captureOptions(options));
	}
}
/** Explicit Current source policy. The permanent V1 facade remains byte-only. */
export class ImageRepairSpotsAuthoringCurrentV1 extends ImageRepairSpotsAuthoringKernelV1<Readonly<PixelFrameV1>> {
	constructor(options: Readonly<ImageRepairSpotsAuthoringOptionsV1>) {
		super(captureOptions(options), 'current-native');
	}
}
function captureOptions(options: Readonly<ImageRepairSpotsAuthoringOptionsV1>) {
	const signalData = Object.getOwnPropertyDescriptor(options, 'signal');
	const signal = captureImageRepairSpotsSignalV1(signalData && Object.hasOwn(signalData, 'value') ? signalData.value : undefined);
	const input = record(options, 'repair authoring options', ['withOriginalFrame', 'develop', 'isCurrent', 'signal'], ['withOriginalFrame', 'develop', 'isCurrent']);
	if ((Object.hasOwn(input, 'signal') ? field(input, 'signal', 'repair authoring options') : undefined) !== signal) throw new TypeError('Repair authoring cancellation changed during admission.');
	const read = field(input, 'withOriginalFrame', 'repair authoring options'), current = field(input, 'isCurrent', 'repair authoring options');
	if (typeof read !== 'function' || typeof current !== 'function') throw new TypeError('Repair authoring requires the selected Original and current entry check.');
	return { withOriginalFrame: <Result>(consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, requestOptions?: Readonly<{ signal?: AbortSignal }>) =>
		Reflect.apply(read, options, [consume, requestOptions]) as Promise<Result>, frame: (frame: Readonly<PixelFrameV1>) => frame,
		develop: field(input, 'develop', 'repair authoring options') as ImageDevelopStateCurrentV1,
		isCurrent: () => Reflect.apply(current, options, []) === true, ...(signal === undefined ? {} : { signal }) };
}
