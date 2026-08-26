/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic shot sampling and cross-modal search fusion for Milestone 7. */

export const ASSISTANCE_SEARCH_RRF_K = 60;

const SHOT_FIELDS = Object.freeze(['shotId', 'startFrame', 'endFrame'] as const);
const SEARCH_HIT_FIELDS = Object.freeze(['resultId', 'timelineFrame', 'label'] as const);
const SEARCH_PROVIDERS = Object.freeze(['transcript', 'visual', 'ocr'] as const);
const ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const MAXIMUM_SHOTS = 100_000;
const MAXIMUM_PROVIDER_HITS = 10_000;

export interface AssistanceShotV1 {
	readonly shotId: string;
	readonly startFrame: number;
	readonly endFrame: number;
}

export type AssistanceShotSampleAnchorV1 =
	| 'first-quarter' | 'first-third' | 'midpoint' | 'second-third' | 'third-quarter';

export interface AssistanceShotSampleV1 {
	readonly shotId: string;
	readonly sourceFrame: number;
	readonly anchor: AssistanceShotSampleAnchorV1;
}

export type AssistanceSearchProviderV1 = typeof SEARCH_PROVIDERS[number];

export interface AssistanceProviderSearchHitV1 {
	readonly resultId: string;
	readonly timelineFrame: number;
	readonly label: string;
}

export type AssistanceProviderSearchRanksV1 = Readonly<Record<
	AssistanceSearchProviderV1,
	readonly AssistanceProviderSearchHitV1[]
>>;

export interface AssistanceFusedSearchHitV1 {
	readonly resultId: string;
	readonly timelineFrame: number;
	readonly score: number;
	readonly providers: readonly AssistanceSearchProviderV1[];
	readonly labels: Readonly<Partial<Record<AssistanceSearchProviderV1, string>>>;
}

export function sampleAssistanceShotsV1(
	shotsValue: readonly AssistanceShotV1[],
	sampleRateValue: number,
): readonly AssistanceShotSampleV1[] {
	if (!Array.isArray(shotsValue) || shotsValue.length > MAXIMUM_SHOTS) {
		throw new RangeError('Assistance shot sampling requires a bounded shot inventory.');
	}
	const sampleRate = positiveInteger(sampleRateValue, 'shot-sampling rate');
	const seen = new Set<string>();
	let priorEnd = 0;
	const samples: AssistanceShotSampleV1[] = [];
	for (const [index, value] of shotsValue.entries()) {
		const record = exactRecord(value, SHOT_FIELDS, `shot ${String(index)}`);
		const shotId = stableId(record.shotId, 'shot ID');
		if (seen.has(shotId)) throw new TypeError('Assistance shot IDs must be unique.');
		seen.add(shotId);
		const startFrame = frame(record.startFrame, `shot ${String(index)} start`);
		const endFrame = frame(record.endFrame, `shot ${String(index)} end`);
		if (endFrame <= startFrame) throw new RangeError('An assistance shot must have positive duration.');
		if (index > 0 && startFrame < priorEnd) {
			throw new RangeError('Assistance shots must be ordered and disjoint.');
		}
		const duration = endFrame - startFrame;
		const anchors: readonly Readonly<{
			numerator: number;
			denominator: number;
			anchor: AssistanceShotSampleAnchorV1;
		}>[] = duration <= safeMultiply(sampleRate, 4)
			? [{ numerator: 1, denominator: 2, anchor: 'midpoint' }]
			: duration <= safeMultiply(sampleRate, 12)
				? [
					{ numerator: 1, denominator: 3, anchor: 'first-third' },
					{ numerator: 2, denominator: 3, anchor: 'second-third' },
				]
				: [
					{ numerator: 1, denominator: 4, anchor: 'first-quarter' },
					{ numerator: 1, denominator: 2, anchor: 'midpoint' },
					{ numerator: 3, denominator: 4, anchor: 'third-quarter' },
				];
		for (const anchor of anchors) {
			const sourceFrame = Math.min(endFrame - 1,
				startFrame + Math.floor(duration * anchor.numerator / anchor.denominator));
			samples.push(Object.freeze({ shotId, sourceFrame, anchor: anchor.anchor }));
		}
		priorEnd = endFrame;
	}
	return Object.freeze(samples);
}

