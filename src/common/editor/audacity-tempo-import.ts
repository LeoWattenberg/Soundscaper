/* SPDX-License-Identifier: AGPL-3.0-only */

import { approximatePositiveRational } from './rational-approximation.ts';

/** Canonicalize Audacity's lossy scalar tempo at the project-import boundary. */
export function canonicalAudacityMusicalRoot(
	bpm: number,
	timeSignature?: unknown,
): Readonly<Record<string, unknown>> {
	return {
		tempo: {
			bpm,
			...(timeSignature === undefined ? {} : { timeSignature: structuredClone(timeSignature) }),
		},
		tempoMap: { mode: 'musical', events: [{
			id: 'tempo-1', beat: { num: 0, den: 1 },
			bpm: approximatePositiveRational(bpm),
		}] },
	};
}
