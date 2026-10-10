/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TimeCodeMusicalMap } from '../../../../vendor/audacity-design-system/components/src/TimeCode/time-code-musical-context.ts';
import { barStartBeat, surroundingBarBoundaries, type SignatureEvent, type SignatureMap } from '../musical-grid.ts';
import { sampleFrameToBeat } from '../timeline-tempo-inverse.ts';
import { addRationals, beatToSampleFrame, divideRationals, sampleFrameToSeconds,
	secondsToSampleFrame, subtractRationals, type HoldTempoMap } from '../timeline-time.ts';
import type { RationalInput } from '../timeline-time.ts';

export interface MusicalTimeCodeProject {
	readonly sampleRate: number;
	readonly tempoMap: HoldTempoMap;
	readonly signatureMap: SignatureMap;
}

export function createMusicalTimeCodeMap(project: MusicalTimeCodeProject): TimeCodeMusicalMap {
	return {
		fromSeconds(seconds) {
			const quarterBeat = sampleFrameToBeat(secondsToSampleFrame(Math.max(0, seconds), project.sampleRate),
				project.tempoMap, project.sampleRate);
			return positionAtBeat(quarterBeat, project.signatureMap);
		},
		toSeconds(bar, beat) {
			const signature = signatureAtBar(bar, project.signatureMap);
			const quarterBeat = addRationals(barStartBeat(bar, project.signatureMap),
				{ num: Math.max(0, beat - 1) * 4, den: signature.denominator });
			return sampleFrameToSeconds(beatToSampleFrame(quarterBeat, project.tempoMap, project.sampleRate), project.sampleRate);
		},
	};
}

/** A duration counts musical units from its insertion, rather than project zero. */
export function createMusicalDurationTimeCodeMap(project: MusicalTimeCodeProject, originFrame: number): TimeCodeMusicalMap {
	const origin = Math.max(0, Math.round(originFrame));
	const originBeat = sampleFrameToBeat(origin, project.tempoMap, project.sampleRate);
	const originBar = surroundingBarBoundaries(originBeat, project.signatureMap).lowerBar;
	const signatures: SignatureMap = { events: [
		{ ...signatureAtBar(originBar, project.signatureMap), bar: 0 },
		...project.signatureMap.events.filter(event => event.bar > originBar)
			.map(event => ({ ...event, bar: event.bar - originBar })),
	] };
	return {
		fromSeconds(seconds) {
			const elapsed = secondsToSampleFrame(Math.max(0, seconds), project.sampleRate);
			const endBeat = sampleFrameToBeat(origin + elapsed, project.tempoMap, project.sampleRate);
			return positionAtBeat(subtractRationals(endBeat, originBeat), signatures);
		},
		toSeconds(bar, beat) {
			const signature = signatureAtBar(bar, signatures);
			const elapsedBeat = addRationals(barStartBeat(bar, signatures),
				{ num: Math.max(0, beat - 1) * 4, den: signature.denominator });
			const end = beatToSampleFrame(addRationals(originBeat, elapsedBeat), project.tempoMap, project.sampleRate);
			return sampleFrameToSeconds(end - origin, project.sampleRate);
		},
	};
}

function signatureAtBar(bar: number, map: SignatureMap): SignatureEvent {
	let signature: SignatureEvent | undefined;
	for (const event of map.events) {
		if (event.bar > bar) break;
		signature = event;
	}
	if (!signature) throw new RangeError('The musical display requires an initial time signature.');
	return signature;
}

function positionAtBeat(quarterBeat: RationalInput, signatures: SignatureMap) {
	const bars = surroundingBarBoundaries(quarterBeat, signatures);
	const signature = signatureAtBar(bars.lowerBar, signatures);
	const beats = divideRationals(subtractRationals(quarterBeat, bars.lowerBeat),
		{ num: 4, den: signature.denominator });
	return { bar: bars.lowerBar, beat: Math.floor(beats.num / beats.den) + 1,
		beatsPerBar: signature.numerator };
}
