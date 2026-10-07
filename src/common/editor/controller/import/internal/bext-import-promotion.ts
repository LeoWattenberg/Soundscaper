/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BextMetadataInput } from '../../../broadcast-wave.ts';
import { normalizeProjectBextMetadata, type ProjectBextMetadata } from '../../../project-bext-metadata.ts';

/** A recording's absolute timestamp describes its placement, not project frame zero. */
export function promoteImportedBextOrigin(
	source: BextMetadataInput,
	projectClockReference: string | null,
	timelineStartFrame: number,
): ProjectBextMetadata {
	if (!Number.isSafeInteger(timelineStartFrame) || timelineStartFrame < 0) {
		throw new RangeError('The imported recording position must be a non-negative safe integer.');
	}
	const reference = BigInt(projectClockReference ?? '0');
	const origin = reference - BigInt(timelineStartFrame);
	if (origin < 0n) throw new RangeError('The recording placement produces a negative BEXT project origin.');
	return normalizeProjectBextMetadata({ ...source, timeReference: origin.toString() });
}
