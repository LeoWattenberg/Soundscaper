/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TimeCodeMusicalMap } from './time-code-musical-context';

/** Step by the previous actual beat while retaining a value's sub-beat phase. */
export function timeCodePreviousMusicalBeat(value: number, map?: TimeCodeMusicalMap): number {
	if (!map) return Math.max(0, value - 0.5);
	const position = map.fromSeconds(value);
	const bar = position.beat > 1 ? position.bar : position.bar - 1;
	if (bar < 0) return 0;
	const beat = position.beat > 1 ? position.beat - 1
		: map.fromSeconds(map.toSeconds(bar, 1)).beatsPerBar;
	return Math.max(0, value + map.toSeconds(bar, beat) - map.toSeconds(position.bar, position.beat));
}
