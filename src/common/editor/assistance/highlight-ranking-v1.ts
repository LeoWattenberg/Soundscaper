/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic, model-independent Milestone 7 highlight ranking. */

export const HIGHLIGHT_RANKING_V1_WEIGHTS = Object.freeze({
	hook: 0.25,
	conversationalStructure: 0.2,
	excitement: 0.25,
	energyDynamics: 0.15,
	semanticSelfContainedness: 0.15,
});

/**
 * Speechless footage maps the unavailable language evidence onto its admitted
 * visual counterparts: shot structure retains structure's 20%, reaction and
 * energy retain their weights, and visual interest receives hook + semantic.
 */
export const HIGHLIGHT_RANKING_V1_SPEECHLESS_WEIGHTS = Object.freeze({
	shotStructure: 0.2,
	excitement: 0.25,
	energyDynamics: 0.15,
	visualInterest: 0.4,
});

export const HIGHLIGHT_RANKING_V1_DUPLICATION_PENALTY = 0.2;
export const HIGHLIGHT_RANKING_V1_MAXIMUM_OVERLAP = 0.25;

const CANDIDATE_FIELDS = Object.freeze([
	'id', 'startFrame', 'endFrame', 'transcriptEvidence', 'hook',
	'conversationalStructure', 'excitement', 'energyDynamics',
	'semanticSelfContainedness', 'shotStructure', 'visualInterest', 'duplication',
] as const);
const OPTION_FIELDS = Object.freeze([
	'sampleRate', 'maximumResults', 'minimumDurationSeconds', 'maximumDurationSeconds',
] as const);
const ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const MAXIMUM_CANDIDATES = 100_000;
const DEFAULT_RESULTS = 5;
const DEFAULT_MINIMUM_DURATION_SECONDS = 15;
const DEFAULT_MAXIMUM_DURATION_SECONDS = 60;
const ABSOLUTE_MAXIMUM_DURATION_SECONDS = 180;

export interface AssistanceHighlightCandidateV1 {
	readonly id: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly transcriptEvidence: boolean;
	readonly hook: number;
	readonly conversationalStructure: number;
	readonly excitement: number;
	readonly energyDynamics: number;
	readonly semanticSelfContainedness: number;
	readonly shotStructure: number;
	readonly visualInterest: number;
	readonly duplication: number;
}

export interface AssistanceHighlightRankingOptionsV1 {
	readonly sampleRate: number;
	readonly maximumResults?: number;
	readonly minimumDurationSeconds?: number;
	readonly maximumDurationSeconds?: number;
}

export interface AssistanceHighlightProposalV1 {
	readonly id: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly score: number;
	readonly evidenceMode: 'transcript' | 'speechless';
	readonly selected: false;
}

export function rankAssistanceHighlightsV1(
	candidatesValue: readonly AssistanceHighlightCandidateV1[],
	optionsValue: AssistanceHighlightRankingOptionsV1,
): readonly AssistanceHighlightProposalV1[] {
	if (!Array.isArray(candidatesValue) || candidatesValue.length > MAXIMUM_CANDIDATES) {
		throw new RangeError('Highlight ranking requires a bounded candidate inventory.');
	}
	const options = normalizeOptions(optionsValue);
	const seen = new Set<string>();
	const ranked = candidatesValue.map((candidate) => normalizeCandidate(candidate, seen))
		.filter(({ startFrame, endFrame }) => {
			const durationFrames = endFrame - startFrame;
			return durationFrames >= options.minimumDurationFrames
				&& durationFrames <= options.maximumDurationFrames;
		})
		.map((candidate) => Object.freeze({ candidate, score: candidateScore(candidate) }))
		.sort((left, right) => right.score - left.score
			|| left.candidate.startFrame - right.candidate.startFrame
			|| left.candidate.id.localeCompare(right.candidate.id));
	const accepted: AssistanceHighlightProposalV1[] = [];
	for (const { candidate, score } of ranked) {
		if (accepted.some((prior) => overlapRatio(prior, candidate)
			> HIGHLIGHT_RANKING_V1_MAXIMUM_OVERLAP)) continue;
		accepted.push(Object.freeze({
			id: candidate.id,
			startFrame: candidate.startFrame,
			endFrame: candidate.endFrame,
			score,
			evidenceMode: candidate.transcriptEvidence ? 'transcript' : 'speechless',
			selected: false as const,
		}));
		if (accepted.length === options.maximumResults) break;
	}
	return Object.freeze(accepted);
}

