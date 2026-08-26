/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic, initially-unselected reaction ranges from reviewed PANNs scores. */

import {
	ASSISTANCE_AUDIO_TAG_WINDOW_SAMPLES,
	reviewAssistanceAudioTagsV1,
	type AssistanceAudioTagsV1,
} from './m7-semantic-results.ts';

export const DEFAULT_ASSISTANCE_REACTION_THRESHOLD = 0.5;
export const MAXIMUM_ASSISTANCE_REACTION_PROPOSALS = 10_000;
export const ASSISTANCE_REACTION_LABELS = Object.freeze([
	'Laughter', 'Applause', 'Cheering',
] as const);

export type AssistanceReactionLabel = typeof ASSISTANCE_REACTION_LABELS[number];

export interface AssistanceReactionProposal {
	readonly id: string;
	readonly kind: 'reaction';
	readonly label: AssistanceReactionLabel;
	readonly startSample: number;
	readonly endSample: number;
	readonly score: number;
	readonly selected: false;
}

export interface AssistanceReactionProposalOptions {
	readonly threshold?: number;
}

type ScoreKey = 'laughter' | 'applause' | 'cheering';
type MutableRange = {
	label: AssistanceReactionLabel;
	startSample: number;
	endSample: number;
	score: number;
};

const CLASSES = Object.freeze([
	Object.freeze({ label: 'Laughter' as const, score: 'laughter' as const }),
	Object.freeze({ label: 'Applause' as const, score: 'applause' as const }),
	Object.freeze({ label: 'Cheering' as const, score: 'cheering' as const }),
]);
const LABEL_ORDER = new Map(ASSISTANCE_REACTION_LABELS.map((label, index) => [label, index]));

export function createAssistanceReactionProposals(
	value: AssistanceAudioTagsV1,
	options: AssistanceReactionProposalOptions = {},
): readonly AssistanceReactionProposal[] {
	const review = reviewAssistanceAudioTagsV1(value);
	const threshold = reactionThreshold(options.threshold ?? DEFAULT_ASSISTANCE_REACTION_THRESHOLD);
	const ranges = CLASSES.flatMap(({ label, score }) => classRanges(review, label, score, threshold));
	if (ranges.length > MAXIMUM_ASSISTANCE_REACTION_PROPOSALS) {
		throw new RangeError('The reviewed audio tags exceed the reaction proposal bound.');
	}
	ranges.sort((left, right) => left.startSample - right.startSample
		|| (LABEL_ORDER.get(left.label) ?? 0) - (LABEL_ORDER.get(right.label) ?? 0)
		|| left.endSample - right.endSample);
	return Object.freeze(ranges.map((range): AssistanceReactionProposal => Object.freeze({
		id: `reaction:${range.label.toLowerCase()}:${String(range.startSample)}:${String(range.endSample)}`,
		kind: 'reaction',
		label: range.label,
		startSample: range.startSample,
		endSample: range.endSample,
		score: range.score,
		selected: false,
	})));
}

function classRanges(
	review: AssistanceAudioTagsV1,
	label: AssistanceReactionLabel,
	scoreKey: ScoreKey,
	threshold: number,
): MutableRange[] {
	const ranges: MutableRange[] = [];
	let active: MutableRange | null = null;
	for (const window of review.windows) {
		const score = window.scores[scoreKey];
		if (score < threshold) continue;
		const endSample = safeAdd(window.startSample, ASSISTANCE_AUDIO_TAG_WINDOW_SAMPLES);
		if (active && window.startSample - active.endSample <= ASSISTANCE_AUDIO_TAG_WINDOW_SAMPLES) {
			active.endSample = endSample;
			active.score = Math.max(active.score, score);
			continue;
		}
		active = { label, startSample: window.startSample, endSample, score };
		ranges.push(active);
	}
	return ranges;
}

function reactionThreshold(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError('The reaction threshold must be finite and within the unit interval.');
	}
	return value;
}

function safeAdd(left: number, right: number): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) {
		throw new RangeError('A reaction window exceeds safe sample timing.');
	}
	return result;
}
