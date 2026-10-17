/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopStateV2, type ImageDevelopStateV2 } from './image-develop-state-v2.ts';
import { normalizeImageDevelopRepairSpotsV1, type ImageDevelopRepairSpotsV1 } from './image-develop-repair-spots-v1.ts';
import { IMAGE_DEVELOP_LIMITS_V1 } from './image-develop-contract-v1.ts';
import { field, record } from './image-develop-value.ts';

/** Explicit original-based repair successor; scalar metadata grants no pixel authority. */
export interface ImageDevelopStateV3 extends Omit<ImageDevelopStateV2, 'processVersion'> {
	readonly processVersion: 3;
	readonly repairs: Readonly<ImageDevelopRepairSpotsV1>;
}

export function normalizeImageDevelopStateV3(value: unknown): Readonly<ImageDevelopStateV3> {
	const input = record(value, 'repair photo develop', ['processVersion', 'effects', 'geometry', 'masks', 'maskBindings', 'repairs']);
	if (field(input, 'processVersion') !== 3) throw new RangeError('Unsupported repair photo develop process version.');
	// This private projection delegates every existing family to its strict
	// owner; it is never returned as a persisted process2 recipe.
	const metadata = normalizeImageDevelopStateV2({ processVersion: 2, effects: field(input, 'effects'),
		geometry: field(input, 'geometry'), masks: field(input, 'masks'), maskBindings: field(input, 'maskBindings') });
	const repairs = normalizeImageDevelopRepairSpotsV1(field(input, 'repairs'));
	const result: Readonly<ImageDevelopStateV3> = Object.freeze({ ...metadata, processVersion: 3, repairs });
	const serialized = JSON.stringify(result), limit = IMAGE_DEVELOP_LIMITS_V1.maximumBytes;
	if (serialized.length > limit || new TextEncoder().encode(serialized).byteLength > limit) {
		throw new RangeError('Repair photo develop exceeds the existing two-MiB recipe byte budget.');
	}
	return result;
}
