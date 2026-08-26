/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_TRANSCRIPT_SCHEMA_VERSION,
	createAssistanceTranscript,
	hasWordTiming,
	transcriptSegmentsInRange,
	transcriptToLabelDrafts,
	transcriptWords,
	type TranscriptDraft,
} from '../src/common/editor/assistance/transcript.ts';
import {
	acceptedProposalFrames,
	acceptedProposalRanges,
	findDisfluencyProposals,
} from '../src/common/editor/assistance/disfluency.ts';

const EN_FILLERS = ['um', 'uh', 'like'];

function draft(overrides: Partial<TranscriptDraft> = {}): TranscriptDraft {
	return {
		sourceId: 'source-1',
		sampleRate: 48_000,
		modelId: 'parakeet-tdt-0.6b-v2',
		language: 'en',
		segments: [
			{
				startFrame: 0,
				endFrame: 48_000,
				words: [
					{ text: 'So', startFrame: 0, endFrame: 4_000, confidence: 0.9 },
					{ text: 'um', startFrame: 5_000, endFrame: 9_000, confidence: 0.8 },
					{ text: 'welcome', startFrame: 10_000, endFrame: 20_000, confidence: 0.95 },
				],
			},
		],
		...overrides,
	};
}

test('a transcript normalizes into canonical sample frames', () => {
	const transcript = createAssistanceTranscript(draft());

	assert.equal(transcript.schemaVersion, ASSISTANCE_TRANSCRIPT_SCHEMA_VERSION);
	assert.equal(transcript.sampleRate, 48_000);
	assert.equal(transcript.language, 'en');
	assert.equal(transcript.segments[0]?.text, 'So um welcome', 'segment text derives from its words');
	assert.equal(transcript.segments[0]?.speaker, null);
	assert.equal(hasWordTiming(transcript), true);
	assert.equal(transcriptWords(transcript).length, 3);
});

test('a transcript refuses positions it cannot compare exactly', () => {
	assert.throws(
		() => createAssistanceTranscript(draft({
			segments: [{ startFrame: 0.5, endFrame: 48_000, words: [] }],
		})),
		/integer sample frame/iu,
	);
	assert.throws(
		() => createAssistanceTranscript(draft({ sampleRate: 0 })),
		/sample rate must be a positive integer/iu,
	);
	assert.throws(
		() => createAssistanceTranscript(draft({
			segments: [{ startFrame: 100, endFrame: 100, words: [] }],
		})),
		/at least one sample frame/iu,
	);
});

test('overlapping segments and words are refused rather than reconciled', () => {
	assert.throws(
		() => createAssistanceTranscript(draft({
			segments: [
				{ startFrame: 0, endFrame: 1_000, text: 'one' },
				{ startFrame: 500, endFrame: 2_000, text: 'two' },
			],
		})),
		/overlaps the segment before it/iu,
	);
	assert.throws(
		() => createAssistanceTranscript(draft({
			segments: [{
				startFrame: 0,
				endFrame: 2_000,
				words: [
					{ text: 'one', startFrame: 0, endFrame: 900 },
					{ text: 'two', startFrame: 500, endFrame: 1_500 },
				],
			}],
		})),
		/words overlap/iu,
	);
	assert.throws(
		() => createAssistanceTranscript(draft({
			segments: [{
				startFrame: 0,
				endFrame: 1_000,
				words: [{ text: 'outside', startFrame: 0, endFrame: 4_000 }],
			}],
		})),
		/must stay inside the segment/iu,
	);
});

test('segments map to labels and carry speakers when diarization produced them', () => {
	const transcript = createAssistanceTranscript(draft({
		segments: [
			{ startFrame: 0, endFrame: 1_000, text: 'Hello there', speaker: 'Speaker 1' },
			{ startFrame: 2_000, endFrame: 3_000, text: 'Hi', speaker: 'Speaker 2' },
		],
	}));

	assert.deepEqual(transcriptToLabelDrafts(transcript), [
		{ title: 'Speaker 1: Hello there', startFrame: 0, endFrame: 1_000 },
		{ title: 'Speaker 2: Hi', startFrame: 2_000, endFrame: 3_000 },
	]);
	assert.deepEqual(transcriptToLabelDrafts(transcript, { includeSpeaker: false }), [
		{ title: 'Hello there', startFrame: 0, endFrame: 1_000 },
		{ title: 'Hi', startFrame: 2_000, endFrame: 3_000 },
	]);
});

