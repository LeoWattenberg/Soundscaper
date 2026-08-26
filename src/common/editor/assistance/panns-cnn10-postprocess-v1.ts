/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic PANNs Cnn10 / AudioSet excitement postprocessing infrastructure. */

import {
	ASSISTANCE_AUDIO_TAG_SAMPLE_RATE,
	ASSISTANCE_AUDIO_TAG_WINDOW_SAMPLES,
	MAXIMUM_ASSISTANCE_AUDIO_TAG_WINDOWS,
	reviewAssistanceAudioTagsV1,
	type AssistanceAudioTagsV1,
	type AssistanceExcitementScoresV1,
} from './m7-semantic-results.ts';

export const ASSISTANCE_PANNS_CNN10_POSTPROCESS_SCHEMA_VERSION = 1 as const;
export const ASSISTANCE_PANNS_CNN10_AUDIOSET_CLASS_COUNT = 527 as const;
export const ASSISTANCE_PANNS_CNN10_MAXIMUM_WINDOWS = MAXIMUM_ASSISTANCE_AUDIO_TAG_WINDOWS;
export const ASSISTANCE_PANNS_CNN10_MAXIMUM_BINDINGS = 64;
export const ASSISTANCE_PANNS_CNN10_AGGREGATION = 'maximum' as const;

const REQUEST_FIELDS = Object.freeze([
	'schemaVersion', 'sampleRate', 'channelCount', 'windowSamples', 'classCount',
	'scoreKind', 'classBindings', 'windows',
] as const);
const BINDING_FIELDS = Object.freeze(['index', 'label', 'signal'] as const);
const WINDOW_FIELDS = Object.freeze(['startSample', 'scores'] as const);
const SIGNALS = Object.freeze(['laughter', 'applause', 'cheering'] as const);
const CONTROL = /[\u0000-\u001f\u007f]/u;

export type AssistancePannsCnn10ScoreKindV1 = 'logits' | 'probabilities';
export type AssistancePannsCnn10SignalV1 = typeof SIGNALS[number];

export interface AssistancePannsCnn10ClassBindingV1 {
	/** Exact zero-based position in the pinned ordered AudioSet class map. */
	readonly index: number;
	/** Exact label at that position in the pinned ordered AudioSet class map. */
	readonly label: string;
	readonly signal: AssistancePannsCnn10SignalV1;
}

export interface AssistancePannsCnn10WindowV1 {
	readonly startSample: number;
	readonly scores: Float32Array;
}

export interface AssistancePannsCnn10PostprocessRequestV1 {
	readonly schemaVersion: typeof ASSISTANCE_PANNS_CNN10_POSTPROCESS_SCHEMA_VERSION;
	readonly sampleRate: typeof ASSISTANCE_AUDIO_TAG_SAMPLE_RATE;
	readonly channelCount: 1;
	readonly windowSamples: typeof ASSISTANCE_AUDIO_TAG_WINDOW_SAMPLES;
	readonly classCount: typeof ASSISTANCE_PANNS_CNN10_AUDIOSET_CLASS_COUNT;
	readonly scoreKind: AssistancePannsCnn10ScoreKindV1;
	readonly classBindings: readonly AssistancePannsCnn10ClassBindingV1[];
	readonly windows: readonly AssistancePannsCnn10WindowV1[];
}

/**
 * Convert one Cnn10 vector per exact one-second window into the three admitted
 * excitement signals. Multiple pinned AudioSet labels use maximum aggregation,
 * avoiding order-dependent accumulation of correlated classes.
 */
export function createAssistancePannsCnn10AudioTagsV1(value: unknown): AssistanceAudioTagsV1 {
	const request = exactRecord(value, REQUEST_FIELDS, 'PANNs Cnn10 postprocess request');
	if (request.schemaVersion !== ASSISTANCE_PANNS_CNN10_POSTPROCESS_SCHEMA_VERSION) {
		throw new TypeError('The PANNs Cnn10 postprocess schema version is unsupported.');
	}
	if (request.sampleRate !== ASSISTANCE_AUDIO_TAG_SAMPLE_RATE) {
		throw new RangeError('PANNs Cnn10 audio must be exactly 32 kHz.');
	}
	if (request.channelCount !== 1) {
		throw new RangeError('PANNs Cnn10 audio must be exactly mono.');
	}
	if (request.windowSamples !== ASSISTANCE_AUDIO_TAG_WINDOW_SAMPLES) {
		throw new RangeError('PANNs Cnn10 requires exact one-second windows.');
	}
	if (request.classCount !== ASSISTANCE_PANNS_CNN10_AUDIOSET_CLASS_COUNT) {
		throw new RangeError('PANNs Cnn10 requires the exact 527-class AudioSet geometry.');
	}
	if (request.scoreKind !== 'logits' && request.scoreKind !== 'probabilities') {
		throw new TypeError('The PANNs Cnn10 score kind must be logits or probabilities.');
	}
	const bindings = classBindings(request.classBindings);
	const windows = modelWindows(request.windows, request.scoreKind, bindings);
	return reviewAssistanceAudioTagsV1({
		schemaVersion: 1,
		sampleRate: ASSISTANCE_AUDIO_TAG_SAMPLE_RATE,
		windowSamples: ASSISTANCE_AUDIO_TAG_WINDOW_SAMPLES,
		windows,
	});
}

