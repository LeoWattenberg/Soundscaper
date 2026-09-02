/* SPDX-License-Identifier: AGPL-3.0-only */

import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';

import type { SignatureMap } from '../../musical-grid.ts';
import { resolveSequenceTimingView, type SequenceTimingView } from '../../sequence-timing-model.ts';
import type { HoldTempoMap } from '../../timeline-time.ts';
import { createMusicalRulerTicks, usesMusicalMapRuler } from './musical-ruler-model.ts';
import { createSequenceRulerTicks, usesSequenceTimecodeDisplay } from './sequence-ruler-model.ts';

/**
 * Which ruler the timeline shows, resolved once so the ruler canvas and the
 * grid lines behind the tracks can never disagree about where a tick sits.
 */
export type TimelineRulerScale =
	| Readonly<{ kind: 'minutes-seconds' }>
	| Readonly<{ kind: 'beats-measures'; bpm: number; beatsPerMeasure: number }>
	| Readonly<{ kind: 'musical-map'; tempoMap: HoldTempoMap; signatureMap: SignatureMap }>
	| Readonly<{ kind: 'timecode'; view: SequenceTimingView }>;

export interface TimelineGridLine {
	/** Whole CSS pixels from the left edge of the ruler viewport. */
	readonly x: number;
	readonly major: boolean;
}

export interface TimelineGridLineOptions {
	readonly scale: TimelineRulerScale;
	readonly pixelsPerSecond: number;
	readonly scrollX: number;
	readonly viewportWidth: number;
	readonly sampleRate: number;
}

type LooseRecord<Fields> = Readonly<Fields> & Readonly<Record<string, unknown>>;

interface TimelineRulerProject extends Readonly<Record<string, unknown>> {
	readonly timeDisplay?: LooseRecord<{ readonly format?: unknown }>;
	readonly tempo?: LooseRecord<{
		readonly bpm?: unknown;
		readonly timeSignature?: LooseRecord<{ readonly numerator?: unknown }>;
	}>;
	readonly tempoMap?: LooseRecord<{ readonly events?: readonly unknown[] }>;
	readonly signatureMap?: LooseRecord<{ readonly events?: readonly unknown[] }>;
	readonly sequences?: readonly unknown[];
}

// Mirrors the vendored TimelineRuler's zoom table; the drift guard in
// tests/audio-editor-timeline-grid-model.test.ts reads that source to prove it.
const MAJOR_INTERVAL_TABLE: readonly (readonly [number, number])[] = Object.freeze([
	[20, 10], [50, 5], [100, 2], [200, 1], [500, 0.5],
	[1_000, 0.2], [2_000, 0.1], [5_000, 0.05], [10_000, 0.02],
]);
const FALLBACK_MAJOR_INTERVAL = 0.01;
const MINOR_TICKS_PER_MAJOR = 5;
const MEASURE_LABEL_INTERVALS = Object.freeze([1, 2, 4, 8, 16, 32, 64, 128, 256]);
const MINIMUM_MEASURE_LABEL_PIXELS = 60;
const MINIMUM_BEAT_TICK_PIXELS = 8;
const MINIMUM_MINOR_MEASURE_PIXELS = 6;

/** Pick the ruler for a project the same way the timeline picks its ruler canvas. */
export function resolveTimelineRulerScale(project: TimelineRulerProject): TimelineRulerScale {
	if (usesSequenceTimecodeDisplay(project)) {
		return Object.freeze({ kind: 'timecode' as const, view: resolveSequenceTimingView(project) });
	}
	if (usesMusicalMapRuler(project) && project.tempoMap?.events?.length && project.signatureMap?.events?.length) {
		return Object.freeze({
			kind: 'musical-map' as const,
			tempoMap: project.tempoMap as unknown as HoldTempoMap,
			signatureMap: project.signatureMap as unknown as SignatureMap,
		});
	}
	if (project.timeDisplay?.format === 'beats+measures') {
		const tempoEvent = project.tempoMap?.events?.[0] as Readonly<{ bpm?: unknown }> | undefined;
		const signatureEvent = project.signatureMap?.events?.[0] as Readonly<{ numerator?: unknown }> | undefined;
		const fallbackBpm = Number(project.tempo?.bpm) || 120;
		const signature = signatureEvent ?? project.tempo?.timeSignature;
		return Object.freeze({
			kind: 'beats-measures' as const,
			bpm: rationalValue(tempoEvent?.bpm, fallbackBpm),
			beatsPerMeasure: Number(signature?.numerator) || 4,
		});
	}
	return Object.freeze({ kind: 'minutes-seconds' as const });
}

/** Seconds between labelled ruler ticks at a zoom level, as the vendored ruler chooses them. */
export function timelineMajorInterval(pixelsPerSecond: number): number {
	for (const [threshold, interval] of MAJOR_INTERVAL_TABLE) {
		if (pixelsPerSecond < threshold) return interval;
	}
	return FALLBACK_MAJOR_INTERVAL;
}

/**
 * Every ruler tick visible in the viewport as a grid line, in viewport pixels.
 * Positions are floored exactly as the ruler floors its tick marks, so a line
 * drawn at `x + 0.5` shares its pixel column with the mark above it.
 */