export function fuseAssistanceSearchRanksV1(
	value: AssistanceProviderSearchRanksV1,
): readonly AssistanceFusedSearchHitV1[] {
	const record = exactRecord(value, SEARCH_PROVIDERS, 'assistance search ranks');
	const fused = new Map<string, {
		timelineFrame: number;
		score: number;
		providers: AssistanceSearchProviderV1[];
		labels: Partial<Record<AssistanceSearchProviderV1, string>>;
	}>();
	for (const provider of SEARCH_PROVIDERS) {
		const values = record[provider];
		if (!Array.isArray(values) || values.length > MAXIMUM_PROVIDER_HITS) {
			throw new RangeError(`The ${provider} assistance search result inventory exceeds its bound.`);
		}
		const providerIds = new Set<string>();
		for (const [index, candidate] of values.entries()) {
			const hit = normalizeProviderHit(candidate, provider, index);
			if (providerIds.has(hit.resultId)) {
				throw new TypeError(`The ${provider} assistance search results contain a duplicate identity.`);
			}
			providerIds.add(hit.resultId);
			const existing = fused.get(hit.resultId);
			if (existing && existing.timelineFrame !== hit.timelineFrame) {
				throw new Error('Assistance search providers disagree about one result timeline position.');
			}
			const entry = existing ?? {
				timelineFrame: hit.timelineFrame,
				score: 0,
				providers: [],
				labels: {},
			};
			entry.score += 1 / (ASSISTANCE_SEARCH_RRF_K + index + 1);
			entry.providers.push(provider);
			entry.labels[provider] = hit.label;
			fused.set(hit.resultId, entry);
		}
	}
	return Object.freeze([...fused.entries()].map(([resultId, value]) => Object.freeze({
		resultId,
		timelineFrame: value.timelineFrame,
		score: quantize(value.score),
		providers: Object.freeze(value.providers),
		labels: Object.freeze({ ...value.labels }),
	})).sort((left, right) => right.score - left.score
		|| left.timelineFrame - right.timelineFrame
		|| left.resultId.localeCompare(right.resultId)));
}

function normalizeProviderHit(
	value: unknown,
	provider: AssistanceSearchProviderV1,
	index: number,
): AssistanceProviderSearchHitV1 {
	const record = exactRecord(value, SEARCH_HIT_FIELDS,
		`${provider} assistance search result ${String(index)}`);
	return Object.freeze({
		resultId: stableId(record.resultId, 'search result ID'),
		timelineFrame: frame(record.timelineFrame, 'search result timeline frame'),
		label: boundedText(record.label, 4_096, 'search result label'),
	});
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key as Field))) {
		throw new TypeError(`The ${label} has unsupported fields.`);
	}
	return record as Record<Field, unknown>;
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value)) {
		throw new TypeError(`The assistance ${label} is invalid.`);
	}
	return value;
}

function boundedText(value: unknown, maximum: number, label: string): string {
	if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
		throw new TypeError(`The assistance ${label} is invalid.`);
	}
	return value;
}

function frame(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`The assistance ${label} is invalid.`);
	}
	return Number(value);
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`The assistance ${label} is invalid.`);
	}
	return Number(value);
}

function safeMultiply(left: number, right: number): number {
	const result = left * right;
	if (!Number.isSafeInteger(result)) throw new RangeError('Assistance shot duration geometry overflowed.');
	return result;
}

function quantize(value: number): number {
	return Math.round(value * 1_000_000_000_000_000) / 1_000_000_000_000_000;
}
