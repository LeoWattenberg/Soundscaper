/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_SAMPLE_RATE } from '../project.js';
import {
	surroundingBarBoundaries,
	type SignatureMap,
} from '../musical-grid.ts';
import { sampleFrameToBeat } from '../timeline-tempo-inverse.ts';
import {
	addRationals,
	beatToSampleFrame,
	divideRationals,
	multiplyRationals,
	normalizeRational,
	roundRational,
	subtractRationals,
	type HoldTempoMap,
	type Rational,
} from '../timeline-time.ts';

export interface AudioEditorMetronomeScheduleOptions {
	/** Legacy event-zero tempo input retained for callers without a current project. */
	readonly bpm?: unknown;
	readonly tempoMap?: unknown;
	readonly signatureMap?: unknown;
	readonly timeSignature?: unknown;
	readonly sampleRate: unknown;
	readonly positionFrame?: unknown;
	readonly playbackRate?: unknown;
}

export type AudioEditorMetronomeAccent = 'bar' | 'group' | 'beat';

export interface AudioEditorMetronomeSchedule {
	readonly beatIndex: number;
	readonly delaySeconds: number;
	readonly beatDurationSeconds: number;
	/** Present for authoritative-map calls; omitted for the legacy bpm-only API. */
	readonly barIndex?: number;
	readonly pulseIndex?: number;
	readonly accent?: AudioEditorMetronomeAccent;
}

export interface AudioEditorCountInOptions {
	readonly tempoMap?: unknown;
	readonly signatureMap?: unknown;
	readonly bpm?: unknown;
	readonly timeSignature?: unknown;
	readonly sampleRate: unknown;
	readonly positionFrame: unknown;
	readonly measureCount?: unknown;
}

interface SignatureEvent {
	readonly bar: number;
	readonly numerator: number;
	readonly denominator: number;
}

interface SignatureSegment extends SignatureEvent {
	readonly pulseOffset: number;
}

interface SignatureGrid {
	readonly map: SignatureMap;
	readonly segments: readonly SignatureSegment[];
}

interface SignaturePosition {
	readonly segment: SignatureSegment;
	readonly barIndex: number;
	readonly barStartBeat: Rational;
	readonly pulseLength: Rational;
}

interface MetronomePulse extends SignaturePosition {
	readonly beat: Rational;
	readonly beatIndex: number;
	readonly pulseIndex: number;
	readonly accent: AudioEditorMetronomeAccent;
}

/**
 * Resolve the enclosing denominator pulse through the authoritative musical
 * maps. Every frame conversion is evaluated from the absolute map origin, so a
 * tempo transition changes the adjacent interval without accumulating drift.
 */
export function calculateAudioEditorMetronomeSchedule({
	bpm,
	tempoMap,
	signatureMap,
	timeSignature,
	sampleRate,
	positionFrame = 0,
	playbackRate = 1,
}: AudioEditorMetronomeScheduleOptions): Readonly<AudioEditorMetronomeSchedule> {
	const normalizedSampleRate = normalizedSampleRateValue(sampleRate);
	const normalizedPosition = normalizedFrame(positionFrame, 'positionFrame');
	const normalizedPlaybackRate = positiveFiniteOr(playbackRate, 1);
	const detailedSchedule = tempoMap != null || signatureMap != null || timeSignature != null;
	const normalizedTempoMap = holdTempoMap(tempoMap, bpm);
	const signatureGrid = normalizedSignatureGrid(signatureMap, timeSignature);
	const positionBeat = sampleFrameToBeat(normalizedPosition, normalizedTempoMap, normalizedSampleRate);
	const pulse = pulseAtOrAfter(positionBeat, signatureGrid);
	const nextPulseBeat = addRationals(pulse.beat, pulse.pulseLength);
	const nextBeatFrame = beatToSampleFrame(pulse.beat, normalizedTempoMap, normalizedSampleRate, 'point');
	const followingBeatFrame = beatToSampleFrame(nextPulseBeat, normalizedTempoMap, normalizedSampleRate, 'point');
	const schedule = {
		beatIndex: pulse.beatIndex,
		delaySeconds: Math.max(
			0,
			(nextBeatFrame - normalizedPosition) / (normalizedSampleRate * normalizedPlaybackRate),
		),
		beatDurationSeconds: Math.max(
			0,
			(followingBeatFrame - nextBeatFrame) / (normalizedSampleRate * normalizedPlaybackRate),
		),
	};
	return Object.freeze(detailedSchedule ? {
		...schedule,
		barIndex: pulse.barIndex,
		pulseIndex: pulse.pulseIndex,
		accent: pulse.accent,
	} : schedule);
}

