/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopRawDevelopmentV1 } from './image-develop-raw-development-v1.ts';
import { normalizeImageDevelopStateThroughV4, normalizeImageDevelopStateV4, type ImageDevelopStateThroughV4 } from './image-develop-state-v4.ts';

/** Explicit metadata editing only. Selecting a noncanonical source requires
 * separate Original authentication/layout admission by the consuming owner.
 * Canonical is an old-recipe no-op; an authored process4 never downgrades. */
export function setImageDevelopRawDevelopmentCurrentV1(developValue: unknown,
	rawDevelopmentValue: unknown): Readonly<ImageDevelopStateThroughV4> {
	const develop = normalizeImageDevelopStateThroughV4(developValue);
	const rawDevelopment = normalizeImageDevelopRawDevelopmentV1(rawDevelopmentValue);
	if (develop.processVersion !== 4 && rawDevelopment.mode === 'canonical') return develop;
	const repairs = develop.processVersion === 3 || develop.processVersion === 4 ? develop.repairs : { schemaVersion: 1, spots: [] };
	return normalizeImageDevelopStateV4({ ...develop, processVersion: 4, repairs, rawDevelopment });
}
