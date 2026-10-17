/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateV1 } from './image-develop-contract-v1.ts';
import { normalizeImageDevelopStateV1 } from './image-develop-state-v1.ts';
import { normalizeImageDevelopStateV2, type ImageDevelopStateV2 } from './image-develop-state-v2.ts';
import { normalizeImageDevelopStateV3, type ImageDevelopStateV3 } from './image-develop-state-v3.ts';
import { readClosedDomainField, type ClosedDomainRecord } from '../closed-domain-value.ts';

/** Permanently bounded union for facades whose policy ends at process3. */
export type ImageDevelopStateThroughV3 = ImageDevelopStateV1 | ImageDevelopStateV2 | ImageDevelopStateV3;

export function normalizeImageDevelopStateThroughV3(value: unknown): Readonly<ImageDevelopStateThroughV3> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Photo develop requires an own process version.');
	const version = readClosedDomainField(value as ClosedDomainRecord, 'processVersion', 'photo develop version');
	if (version === 1) return normalizeImageDevelopStateV1(value);
	if (version === 2) return normalizeImageDevelopStateV2(value);
	if (version === 3) return normalizeImageDevelopStateV3(value);
	throw new RangeError('Unsupported photo develop process version through3.');
}
