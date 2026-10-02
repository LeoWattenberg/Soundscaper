/* SPDX-License-Identifier: AGPL-3.0-only */

import { barStartBeat, type SignatureMap } from '../../musical-grid.ts';
import { sampleFrameToBeat } from '../../timeline-tempo-inverse.ts';
import { addRationals, beatToSampleFrame, compareRationals, divideRationals, multiplyRationals, roundRational, subtractRationals, type HoldTempoMap, type Rational } from '../../timeline-time.ts';
import { sourceRulerTicks } from './clip-source-view.ts';

export interface ClipSourceRulerTickOptions {
	readonly tempoMap: HoldTempoMap;
	readonly signatureMap?: SignatureMap;
	readonly sampleRate: number;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly clipStartFrame: number;
	readonly projectStartFrame: number;
	readonly width: number;
	readonly global: boolean;
	readonly beats: boolean;
}
export interface ClipSourceRulerTick { readonly frame: number; readonly label: string }
interface SignatureSection {
	readonly origin: Rational;
	readonly bar: number;
	readonly measure: Rational;
	readonly lower: number;
	readonly upper: number;
}

/** Musical labels change origin; the project's tempo still determines every tick's sample. */
export function createClipSourceRulerTicks(options: ClipSourceRulerTickOptions): readonly ClipSourceRulerTick[] {
	const offset = options.projectStartFrame - options.clipStartFrame;
	if (!options.beats || !options.signatureMap) return sourceRulerTicks({ ...options, originFrame: (options.global ? options.projectStartFrame : 0) - options.clipStartFrame });
	const origin = options.global ? { num: 0, den: 1 } : projectBeat(options.projectStartFrame, options);
	const start = subtractRationals(projectBeat(options.startFrame + offset, options), origin);
	const end = subtractRationals(projectBeat(options.endFrame + offset, options), origin);
	const sections = signatureSections(origin, options.signatureMap);
	const ticks = new Map<number, ClipSourceRulerTick>();
	for (const section of sections) {
		const lower = Math.max(numberOf(start), section.lower);
		const upper = Math.min(numberOf(end), section.upper);
		if (upper < lower) continue;
		const measure = numberOf(section.measure);
		const first = Math.ceil((lower - numberOf(section.origin)) / measure);
		const last = Math.floor((upper - numberOf(section.origin)) / measure);
		const stride = Math.max(1, Math.ceil((last - first + 1) / Math.max(1, options.width / 64)));
		for (let index = Math.ceil(first / stride) * stride; index <= last && ticks.size < 4096; index += stride) {
			const relative = addRationals(section.origin, multiplyRationals(index, section.measure));
			if (numberOf(relative) >= section.upper) continue;
			const frame = beatToSampleFrame(addRationals(origin, relative), options.tempoMap, options.sampleRate, 'point') - offset;
			if (frame < options.startFrame || frame > options.endFrame) continue;
			ticks.set(frame, Object.freeze({ frame, label: String(section.bar + index + 1) }));
		}
	}
	return Object.freeze([...ticks.values()].sort((left, right) => left.frame - right.frame));
}

/** A signature event may end a partial local bar; its real project instant is retained. */
function signatureSections(origin: Rational, map: SignatureMap): readonly SignatureSection[] {
	const events = map.events.map((event) => ({
		beat: subtractRationals(barStartBeat(event.bar, map), origin),
		measure: { num: event.numerator * 4, den: event.denominator },
	}));
	let active = 0;
	for (let index = 1; index < events.length; index += 1) {
		if (compareRationals(events[index]!.beat, 0) > 0) break;
		active = index;
	}
	const sections: SignatureSection[] = [];
	let at: Rational = { num: 0, den: 1 };
	let bar = 0;
	for (let index = active; index < events.length; index += 1) {
		const measure = events[index]!.measure;
		const next = events[index + 1]?.beat;
		sections.push({ origin: at, bar, measure, lower: numberOf(at), upper: next ? numberOf(next) : Number.POSITIVE_INFINITY });
		if (!next) break;
		bar += ceiling(divideRationals(subtractRationals(next, at), measure));
		at = next;
	}
	at = { num: 0, den: 1 };
	bar = 0;
	for (let index = active; index >= 0; index -= 1) {
		const measure = events[index]!.measure;
		const previous = index > 0 ? events[index]!.beat : null;
		sections.push({ origin: at, bar, measure, lower: previous ? numberOf(previous) : Number.NEGATIVE_INFINITY, upper: numberOf(at) });
		if (!previous) break;
		bar -= ceiling(divideRationals(subtractRationals(at, previous), measure));
		at = previous;
	}
	return sections;
}

function projectBeat(frame: number, options: ClipSourceRulerTickOptions): Rational {
	if (frame >= 0) return sampleFrameToBeat(Math.round(frame), options.tempoMap, options.sampleRate);
	const first = options.tempoMap.events[0];
	if (!first) throw new RangeError('A source ruler requires a project tempo.');
	return divideRationals(multiplyRationals(Math.round(frame), first.bpm), 60 * options.sampleRate);
}
function ceiling(value: Rational): number { return roundRational(value.num, value.den, 'directional', 'next'); }
function numberOf(value: Rational): number { return value.num / value.den; }