function candidateScore(candidate: AssistanceHighlightCandidateV1): number {
	const raw = candidate.transcriptEvidence
		? candidate.hook * HIGHLIGHT_RANKING_V1_WEIGHTS.hook
			+ candidate.conversationalStructure
				* HIGHLIGHT_RANKING_V1_WEIGHTS.conversationalStructure
			+ candidate.excitement * HIGHLIGHT_RANKING_V1_WEIGHTS.excitement
			+ candidate.energyDynamics * HIGHLIGHT_RANKING_V1_WEIGHTS.energyDynamics
			+ candidate.semanticSelfContainedness
				* HIGHLIGHT_RANKING_V1_WEIGHTS.semanticSelfContainedness
		: candidate.shotStructure * HIGHLIGHT_RANKING_V1_SPEECHLESS_WEIGHTS.shotStructure
			+ candidate.excitement * HIGHLIGHT_RANKING_V1_SPEECHLESS_WEIGHTS.excitement
			+ candidate.energyDynamics * HIGHLIGHT_RANKING_V1_SPEECHLESS_WEIGHTS.energyDynamics
			+ candidate.visualInterest * HIGHLIGHT_RANKING_V1_SPEECHLESS_WEIGHTS.visualInterest;
	return quantize(raw * (1 - candidate.duplication * HIGHLIGHT_RANKING_V1_DUPLICATION_PENALTY));
}

function normalizeCandidate(
	value: unknown,
	seen: Set<string>,
): AssistanceHighlightCandidateV1 {
	const record = exactRecord(value, CANDIDATE_FIELDS, 'highlight candidate');
	const id = stableId(record.id);
	if (seen.has(id)) throw new TypeError('Highlight candidate IDs must be unique.');
	seen.add(id);
	const startFrame = frame(record.startFrame, 'highlight candidate start');
	const endFrame = frame(record.endFrame, 'highlight candidate end');
	if (endFrame <= startFrame) throw new RangeError('A highlight candidate must have positive duration.');
	if (typeof record.transcriptEvidence !== 'boolean') {
		throw new TypeError('Highlight transcript evidence authority must be boolean.');
	}
	return Object.freeze({
		id,
		startFrame,
		endFrame,
		transcriptEvidence: record.transcriptEvidence,
		hook: unit(record.hook, 'hook'),
		conversationalStructure: unit(record.conversationalStructure, 'conversational structure'),
		excitement: unit(record.excitement, 'excitement'),
		energyDynamics: unit(record.energyDynamics, 'energy dynamics'),
		semanticSelfContainedness: unit(
			record.semanticSelfContainedness, 'semantic self-containedness',
		),
		shotStructure: unit(record.shotStructure, 'shot structure'),
		visualInterest: unit(record.visualInterest, 'visual interest'),
		duplication: unit(record.duplication, 'duplication'),
	});
}

function normalizeOptions(value: unknown): Readonly<{
	maximumResults: number;
	minimumDurationFrames: number;
	maximumDurationFrames: number;
}> {
	const record = exactRecord(value, OPTION_FIELDS, 'highlight ranking options', true);
	if (!Object.hasOwn(record, 'sampleRate')) {
		throw new TypeError('Highlight ranking requires its sample rate.');
	}
	const sampleRate = positiveInteger(record.sampleRate, 'highlight sample rate');
	const maximumResults = boundedInteger(
		record.maximumResults ?? DEFAULT_RESULTS, 1, 20, 'highlight result count',
	);
	const minimumDurationSeconds = boundedInteger(
		record.minimumDurationSeconds ?? DEFAULT_MINIMUM_DURATION_SECONDS,
		1, ABSOLUTE_MAXIMUM_DURATION_SECONDS, 'highlight minimum duration',
	);
	const maximumDurationSeconds = boundedInteger(
		record.maximumDurationSeconds ?? DEFAULT_MAXIMUM_DURATION_SECONDS,
		minimumDurationSeconds, ABSOLUTE_MAXIMUM_DURATION_SECONDS, 'highlight maximum duration',
	);
	return Object.freeze({
		maximumResults,
		minimumDurationFrames: safeMultiply(sampleRate, minimumDurationSeconds),
		maximumDurationFrames: safeMultiply(sampleRate, maximumDurationSeconds),
	});
}

function overlapRatio(
	left: Pick<AssistanceHighlightProposalV1, 'startFrame' | 'endFrame'>,
	right: Pick<AssistanceHighlightCandidateV1, 'startFrame' | 'endFrame'>,
): number {
	const overlap = Math.max(0,
		Math.min(left.endFrame, right.endFrame) - Math.max(left.startFrame, right.startFrame));
	return overlap / Math.min(left.endFrame - left.startFrame, right.endFrame - right.startFrame);
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
	allowMissing = false,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.some((key) => !fields.includes(key as Field))
		|| (!allowMissing && keys.length !== fields.length)) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return record as Record<Field, unknown>;
}

function stableId(value: unknown): string {
	if (typeof value !== 'string' || !ID.test(value)) {
		throw new TypeError('The highlight candidate ID is invalid.');
	}
	return value;
}

function frame(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function positiveInteger(value: unknown, label: string): number {
	return boundedInteger(value, 1, Number.MAX_SAFE_INTEGER, label);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is out of range.`);
	}
	return Number(value);
}

function unit(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`The highlight ${label} score must be in the unit interval.`);
	}
	return value;
}

function safeMultiply(left: number, right: number): number {
	const result = left * right;
	if (!Number.isSafeInteger(result)) throw new RangeError('Highlight duration geometry overflowed.');
	return result;
}

function quantize(value: number): number {
	return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}
