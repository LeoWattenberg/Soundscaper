/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from 'react';

interface CompRegion {
	readonly id: string;
	readonly startSample: number;
	readonly endSample: number;
}

export function compSharedBoundaries(regions: readonly CompRegion[]) {
	return regions.flatMap((left, index) => {
		const right = regions[index + 1];
		return right && left.endSample === right.startSample ? [{
			leftRegionId: left.id, rightRegionId: right.id, boundarySample: left.endSample,
		}] : [];
	});
}

export function useCompBoundaries(regions: readonly CompRegion[]) {
	return useMemo(() => compSharedBoundaries(regions), [regions]);
}