/** Resolve a whole count-in once through the maps and round only its endpoints. */
export function calculateAudioEditorCountInFrames({
	tempoMap,
	signatureMap,
	bpm,
	timeSignature,
	sampleRate,
	positionFrame,
	measureCount = 1,
}: AudioEditorCountInOptions): number {
	const normalizedSampleRate = normalizedSampleRateValue(sampleRate);
	const normalizedPosition = normalizedFrame(positionFrame, 'positionFrame');
	const measures = nonNegativeSafeInteger(measureCount, 'measureCount');
	if (!measures) return 0;
	const normalizedTempoMap = holdTempoMap(tempoMap, bpm);
	const signatureGrid = normalizedSignatureGrid(signatureMap, timeSignature);
	const positionBeat = sampleFrameToBeat(normalizedPosition, normalizedTempoMap, normalizedSampleRate);
	const signature = signaturePosition(positionBeat, signatureGrid).segment;
	const measureBeats = multiplyRationals(barLength(signature), measures);
	const startBeat = subtractRationals(positionBeat, measureBeats);
	const startFrame = beatToSampleFrame(startBeat, normalizedTempoMap, normalizedSampleRate, 'point');
	const duration = normalizedPosition - startFrame;
	if (!Number.isSafeInteger(duration) || duration < 0) {
		throw new RangeError('The count-in duration is outside the safe frame domain.');
	}
	return duration;
}

function pulseAtOrAfter(beat: Rational, grid: SignatureGrid): MetronomePulse {
	const position = signaturePosition(beat, grid);
	const pulseOffset = divideRationals(subtractRationals(beat, position.barStartBeat), position.pulseLength);
	const nextPulseIndex = roundRational(pulseOffset.num, pulseOffset.den, 'directional', 'next');
	const candidateBeat = addRationals(
		position.barStartBeat,
		multiplyRationals(position.pulseLength, nextPulseIndex),
	);
	const candidate = signaturePosition(candidateBeat, grid);
	const candidateOffset = divideRationals(
		subtractRationals(candidateBeat, candidate.barStartBeat),
		candidate.pulseLength,
	);
	const pulseIndex = roundRational(candidateOffset.num, candidateOffset.den, 'point');
	const beatIndex = safeAdd(
		candidate.segment.pulseOffset,
		safeAdd(
			safeMultiply(candidate.barIndex - candidate.segment.bar, candidate.segment.numerator, 'metronome pulse index'),
			pulseIndex,
			'metronome pulse index',
		),
		'metronome pulse index',
	);
	return Object.freeze({
		...candidate,
		beat: candidateBeat,
		beatIndex,
		pulseIndex,
		accent: metronomeAccent(candidate.segment, pulseIndex),
	});
}

function signaturePosition(beat: Rational, grid: SignatureGrid): SignaturePosition {
	const boundaries = surroundingBarBoundaries(beat, grid.map);
	let active = grid.segments[0];
	for (let index = 1; index < grid.segments.length; index += 1) {
		if (grid.segments[index].bar > boundaries.lowerBar) break;
		active = grid.segments[index];
	}
	return Object.freeze({
		segment: active,
		barIndex: boundaries.lowerBar,
		barStartBeat: boundaries.lowerBeat,
		pulseLength: denominatorPulseLength(active),
	});
}

function normalizedSignatureGrid(value: unknown, legacySignature?: unknown): SignatureGrid {
	const events = signatureEvents(value, legacySignature);
	const result: SignatureSegment[] = [];
	for (const [index, event] of events.entries()) {
		if (!index) {
			result.push(Object.freeze({ ...event, pulseOffset: 0 }));
			continue;
		}
		const previous = result[index - 1];
		const barCount = event.bar - previous.bar;
		result.push(Object.freeze({
			...event,
			pulseOffset: safeAdd(
				previous.pulseOffset,
				safeMultiply(barCount, previous.numerator, 'signature pulse offset'),
				'signature pulse offset',
			),
		}));
	}
	return Object.freeze({
		map: Object.freeze({ events }),
		segments: Object.freeze(result),
	});
}

