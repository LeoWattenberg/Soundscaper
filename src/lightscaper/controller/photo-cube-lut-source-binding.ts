/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CubeLutSourcePortV1 } from '../../common/editor/imaging/cube-lut-source-port-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../../common/editor/video-color-cube-lut-v27.ts';

export function capturePhotoCubeLutSource(value: unknown): Readonly<CubeLutSourcePortV1> {
	if (!value || typeof value !== 'object') throw new TypeError('An active Photo LUT requires a resource source.');
	const descriptor = Object.getOwnPropertyDescriptor(value, 'withBytes');
	if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError('Photo LUT source requires an own withBytes method.');
	const method = descriptor.value as CubeLutSourcePortV1['withBytes'];
	return Object.freeze({ withBytes<Result>(reference: Readonly<VideoCubeLutReferenceV1>,
		consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result> {
		return Reflect.apply(method, value, [reference, consume, options]) as Promise<Result>;
	} });
}
