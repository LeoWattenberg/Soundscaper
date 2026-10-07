/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ClipLoop } from '../../audio-clip-loop.ts';
import type { ProjectBinRange } from './project-bin-model.ts';

/** Draw the audible sequence of periods rather than stretching one source pass. */
export function projectBinLoopRanges(
	period: readonly ProjectBinRange[],
	loop: ClipLoop,
	durationFrames: number,
	maximumColumns: number,
): ProjectBinRange[] {
	if (period.length === 0) return [];
	const columns = Math.max(1, Math.min(maximumColumns, durationFrames));
	const ranges: ProjectBinRange[] = [];
	for (let column = 0; column < columns; column += 1) {
		const start = loop.offsetFrames + column * durationFrames / columns;
		const end = loop.offsetFrames + (column + 1) * durationFrames / columns;
		let minimum = 1;
		let maximum = -1;
		const collect = (from: number, to: number): void => {
			const first = Math.min(period.length - 1, Math.floor(from * period.length / loop.periodFrames));
			const last = Math.min(period.length, Math.max(first + 1, Math.ceil(to * period.length / loop.periodFrames)));
			for (let index = first; index < last; index += 1) {
				const range = period[index]!;
				minimum = Math.min(minimum, range.minimum);
				maximum = Math.max(maximum, range.maximum);
			}
		};
		if (end - start >= loop.periodFrames) collect(0, loop.periodFrames);
		else {
			const phaseStart = start % loop.periodFrames;
			const phaseEnd = phaseStart + end - start;
			collect(phaseStart, Math.min(phaseEnd, loop.periodFrames));
			if (phaseEnd > loop.periodFrames) collect(0, phaseEnd - loop.periodFrames);
		}
		ranges.push({ minimum, maximum });
	}
	return ranges;
}
