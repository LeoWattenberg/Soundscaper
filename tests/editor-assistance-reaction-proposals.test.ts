/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceReactionProposals,
} from '../src/common/editor/assistance/reaction-proposals.ts';
import {
	MAXIMUM_ASSISTANCE_AUDIO_TAG_WINDOWS,
	reviewAssistanceAudioTagsV1,
} from '../src/common/editor/assistance/m7-semantic-results.ts';

const REVIEW = reviewAssistanceAudioTagsV1({
	schemaVersion: 1,
	sampleRate: 32_000,
	windowSamples: 32_000,
	windows: [
		{ startSample: 0, scores: { laughter: 0.5, applause: 0.6, cheering: 0 } },
		{ startSample: 32_000, scores: { laughter: 0.2, applause: 0, cheering: 0 } },
		{ startSample: 64_000, scores: { laughter: 0.8, applause: 0, cheering: 0 } },
		{ startSample: 96_000, scores: { laughter: 0, applause: 0, cheering: 0.9 } },
		{ startSample: 160_000, scores: { laughter: 0, applause: 0.75, cheering: 0 } },
	],
});

test('reaction proposals use the inclusive 0.5 default and stable closed-label ordering', () => {
	const proposals = createAssistanceReactionProposals(REVIEW);
	assert.deepEqual(proposals, [
		{
			id: 'reaction:laughter:0:96000', kind: 'reaction', label: 'Laughter',
			startSample: 0, endSample: 96_000, score: 0.8, selected: false,
		},
		{
			id: 'reaction:applause:0:32000', kind: 'reaction', label: 'Applause',
			startSample: 0, endSample: 32_000, score: 0.6, selected: false,
		},
		{
			id: 'reaction:cheering:96000:128000', kind: 'reaction', label: 'Cheering',
			startSample: 96_000, endSample: 128_000, score: 0.9, selected: false,
		},
		{
			id: 'reaction:applause:160000:192000', kind: 'reaction', label: 'Applause',
			startSample: 160_000, endSample: 192_000, score: 0.75, selected: false,
		},
	]);
	assert.ok(Object.isFrozen(proposals));
	assert.ok(proposals.every(Object.isFrozen));
	assert.deepEqual(createAssistanceReactionProposals(REVIEW), proposals);
});

test('reaction proposals merge same-class windows with no more than one second between them', () => {
	const proposals = createAssistanceReactionProposals(reviewAssistanceAudioTagsV1({
		schemaVersion: 1, sampleRate: 32_000, windowSamples: 32_000,
		windows: [
			{ startSample: 0, scores: { laughter: 1, applause: 0, cheering: 0 } },
			{ startSample: 64_000, scores: { laughter: 0.75, applause: 0, cheering: 0 } },
			{ startSample: 160_000, scores: { laughter: 0.8, applause: 0, cheering: 0 } },
		],
	}));
	assert.deepEqual(proposals.map(({ startSample, endSample }) => ({ startSample, endSample })), [
		{ startSample: 0, endSample: 96_000 },
		{ startSample: 160_000, endSample: 192_000 },
	]);
});

test('reaction threshold is bounded and changes proposals without mutating reviewed scores', () => {
	assert.deepEqual(createAssistanceReactionProposals(REVIEW, { threshold: 0.85 })
		.map(({ label }) => label), ['Cheering']);
	for (const threshold of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.throws(() => createAssistanceReactionProposals(REVIEW, { threshold }), /threshold/iu);
	}
	assert.equal(REVIEW.windows[0]?.scores.laughter, 0.5);
});

test('reaction proposer refuses bodies that have not passed the exact audio-tags schema', () => {
	assert.throws(() => createAssistanceReactionProposals({ ...REVIEW, kind: 'audio-tags' } as never),
		/fields/iu);
	assert.throws(() => createAssistanceReactionProposals({
		schemaVersion: 1, sampleRate: 32_000, windowSamples: 32_000,
		windows: new Array(MAXIMUM_ASSISTANCE_AUDIO_TAG_WINDOWS + 1),
	} as never), /bound/iu);
});