export function createTimelineGridLines(options: TimelineGridLineOptions): readonly TimelineGridLine[] {
	const pixelsPerSecond = positiveFinite(options.pixelsPerSecond, 'pixelsPerSecond');
	const viewportWidth = positiveFinite(options.viewportWidth, 'viewportWidth');
	const scrollX = nonNegativeFinite(options.scrollX, 'scrollX');
	const sampleRate = positiveFinite(options.sampleRate, 'sampleRate');
	const lines: TimelineGridLine[] = [];
	const place = (x: number, major: boolean) => {
		if (x < CLIP_CONTENT_OFFSET || x > viewportWidth) return;
		const column = Math.floor(x);
		const previous = lines.at(-1);
		if (previous?.x === column) {
			if (major && !previous.major) lines[lines.length - 1] = Object.freeze({ x: column, major: true });
			return;
		}
		lines.push(Object.freeze({ x: column, major }));
	};
	const { scale } = options;
	if (scale.kind === 'minutes-seconds') {
		placeMinutesAndSeconds(place, pixelsPerSecond, scrollX, viewportWidth);
	} else if (scale.kind === 'beats-measures') {
		placeBeatsAndMeasures(place, scale, pixelsPerSecond, scrollX, viewportWidth);
	} else {
		const startFrame = Math.max(0, Math.floor(scrollX / pixelsPerSecond * sampleRate));
		const endFrame = Math.max(startFrame, Math.ceil((scrollX + viewportWidth) / pixelsPerSecond * sampleRate));
		const ticks = scale.kind === 'timecode'
			? createSequenceRulerTicks({
				view: scale.view,
				sampleRate,
				startFrame,
				endFrame,
				pixelsPerSample: pixelsPerSecond / sampleRate,
			})
			: createMusicalRulerTicks({
				tempoMap: scale.tempoMap,
				signatureMap: scale.signatureMap,
				sampleRate,
				startFrame,
				endFrame,
				pixelsPerFrame: pixelsPerSecond / sampleRate,
			});
		for (const tick of ticks) {
			place(CLIP_CONTENT_OFFSET + tick.frame / sampleRate * pixelsPerSecond - scrollX, tick.major);
		}
	}
	return Object.freeze(lines);
}

type PlaceLine = (x: number, major: boolean) => void;

function placeMinutesAndSeconds(place: PlaceLine, pixelsPerSecond: number, scrollX: number, width: number): void {
	const majorInterval = timelineMajorInterval(pixelsPerSecond);
	const minorInterval = majorInterval / MINOR_TICKS_PER_MAJOR;
	const startTime = Math.floor(scrollX / pixelsPerSecond / minorInterval) * minorInterval;
	const endTime = Math.ceil((scrollX + width) / pixelsPerSecond / minorInterval) * minorInterval;
	for (let time = startTime; time <= endTime; time += minorInterval) {
		const roundedTime = Math.round(time / minorInterval) * minorInterval;
		// The ruler labels a tick when its time is a whole number of major
		// intervals. Its bottom-half loop tests that with a floating modulo that
		// misses e.g. 0.15 % 0.05, so the labelled (top-half) rule is used here.
		const majorSteps = roundedTime / majorInterval;
		place(
			CLIP_CONTENT_OFFSET + roundedTime * pixelsPerSecond - scrollX,
			Math.abs(majorSteps - Math.round(majorSteps)) < 0.001,
		);
	}
}

function placeBeatsAndMeasures(
	place: PlaceLine,
	scale: Readonly<{ bpm: number; beatsPerMeasure: number }>,
	pixelsPerSecond: number,
	scrollX: number,
	width: number,
): void {
	const bpm = positiveFinite(scale.bpm, 'bpm');
	const beatsPerMeasure = positiveSafeInteger(scale.beatsPerMeasure, 'beatsPerMeasure');
	const secondsPerBeat = 60 / bpm;
	const secondsPerMeasure = secondsPerBeat * beatsPerMeasure;
	const pixelsPerBeat = secondsPerBeat * pixelsPerSecond;
	const subdivisionsPerBeat = pixelsPerBeat >= 160 ? 8 : pixelsPerBeat >= 80 ? 4 : pixelsPerBeat >= 40 ? 2 : 1;
	const secondsPerSubdivision = secondsPerBeat / subdivisionsPerBeat;
	const subdivisionsPerMeasure = beatsPerMeasure * subdivisionsPerBeat;
	const showBeatTicks = pixelsPerBeat >= MINIMUM_BEAT_TICK_PIXELS;
	const pixelsPerMeasure = secondsPerMeasure * pixelsPerSecond;
	const measureLabelInterval = MEASURE_LABEL_INTERVALS.find(
		(interval) => pixelsPerMeasure * interval >= MINIMUM_MEASURE_LABEL_PIXELS,
	) ?? 1;
	const showMinorMeasureTicks = pixelsPerMeasure >= MINIMUM_MINOR_MEASURE_PIXELS;
	const startMeasure = Math.floor(scrollX / pixelsPerSecond / secondsPerMeasure);
	const endMeasure = Math.ceil((scrollX + width) / pixelsPerSecond / secondsPerMeasure);
	for (let measure = startMeasure; measure <= endMeasure; measure += 1) {
		const labeledMeasure = measure % measureLabelInterval === 0;
		if (!showMinorMeasureTicks && !labeledMeasure) continue;
		for (let sub = 0; sub < subdivisionsPerMeasure; sub += 1) {
			if (!showBeatTicks && sub !== 0) continue;
			const seconds = measure * secondsPerMeasure + sub * secondsPerSubdivision;
			place(CLIP_CONTENT_OFFSET + seconds * pixelsPerSecond - scrollX, sub === 0 && labeledMeasure);
		}
	}
}

function rationalValue(value: unknown, fallback: number): number {
	const rational = value as Readonly<{ num?: unknown; den?: unknown }> | undefined;
	const numerator = Number(rational?.num);
	const denominator = Number(rational?.den);
	return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
		? numerator / denominator
		: fallback;
}

function positiveFinite(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}

function nonNegativeFinite(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0) throw new RangeError(`${name} must not be negative.`);
	return number;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}
