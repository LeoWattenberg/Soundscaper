/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	barStartBeat,
	surroundingBarBoundaries,
	type SignatureEvent,
	type SignatureMap,
} from '../../musical-grid.ts';
import { createMonotonicBeatFrameProjector } from '../../monotonic-tempo-projector.ts';
import { sampleFrameToBeat } from '../../timeline-tempo-inverse.ts';
import {
	addRationals,
	compareRationals,
	multiplyRationals,
	normalizeRational,
	type HoldTempoMap,
	type Rational,
} from '../../timeline-time.ts';

const MAXIMUM_TICKS = 8_192;
const MAXIMUM_MAJOR_TICKS = 4_096;
const MINIMUM_MINOR_TICK_PIXELS = 4;

export interface MusicalRulerTick {
	readonly frame: number;
	readonly bar: number;
	readonly beat: number;
	readonly major: boolean;
	readonly label: string;
}

export interface MusicalRulerTickOptions {
	readonly tempoMap: HoldTempoMap;
	readonly signatureMap: SignatureMap;
	readonly sampleRate: number;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly pixelsPerFrame?: number;
}

interface MusicalRulerProject {
	readonly timeDisplay?: Readonly<{ readonly format?: unknown }>;
	readonly tempoMap?: Readonly<{ readonly events?: readonly unknown[] }>;
	readonly signatureMap?: Readonly<{ readonly events?: readonly unknown[] }>;
}

/** Select the map-aware renderer only for a changing musical-format ruler. */
export function usesMusicalMapRuler(project: MusicalRulerProject): boolean {
	const rootDenominator = Number((project.signatureMap?.events?.[0] as { denominator?: unknown } | undefined)?.denominator);
	return project.timeDisplay?.format === 'beats+measures'
		&& (rootDenominator !== 4
			|| (project.tempoMap?.events?.length ?? 0) > 1
			|| (project.signatureMap?.events?.length ?? 0) > 1);
}

/** Build a bounded viewport-local ruler directly from authoritative maps. */
export function createMusicalRulerTicks(options: MusicalRulerTickOptions): readonly MusicalRulerTick[] {
	const sampleRate = positiveSafeInteger(options.sampleRate, 'sampleRate');
	const startFrame = nonNegativeSafeInteger(options.startFrame, 'startFrame');
	const endFrame = nonNegativeSafeInteger(options.endFrame, 'endFrame');
	if (endFrame < startFrame) throw new RangeError('endFrame cannot precede startFrame.');
	const pixelsPerFrame = options.pixelsPerFrame === undefined
		? Number.POSITIVE_INFINITY
		: positiveFinite(options.pixelsPerFrame, 'pixelsPerFrame');
	const startBeat = sampleFrameToBeat(startFrame, options.tempoMap, sampleRate);
	const endBeat = sampleFrameToBeat(endFrame, options.tempoMap, sampleRate);
	const firstBar = Math.max(0, surroundingBarBoundaries(startBeat, options.signatureMap).lowerBar);
	const lastBar = Math.max(firstBar, surroundingBarBoundaries(endBeat, options.signatureMap).lowerBar);
	const barCount = lastBar - firstBar + 1;
	const barStride = Math.max(1, Math.ceil(barCount / MAXIMUM_MAJOR_TICKS));
	const alignedFirstBar = Math.floor(firstBar / barStride) * barStride;
	const projectBeat = createMonotonicBeatFrameProjector(options.tempoMap, sampleRate);
	const ticks: MusicalRulerTick[] = [];
	let previousFrame = -1;
	let cursorBar = alignedFirstBar;
	let barBeat = barStartBeat(alignedFirstBar, options.signatureMap);
	let signatureIndex = signatureIndexAtBar(alignedFirstBar, options.signatureMap);
	let signature = options.signatureMap.events[signatureIndex]!;
	const slowestTempo = slowestTempoBpm(options.tempoMap, startBeat, endBeat);
	for (let bar = alignedFirstBar; bar <= lastBar && ticks.length < MAXIMUM_TICKS; bar += barStride) {
		const barFrame = projectBeat(barBeat);
		if (barFrame >= startFrame && barFrame <= endFrame && barFrame > previousFrame) {
			ticks.push(Object.freeze({ frame: barFrame, bar, beat: 0, major: true, label: String(bar + 1) }));
			previousFrame = barFrame;
		}
		if (barStride === 1 && minorPulsesMayBeVisible(
			signature.denominator,
			slowestTempo,
			sampleRate,
			pixelsPerFrame,
		)) {
			const beatStep = normalizeRational({ num: 4, den: signature.denominator });
			for (let beat = 1; beat < signature.numerator && ticks.length < MAXIMUM_TICKS; beat += 1) {
				const position = addRationals(barBeat, multiplyRationals(beat, beatStep));
				const frame = projectBeat(position);
				if (frame < startFrame || frame > endFrame || frame <= previousFrame) continue;
				if ((frame - previousFrame) * pixelsPerFrame < MINIMUM_MINOR_TICK_PIXELS) continue;
				ticks.push(Object.freeze({ frame, bar, beat, major: false, label: `${String(bar + 1)}.${String(beat + 1)}` }));
				previousFrame = frame;
			}
		}
		const nextBar = bar + barStride;
		while (signatureIndex + 1 < options.signatureMap.events.length
			&& options.signatureMap.events[signatureIndex + 1]!.bar <= nextBar) {
			const nextSignature = options.signatureMap.events[++signatureIndex]!;
			barBeat = addRationals(barBeat, multiplyRationals(
				nextSignature.bar - cursorBar,
				measureBeats(signature),
			));
			cursorBar = nextSignature.bar;
			signature = nextSignature;
		}
		barBeat = addRationals(barBeat, multiplyRationals(nextBar - cursorBar, measureBeats(signature)));
		cursorBar = nextBar;
	}
	return Object.freeze(ticks);
}

function slowestTempoBpm(map: HoldTempoMap, startBeat: Rational, endBeat: Rational): Rational {
	const root = map.events[0]?.bpm;
	if (!root) throw new TypeError('A tempo map is required.');
	let slowest = root;
	for (const event of map.events) {
		if (compareRationals(event.beat, startBeat) <= 0) {
			slowest = event.bpm;
			continue;
		}
		if (compareRationals(event.beat, endBeat) > 0) break;
		if (compareRationals(event.bpm, slowest) < 0) slowest = event.bpm;
	}
	return slowest;
}

function minorPulsesMayBeVisible(
	denominator: number,
	slowestTempo: Rational,
	sampleRate: number,
	pixelsPerFrame: number,
): boolean {
	if (!Number.isFinite(pixelsPerFrame)) return true;
	const pulseBeats = 4 / denominator;
	const slowestBpm = slowestTempo.num / slowestTempo.den;
	const maximumPulseFrames = sampleRate * 60 * pulseBeats / slowestBpm;
	const maximumPixels = maximumPulseFrames * pixelsPerFrame;
	return !Number.isFinite(maximumPixels)
		|| maximumPixels >= MINIMUM_MINOR_TICK_PIXELS * (1 - Number.EPSILON * 8);
}

function signatureIndexAtBar(bar: number, map: SignatureMap): number {
	let activeIndex = 0;
	if (!map.events[0]) throw new TypeError('A signature map is required.');
	for (let index = 1; index < map.events.length; index += 1) {
		if (map.events[index]!.bar > bar) break;
		activeIndex = index;
	}
	return activeIndex;
}

function measureBeats(signature: SignatureEvent): Rational {
	return normalizeRational({ num: signature.numerator * 4, den: signature.denominator });
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function positiveFinite(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}