function signatureEvents(value: unknown, legacySignature?: unknown): readonly SignatureEvent[] {
	let rawEvents: readonly unknown[];
	if (value == null) {
		const legacy = isRecord(legacySignature) ? legacySignature : {};
		rawEvents = [{
			bar: 0,
			numerator: positiveSafeIntegerOr(legacy.numerator, 4),
			denominator: positiveSafeIntegerOr(legacy.denominator, 4),
		}];
	} else {
		if (!isRecord(value) || !Array.isArray(value.events) || !value.events.length) {
			throw new TypeError('An authoritative signature map requires a non-empty event list.');
		}
		rawEvents = value.events;
	}
	let previousBar = -1;
	const events = rawEvents.map((candidate, index) => {
		if (!isRecord(candidate)) throw new TypeError(`signatureMap.events[${String(index)}] must be an object.`);
		const event = Object.freeze({
			bar: nonNegativeSafeInteger(candidate.bar, `signatureMap.events[${String(index)}].bar`),
			numerator: positiveSafeInteger(candidate.numerator, `signatureMap.events[${String(index)}].numerator`),
			denominator: positiveSafeInteger(candidate.denominator, `signatureMap.events[${String(index)}].denominator`),
		});
		if (!index && event.bar !== 0) throw new RangeError('The first signature event must begin at bar zero.');
		if (index && event.bar <= previousBar) throw new RangeError('Signature event bars must be strictly increasing.');
		if (!isPowerOfTwo(event.denominator)) throw new RangeError('A signature denominator must be a power of two.');
		previousBar = event.bar;
		return event;
	});
	return Object.freeze(events);
}

function holdTempoMap(value: unknown, legacyBpm: unknown): HoldTempoMap {
	if (value != null) {
		if (!isRecord(value) || !Array.isArray(value.events)) throw new TypeError('An authoritative tempo map is required.');
		return value as unknown as HoldTempoMap;
	}
	return Object.freeze({
		mode: 'musical',
		events: Object.freeze([Object.freeze({
			beat: Object.freeze({ num: 0, den: 1 }),
			bpm: normalizeRational(positiveFiniteOr(legacyBpm, 120)),
		})]),
	});
}

function barLength(signature: SignatureEvent): Rational {
	return normalizeRational({
		num: safeMultiply(signature.numerator, 4, 'signature bar length'),
		den: signature.denominator,
	}, { maximumDenominator: Number.MAX_SAFE_INTEGER });
}

function denominatorPulseLength(signature: SignatureEvent): Rational {
	return normalizeRational({ num: 4, den: signature.denominator }, {
		maximumDenominator: Number.MAX_SAFE_INTEGER,
	});
}

function metronomeAccent(signature: SignatureEvent, pulseIndex: number): AudioEditorMetronomeAccent {
	if (pulseIndex === 0) return 'bar';
	if (signature.numerator > 3 && signature.numerator % 3 === 0 && pulseIndex % 3 === 0) return 'group';
	return 'beat';
}

function normalizedSampleRateValue(value: unknown): number {
	const sampleRate = Number(value);
	return Number.isSafeInteger(sampleRate) && sampleRate > 0 ? sampleRate : AUDIO_EDITOR_SAMPLE_RATE;
}

function normalizedFrame(value: unknown, name: string): number {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return 0;
	const frame = Math.max(0, Math.round(numeric));
	if (!Number.isSafeInteger(frame)) throw new RangeError(`${name} must be a safe frame position.`);
	return frame;
}

function positiveFiniteOr(value: unknown, fallback: number): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function positiveSafeIntegerOr(value: unknown, fallback: number): number {
	const numeric = Number(value);
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	const numeric = Number(value);
	if (!Number.isSafeInteger(numeric) || numeric < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return numeric;
}

function positiveSafeInteger(value: unknown, name: string): number {
	const numeric = Number(value);
	if (!Number.isSafeInteger(numeric) || numeric <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return numeric;
}

function isPowerOfTwo(value: number): boolean {
	const bits = BigInt(value);
	return (bits & (bits - 1n)) === 0n;
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} is outside the safe integer domain.`);
	return result;
}

function safeMultiply(left: number, right: number, name: string): number {
	const result = left * right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} is outside the safe integer domain.`);
	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