test('a range query returns only the overlapping segments', () => {
	const transcript = createAssistanceTranscript(draft({
		segments: [
			{ startFrame: 0, endFrame: 1_000, text: 'one' },
			{ startFrame: 1_000, endFrame: 2_000, text: 'two' },
			{ startFrame: 5_000, endFrame: 6_000, text: 'three' },
		],
	}));

	assert.deepEqual(
		transcriptSegmentsInRange(transcript, 900, 1_500).map(({ text }) => text),
		['one', 'two'],
	);
	assert.deepEqual(transcriptSegmentsInRange(transcript, 2_000, 5_000).map(({ text }) => text), []);
});

test('a transcript without word timing reports it instead of fabricating positions', () => {
	const transcript = createAssistanceTranscript(draft({
		segments: [{ startFrame: 0, endFrame: 1_000, text: 'no timing here' }],
	}));

	assert.equal(hasWordTiming(transcript), false);
	assert.deepEqual(findDisfluencyProposals(transcript, { fillerLexicon: EN_FILLERS }), []);
});

test('filler words are proposed from the supplied lexicon only', () => {
	const transcript = createAssistanceTranscript(draft());

	const proposals = findDisfluencyProposals(transcript, { fillerLexicon: EN_FILLERS });
	assert.deepEqual(proposals.map(({ kind, text }) => [kind, text]), [['filler', 'um']]);

	assert.deepEqual(findDisfluencyProposals(transcript), [], 'no lexicon proposes nothing');
	assert.deepEqual(
		findDisfluencyProposals(transcript, { fillerLexicon: ['welcome'] }).map(({ text }) => text),
		['welcome'],
		'the lexicon is the whole policy',
	);
});

test('punctuation and casing do not hide a filler', () => {
	const transcript = createAssistanceTranscript(draft({
		segments: [{
			startFrame: 0,
			endFrame: 20_000,
			words: [
				{ text: 'Um,', startFrame: 0, endFrame: 1_000 },
				{ text: 'right', startFrame: 2_000, endFrame: 3_000 },
			],
		}],
	}));

	assert.deepEqual(
		findDisfluencyProposals(transcript, { fillerLexicon: EN_FILLERS }).map(({ text }) => text),
		['Um,'],
	);
});

test('low-confidence words are left alone', () => {
	const transcript = createAssistanceTranscript(draft({
		segments: [{
			startFrame: 0,
			endFrame: 20_000,
			words: [{ text: 'um', startFrame: 0, endFrame: 1_000, confidence: 0.2 }],
		}],
	}));

	assert.deepEqual(findDisfluencyProposals(transcript, { fillerLexicon: EN_FILLERS, minConfidence: 0.5 }), []);
	assert.equal(findDisfluencyProposals(transcript, { fillerLexicon: EN_FILLERS }).length, 1);
});

test('an immediate repetition proposes the later utterance', () => {
	const transcript = createAssistanceTranscript(draft({
		segments: [{
			startFrame: 0,
			endFrame: 20_000,
			words: [
				{ text: 'the', startFrame: 0, endFrame: 1_000 },
				{ text: 'the', startFrame: 1_500, endFrame: 2_500 },
				{ text: 'point', startFrame: 3_000, endFrame: 4_000 },
			],
		}],
	}));

	const proposals = findDisfluencyProposals(transcript, { detectRepetitions: true });
	assert.deepEqual(proposals.map(({ kind, startFrame }) => [kind, startFrame]), [['repetition', 1_500]]);
	assert.deepEqual(findDisfluencyProposals(transcript), [], 'repetition detection is opt-in');
});

