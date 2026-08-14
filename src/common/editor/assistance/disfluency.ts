/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Filler-word, repetition, and silence proposals over a transcript.
 *
 * Nothing here edits a project. Detection produces a reviewable proposal list
 * that the user accepts or rejects item by item; only accepted proposals are
 * converted into delete ranges for the existing disjoint ripple-delete
 * primitive. That keeps an assistance edit an ordinary, inspectable command
 * rather than a special path.
 */

import type { AssistanceTranscript, TranscriptWord } from './transcript.ts';
import { transcriptWords } from './transcript.ts';

export type DisfluencyKind = 'filler' | 'repetition' | 'silence';

export interface DisfluencyProposal {
	readonly id: string;
	readonly kind: DisfluencyKind;
	readonly startFrame: number;
	readonly endFrame: number;
	/** The words the proposal would remove, for the review list. */
	readonly text: string;
}

export interface DisfluencyOptions {
	/**
	 * Lower-cased filler words. Supplied per language rather than defaulted,
	 * because a word that is filler in one language is content in another.
	 */
	readonly fillerLexicon?: readonly string[];
	/** Silences at least this long are proposed. Zero disables the pass. */
	readonly minSilenceFrames?: number;
	/** Silence kept at a cut so speech does not butt together. */
	readonly silencePaddingFrames?: number;
	/** Words below this confidence are never proposed automatically. */
	readonly minConfidence?: number;
	/** Detect an immediately repeated word as a stammer. */
	readonly detectRepetitions?: boolean;
}

const DEFAULT_MIN_SILENCE_FRAMES = 0;
const DEFAULT_SILENCE_PADDING_FRAMES = 0;

function normalizeToken(text: string): string {
	return text.toLowerCase().replace(/[^\p{Letter}\p{Number}']/gu, '');
}

function proposalId(kind: DisfluencyKind, startFrame: number, endFrame: number): string {
	return `${kind}-${startFrame}-${endFrame}`;
}

function isEligible(word: TranscriptWord, minConfidence: number): boolean {
	return word.confidence === null || word.confidence >= minConfidence;
}

/**
 * Finds removable spans. Filler and repetition proposals come from word
 * timing; silence proposals come from the gaps between words. A transcript
 * without word timing yields no proposals rather than approximate ones.
 */
export function findDisfluencyProposals(
	transcript: AssistanceTranscript,
	options: DisfluencyOptions = {},
): readonly DisfluencyProposal[] {
	const lexicon = new Set((options.fillerLexicon ?? []).map(normalizeToken).filter(Boolean));
	const minSilenceFrames = options.minSilenceFrames ?? DEFAULT_MIN_SILENCE_FRAMES;
	const padding = options.silencePaddingFrames ?? DEFAULT_SILENCE_PADDING_FRAMES;
	const minConfidence = options.minConfidence ?? 0;
	const detectRepetitions = options.detectRepetitions ?? false;

	if (minSilenceFrames < 0 || padding < 0) {
		throw new RangeError('Silence thresholds must not be negative.');
	}

	const words = transcriptWords(transcript);
	const proposals: DisfluencyProposal[] = [];

	for (const [index, word] of words.entries()) {
		if (!isEligible(word, minConfidence)) continue;
		const token = normalizeToken(word.text);
		if (token && lexicon.has(token)) {
			proposals.push(Object.freeze({
				id: proposalId('filler', word.startFrame, word.endFrame),
				kind: 'filler',
				startFrame: word.startFrame,
				endFrame: word.endFrame,
				text: word.text,
			}));
			continue;
		}
		if (!detectRepetitions || index === 0) continue;
		const previous = words[index - 1] as TranscriptWord;
		if (token && normalizeToken(previous.text) === token && isEligible(previous, minConfidence)) {
			// Remove the later utterance so the retained take is the fluent one.
			proposals.push(Object.freeze({
				id: proposalId('repetition', word.startFrame, word.endFrame),
				kind: 'repetition',
				startFrame: word.startFrame,
				endFrame: word.endFrame,
				text: word.text,
			}));
		}
	}

	if (minSilenceFrames > 0) {
		for (const [index, word] of words.entries()) {
			if (index === 0) continue;
			const previous = words[index - 1] as TranscriptWord;
			const gap = word.startFrame - previous.endFrame;
			if (gap < minSilenceFrames) continue;
			const startFrame = previous.endFrame + padding;
			const endFrame = word.startFrame - padding;
			if (endFrame <= startFrame) continue;
			proposals.push(Object.freeze({
				id: proposalId('silence', startFrame, endFrame),
				kind: 'silence',
				startFrame,
				endFrame,
				text: '',
			}));
		}
	}

	proposals.sort((left, right) => left.startFrame - right.startFrame
		|| left.endFrame - right.endFrame
		|| left.kind.localeCompare(right.kind));
	return Object.freeze(proposals);
}

export interface DisfluencyRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

/**
 * Converts accepted proposals into the merged, ordered ranges the disjoint
 * ripple delete expects. Touching or overlapping proposals merge so the edit
 * is one contiguous cut instead of adjacent cuts that each ripple separately.
 */
export function acceptedProposalRanges(
	proposals: readonly DisfluencyProposal[],
	acceptedIds: readonly string[],
): readonly DisfluencyRange[] {
	const accepted = new Set(acceptedIds);
	const selected = proposals
		.filter((proposal) => accepted.has(proposal.id))
		.map(({ startFrame, endFrame }) => ({ startFrame, endFrame }))
		.sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame);

	const merged: DisfluencyRange[] = [];
	for (const range of selected) {
		if (range.endFrame <= range.startFrame) continue;
		const previous = merged[merged.length - 1];
		if (previous && range.startFrame <= previous.endFrame) {
			merged[merged.length - 1] = Object.freeze({
				startFrame: previous.startFrame,
				endFrame: Math.max(previous.endFrame, range.endFrame),
			});
			continue;
		}
		merged.push(Object.freeze({ startFrame: range.startFrame, endFrame: range.endFrame }));
	}
	return Object.freeze(merged);
}

/** Total frames the accepted proposals would remove. */
export function acceptedProposalFrames(ranges: readonly DisfluencyRange[]): number {
	return ranges.reduce((total, range) => total + (range.endFrame - range.startFrame), 0);
}