function classBindings(value: unknown): readonly AssistancePannsCnn10ClassBindingV1[] {
	if (!Array.isArray(value) || value.length < SIGNALS.length
		|| value.length > ASSISTANCE_PANNS_CNN10_MAXIMUM_BINDINGS) {
		throw new RangeError('The PANNs Cnn10 class-binding authority exceeds its exact bound.');
	}
	let priorIndex = -1;
	const labels = new Set<string>();
	const covered = new Set<AssistancePannsCnn10SignalV1>();
	const result = value.map((candidate, bindingIndex): AssistancePannsCnn10ClassBindingV1 => {
		const label = `PANNs Cnn10 class binding ${String(bindingIndex)}`;
		const row = exactRecord(candidate, BINDING_FIELDS, label);
		const index = integer(row.index, 0, ASSISTANCE_PANNS_CNN10_AUDIOSET_CLASS_COUNT - 1,
			`${label} index`);
		if (index <= priorIndex) {
			throw new RangeError('PANNs Cnn10 class-binding indices must be strictly ordered.');
		}
		priorIndex = index;
		const labelText = boundedLabel(row.label, `${label} AudioSet label`);
		if (labels.has(labelText)) {
			throw new TypeError('PANNs Cnn10 class-binding labels must be unique.');
		}
		labels.add(labelText);
		if (!SIGNALS.includes(row.signal as AssistancePannsCnn10SignalV1)) {
			throw new TypeError(`${label} has an unsupported excitement signal.`);
		}
		const signal = row.signal as AssistancePannsCnn10SignalV1;
		covered.add(signal);
		return Object.freeze({ index, label: labelText, signal });
	});
	for (const signal of SIGNALS) {
		if (!covered.has(signal)) {
			throw new RangeError(`The PANNs Cnn10 authority must bind every signal, including ${signal}.`);
		}
	}
	return Object.freeze(result);
}

function modelWindows(
	value: unknown,
	scoreKind: AssistancePannsCnn10ScoreKindV1,
	bindings: readonly AssistancePannsCnn10ClassBindingV1[],
): AssistanceAudioTagsV1['windows'] {
	if (!Array.isArray(value) || value.length < 1
		|| value.length > ASSISTANCE_PANNS_CNN10_MAXIMUM_WINDOWS) {
		throw new RangeError('The PANNs Cnn10 window inventory exceeds its exact bound.');
	}
	let priorStart = -1;
	const windows = value.map((candidate, windowIndex) => {
		const label = `PANNs Cnn10 window ${String(windowIndex)}`;
		const row = exactRecord(candidate, WINDOW_FIELDS, label);
		const startSample = integer(row.startSample, 0, Number.MAX_SAFE_INTEGER,
			`${label} start sample`);
		if (startSample % ASSISTANCE_AUDIO_TAG_WINDOW_SAMPLES !== 0) {
			throw new RangeError(`${label} must start on the exact one-second sample grid.`);
		}
		if (startSample <= priorStart) {
			throw new RangeError('PANNs Cnn10 windows must be strictly ordered.');
		}
		priorStart = startSample;
		const scores = modelScores(row.scores, scoreKind, label);
		const aggregated: Record<AssistancePannsCnn10SignalV1, number> = {
			laughter: 0,
			applause: 0,
			cheering: 0,
		};
		for (const binding of bindings) {
			const probability = scoreKind === 'logits'
				? sigmoid(scores[binding.index]!)
				: scores[binding.index]!;
			aggregated[binding.signal] = Math.max(aggregated[binding.signal], probability);
		}
		const excitement: AssistanceExcitementScoresV1 = Object.freeze({
			laughter: canonicalProbability(aggregated.laughter),
			applause: canonicalProbability(aggregated.applause),
			cheering: canonicalProbability(aggregated.cheering),
		});
		return Object.freeze({ startSample, scores: excitement });
	});
	return Object.freeze(windows);
}

function modelScores(
	value: unknown,
	scoreKind: AssistancePannsCnn10ScoreKindV1,
	label: string,
): Float32Array {
	if (!(value instanceof Float32Array)
		|| value.length !== ASSISTANCE_PANNS_CNN10_AUDIOSET_CLASS_COUNT) {
		throw new RangeError(`The ${label} score-vector geometry is invalid.`);
	}
	for (const candidate of value) {
		if (!Number.isFinite(candidate)) {
			throw new RangeError(`Every ${label} model score or logit must be finite.`);
		}
		if (scoreKind === 'probabilities' && (candidate < 0 || candidate > 1)) {
			throw new RangeError(`Every ${label} probability score must be within the unit interval.`);
		}
	}
	return value;
}

function sigmoid(value: number): number {
	if (value >= 0) return canonicalProbability(1 / (1 + Math.exp(-value)));
	const exponent = Math.exp(value);
	return canonicalProbability(exponent / (1 + exponent));
}

function canonicalProbability(value: number): number {
	if (value <= 0) return 0;
	if (value >= 1) return 1;
	return Math.round(value * 1e12) / 1e12;
}

function boundedLabel(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 160
		|| value.trim() !== value || CONTROL.test(value)) {
		throw new TypeError(`The ${label} is invalid bounded text.`);
	}
	return value;
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const row = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(row);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return row as Record<Field, unknown>;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}
