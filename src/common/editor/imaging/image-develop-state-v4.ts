/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, type ClosedDomainRecord } from '../closed-domain-value.ts';
import { IMAGE_DEVELOP_LIMITS_V1 } from './image-develop-contract-v1.ts';
import { normalizeImageDevelopStateV3, type ImageDevelopStateV3 } from './image-develop-state-v3.ts';
import { normalizeImageDevelopStateThroughV3, type ImageDevelopStateThroughV3 } from './image-develop-state-through-v3.ts';
import { normalizeImageDevelopRawDevelopmentV1, type ImageDevelopRawDevelopmentV1 } from './image-develop-raw-development-v1.ts';
import { field, record } from './image-develop-value.ts';

/** An explicit source-processing successor; Original identity and the native
 * canonical receipt remain outside this scalar, non-authoritative recipe. */
export interface ImageDevelopStateV4 extends Omit<ImageDevelopStateV3, 'processVersion'> {
	readonly processVersion: 4;
	readonly rawDevelopment: Readonly<ImageDevelopRawDevelopmentV1>;
}
export type ImageDevelopStateThroughV4 = ImageDevelopStateThroughV3 | ImageDevelopStateV4;

export function normalizeImageDevelopStateV4(value: unknown): Readonly<ImageDevelopStateV4> {
	const input = record(value, 'RAW photo develop', ['processVersion', 'effects', 'geometry', 'masks', 'maskBindings', 'repairs', 'rawDevelopment']);
	if (field(input, 'processVersion') !== 4) throw new RangeError('Unsupported RAW photo develop process version.');
	const rawDevelopment = normalizeImageDevelopRawDevelopmentV1(field(input, 'rawDevelopment'));
	// Existing family and repair admission stays with its permanent owners.
	// This private projection never becomes a persisted process3 downgrade.
	const metadata = normalizeImageDevelopStateV3({ processVersion: 3, effects: field(input, 'effects'), geometry: field(input, 'geometry'),
		masks: field(input, 'masks'), maskBindings: field(input, 'maskBindings'), repairs: field(input, 'repairs') });
	const result: Readonly<ImageDevelopStateV4> = Object.freeze({ ...metadata, processVersion: 4, rawDevelopment });
	const serialized = JSON.stringify(result), limit = IMAGE_DEVELOP_LIMITS_V1.maximumBytes;
	if (serialized.length > limit || new TextEncoder().encode(serialized).byteLength > limit) {
		throw new RangeError('RAW photo develop exceeds the existing two-MiB recipe byte budget.');
	}
	return result;
}

/** Explicit additive admission. The central Current alias remains through3
 * until each owning call chain opts into source-processing semantics. */
export function normalizeImageDevelopStateThroughV4(value: unknown): Readonly<ImageDevelopStateThroughV4> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Photo develop requires an own process version.');
	const version = readClosedDomainField(value as ClosedDomainRecord, 'processVersion', 'photo develop version');
	if (version === 4) return normalizeImageDevelopStateV4(value);
	if (version === 1 || version === 2 || version === 3) return normalizeImageDevelopStateThroughV3(value);
	throw new RangeError('Unsupported photo develop process version through4.');
}
