/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TimeCodeMusicalMap } from '../../../../vendor/audacity-design-system/components/src/TimeCode/time-code-musical-context.ts';
import { barStartBeat, surroundingBarBoundaries, type SignatureEvent, type SignatureMap } from '../musical-grid.ts';
import { sampleFrameToBeat } from '../timeline-tempo-inverse.ts';
import { addRationals, beatToSampleFrame, divideRationals, sampleFrameToSeconds,
	secondsToSampleFrame, subtractRationals, type HoldTempoMap } from '../timeline-time.ts';

export interface MusicalTimeCodeProject {
	readonly sampleRate: number;
	readonly tempoMap: HoldTempoMap;
	readonly signatureMap: SignatureMap;
}

export function createMusicalTimeCodeMap(project: MusicalTimeCodeProject): TimeCodeMusicalMap {
	const signatureAtBar = (bar: number) => {
		let signature: SignatureEvent | undefined;
		for (const event of project.signatureMap.events) {
			if (event.bar > bar) break;
			signature = event;
		}
		if (!signature) throw new RangeError('The musical display requires an initial time signature.');
		return signature;
	};
	return {
		fromSeconds(seconds) {
			const quarterBeat = sampleFrameToBeat(secondsToSampleFrame(Math.max(0, seconds), project.sampleRate),
				project.tempoMap, project.sampleRate);
			const bars = surroundingBarBoundaries(quarterBeat, project.signatureMap);
			const signature = signatureAtBar(bars.lowerBar);
			const beats = divideRationals(subtractRationals(quarterBeat, bars.lowerBeat),
				{ num: 4, den: signature.denominator });
			return { bar: bars.lowerBar, beat: Math.floor(beats.num / beats.den) + 1,
				beatsPerBar: signature.numerator };
		},
		toSeconds(bar, beat) {
			const signature = signatureAtBar(bar);
			const quarterBeat = addRationals(barStartBeat(bar, project.signatureMap),
				{ num: Math.max(0, beat - 1) * 4, den: signature.denominator });
			return sampleFrameToSeconds(beatToSampleFrame(quarterBeat, project.tempoMap, project.sampleRate), project.sampleRate);
		},
	};
}
