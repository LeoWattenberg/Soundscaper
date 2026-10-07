/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../closed-domain-value.ts';
import {
	planPixelFrameV1,
	readPixelFrameDescriptorV1,
	type PixelColorPrimariesV1,
	type PixelColorTransferV1,
	type PixelFramePlanV1,
	type PixelSampleFormatV1,
} from './pixel-frame-contract-v1.ts';

export interface PixelFrameProfileV1 {
	readonly sampleFormat: PixelSampleFormatV1;
	readonly primaries: PixelColorPrimariesV1;
	readonly transfer: PixelColorTransferV1;
}

/** The current route supports only 8-bit encoded sRGB, with no fallback. */
export const PIXEL_FRAME_CURRENT_PROFILES_V1: readonly Readonly<PixelFrameProfileV1>[] = Object.freeze([
	Object.freeze({ sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' } as const),
]);

/**
 * A route supplies the exact profiles it can process. Enlarging that closed
 * list admits deeper/wider buffers without changing descriptor version 1.
 * This function only admits metadata; it does not allocate or convert pixels.
 */
export function admitPixelFrameV1(value: unknown, optionsValue: unknown = {}): Readonly<PixelFramePlanV1> {
	const options = readClosedDomainRecord(optionsValue, 'pixel frame admission options', ['profiles', 'limits'], []);
	const profiles = Object.hasOwn(options, 'profiles')
		? readProfiles(readClosedDomainField(options, 'profiles', 'pixel frame admission options'))
		: PIXEL_FRAME_CURRENT_PROFILES_V1;
	const limits = Object.hasOwn(options, 'limits')
		? readClosedDomainField(options, 'limits', 'pixel frame admission options')
		: {};
	const plan = planPixelFrameV1(value, limits);
	const descriptor = plan.descriptor;
	if (!profiles.some((profile) => profile.sampleFormat === descriptor.sampleFormat
		&& profile.primaries === descriptor.primaries && profile.transfer === descriptor.transfer)) {
		throw new RangeError('Pixel frame profile is not admitted by this processing route.');
	}
	return plan;
}

function readProfiles(value: unknown): readonly Readonly<PixelFrameProfileV1>[] {
	const profiles = readClosedDomainArray(value, 'pixel frame profiles', 0, 256);
	return Object.freeze(profiles.map((value) => {
		const record = readClosedDomainRecord(value, 'pixel frame profile', ['sampleFormat', 'primaries', 'transfer']);
		// The descriptor reader owns the declaration vocabulary; no second color
		// or depth schema is introduced by the admission policy.
		const descriptor = readPixelFrameDescriptorV1({
			schemaVersion: 1,
			width: 1,
			height: 1,
			sampleFormat: readClosedDomainField(record, 'sampleFormat', 'pixel frame profile'),
			primaries: readClosedDomainField(record, 'primaries', 'pixel frame profile'),
			transfer: readClosedDomainField(record, 'transfer', 'pixel frame profile'),
		});
		return Object.freeze({
			sampleFormat: descriptor.sampleFormat,
			primaries: descriptor.primaries,
			transfer: descriptor.transfer,
		});
	}));
}