test('silences are proposed above the threshold and keep their padding', () => {
	const transcript = createAssistanceTranscript(draft({
		segments: [{
			startFrame: 0,
			endFrame: 100_000,
			words: [
				{ text: 'first', startFrame: 0, endFrame: 1_000 },
				{ text: 'second', startFrame: 50_000, endFrame: 51_000 },
			],
		}],
	}));

	const proposals = findDisfluencyProposals(transcript, {
		minSilenceFrames: 24_000,
		silencePaddingFrames: 4_800,
	});
	assert.deepEqual(proposals.map(({ kind, startFrame, endFrame }) => [kind, startFrame, endFrame]), [
		['silence', 5_800, 45_200],
	]);

	assert.deepEqual(
		findDisfluencyProposals(transcript, { minSilenceFrames: 60_000 }),
		[],
		'a gap under the threshold is left alone',
	);
	assert.deepEqual(
		findDisfluencyProposals(transcript, { minSilenceFrames: 24_000, silencePaddingFrames: 30_000 }),
		[],
		'padding wider than the gap proposes nothing rather than an inverted range',
	);
});

test('accepted proposals merge into ordered ranges for one ripple batch', () => {
	const proposals = [
		{ id: 'a', kind: 'filler' as const, startFrame: 100, endFrame: 200, text: 'um' },
		{ id: 'b', kind: 'silence' as const, startFrame: 200, endFrame: 400, text: '' },
		{ id: 'c', kind: 'filler' as const, startFrame: 900, endFrame: 950, text: 'uh' },
		{ id: 'd', kind: 'filler' as const, startFrame: 5_000, endFrame: 5_100, text: 'like' },
	];

	const ranges = acceptedProposalRanges(proposals, ['a', 'b', 'c']);
	assert.deepEqual(ranges, [
		{ startFrame: 100, endFrame: 400 },
		{ startFrame: 900, endFrame: 950 },
	], 'touching proposals become one contiguous cut');
	assert.equal(acceptedProposalFrames(ranges), 350);

	assert.deepEqual(acceptedProposalRanges(proposals, []), [], 'accepting nothing edits nothing');
	assert.deepEqual(
		acceptedProposalRanges(proposals, ['d']).map(({ startFrame }) => startFrame),
		[5_000],
		'only accepted proposals are cut',
	);
});

test('proposals are ordered and identified stably', () => {
	const transcript = createAssistanceTranscript(draft({
		segments: [{
			startFrame: 0,
			endFrame: 100_000,
			words: [
				{ text: 'uh', startFrame: 60_000, endFrame: 61_000 },
				{ text: 'um', startFrame: 90_000, endFrame: 91_000 },
			],
		}],
	}));

	const first = findDisfluencyProposals(transcript, { fillerLexicon: EN_FILLERS, minSilenceFrames: 24_000 });
	const second = findDisfluencyProposals(transcript, { fillerLexicon: EN_FILLERS, minSilenceFrames: 24_000 });

	assert.deepEqual(first, second, 'detection is deterministic');
	assert.deepEqual(
		first.map(({ startFrame }) => startFrame),
		[...first.map(({ startFrame }) => startFrame)].sort((left, right) => left - right),
	);
	assert.equal(new Set(first.map(({ id }) => id)).size, first.length, 'ids are unique');
});

/**
 * A segment can carry text with no word timing — ingest keeps one whose words
 * were all dropped as blank. Silence is derived from the gaps between words, so
 * such a segment leaves a gap that spans its speech; proposing to delete it
 * would ripple away audible dialogue under the label "silence".
 */
test('a segment without word timing is never proposed as silence', () => {
	const transcript = createAssistanceTranscript(draft({
		segments: [
			{
				startFrame: 0,
				endFrame: 48_000,
				words: [{ text: 'hello', startFrame: 0, endFrame: 48_000, confidence: 0.9 }],
			},
			{ startFrame: 48_000, endFrame: 480_000, text: 'a long stretch of real speech', words: [] },
			{
				startFrame: 480_000,
				endFrame: 528_000,
				words: [{ text: 'bye', startFrame: 480_000, endFrame: 528_000, confidence: 0.9 }],
			},
		],
	}));

	assert.deepEqual(
		findDisfluencyProposals(transcript, { minSilenceFrames: 96_000 }),
		[],
		'the untimed segment carries speech, so the gap around it is not silence',
	);
});
