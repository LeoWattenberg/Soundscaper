/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { normalizeImageOutputColorProfileV1, type ImageOutputColorProfileV1 } from './image-output-color-profile-v1.ts';
import { encodePixelFramePngV1 } from './pixel-frame-png-v1.ts';
import { encodePixelFramePng16V1 } from './pixel-frame-png16-v1.ts';
import { encodePixelFramePngStreamV1 } from './pixel-frame-png-stream-kernel-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';
import type { PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';

export interface PixelFramePngProfileOptionsCurrentV1 {
	readonly profile: ImageOutputColorProfileV1;
	readonly bitDepth: 8 | 16;
	readonly signal?: AbortSignal;
	readonly limits?: PixelFrameLimitsV1;
	readonly maximumOutputBytes?: number;
}

/** Output profile is an explicit final conversion, independent of a saved
 * recipe or canonical source declaration. Existing sRGB requests delegate to
 * the permanent encoders; P3 shares their bounded streaming storage owner. */
export async function encodePixelFramePngProfileCurrentV1(value: unknown, optionsValue: unknown): Promise<Uint8Array<ArrayBuffer>> {
	const signalData = typeof optionsValue === 'object' && optionsValue !== null ? Object.getOwnPropertyDescriptor(optionsValue, 'signal') : undefined;
	if (signalData && !Object.hasOwn(signalData, 'value')) throw new TypeError('Profiled PNG signal requires own data.');
	const signal = captureRepairSignalV1(signalData?.value); checkRepairSignalV1(signal);
	const options = record(optionsValue, 'profiled PNG options', ['profile', 'bitDepth', 'signal', 'limits', 'maximumOutputBytes'], ['profile', 'bitDepth']);
	if ((Object.hasOwn(options, 'signal') ? field(options, 'signal', 'profiled PNG options') : undefined) !== signal) throw new TypeError('Profiled PNG signal changed during admission.');
	const profile = normalizeImageOutputColorProfileV1(field(options, 'profile', 'profiled PNG options'));
	const bitDepth = field(options, 'bitDepth', 'profiled PNG options');
	if (bitDepth !== 8 && bitDepth !== 16) throw new RangeError('Profiled PNG requires eight- or sixteen-bit output.');
	const forwarded = Object.fromEntries(['signal', 'limits', 'maximumOutputBytes'].filter(key => Object.hasOwn(options, key))
		.map(key => [key, field(options, key, 'profiled PNG options')]));
	checkRepairSignalV1(signal);
	if (profile === 'srgb') return bitDepth === 8 ? encodePixelFramePngV1(value, forwarded) : encodePixelFramePng16V1(value, forwarded);
	return encodePixelFramePngStreamV1(bitDepth === 8 ? 'p3-8' : 'p3-16', value, forwarded);
}
