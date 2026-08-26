/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	HIGHLIGHT_RANKING_V1_WEIGHTS,
	rankAssistanceHighlightsV1,
} from '../src/common/editor/assistance/highlight-ranking-v1.ts';

const SAMPLE_RATE = 1_000;

function candidate(
	id: string,
	startSeconds: number,
	overrides: Readonly<Record<string, unknown>> = {},
) {
	return {
		id,
		startFrame: startSeconds * SAMPLE_RATE,
		endFrame: (startSeconds + 30) * SAMPLE_RATE,
		transcriptEvidence: true,
		speechlessAvailableWeight: 1,
		hook: 0,
		conversationalStructure: 0,
		excitement: 0,
		energyDynamics: 0,
		semanticSelfContainedness: 0,
		shotStructure: 0,
		visualInterest: 0,
		duplication: 0,
		...overrides,
	};
}

test('ranking v1 uses the fixed launch weights and returns initially unselected proposals', () => {
	assert.deepEqual(HIGHLIGHT_RANKING_V1_WEIGHTS, {
		hook: 0.25,
		conversationalStructure: 0.2,
		excitement: 0.25,
		energyDynamics: 0.15,
		semanticSelfContainedness: 0.15,
	});
	const ranked = rankAssistanceHighlightsV1([
		candidate('hook', 0, { hook: 1 }),
		candidate('conversation', 40, { conversationalStructure: 1 }),
		candidate('reaction', 80, { excitement: 1 }),
		candidate('energy', 120, { energyDynamics: 1 }),
		candidate('semantic', 160, { semanticSelfContainedness: 1 }),
	], { sampleRate: SAMPLE_RATE });

	assert.deepEqual(ranked.map(({ id, score, selected }) => ({ id, score, selected })), [
		{ id: 'hook', score: 0.25, selected: false },
		{ id: 'reaction', score: 0.25, selected: false },
		{ id: 'conversation', score: 0.2, selected: false },
		{ id: 'energy', score: 0.15, selected: false },
		{ id: 'semantic', score: 0.15, selected: false },
	]);
});

test('speechless candidates use only shot, reaction, energy, and visual evidence', () => {
	const [speechless] = rankAssistanceHighlightsV1([candidate('silent', 0, {
		transcriptEvidence: false,
		hook: 1,
		conversationalStructure: 1,
		semanticSelfContainedness: 1,
		shotStructure: 0.5,
		excitement: 0.4,
		energyDynamics: 0.3,
		visualInterest: 0.2,
	})], { sampleRate: SAMPLE_RATE });

	assert.equal(speechless?.score, 0.2 * 0.5 + 0.25 * 0.4 + 0.15 * 0.3 + 0.4 * 0.2);
	assert.equal(speechless?.evidenceMode, 'speechless');
});

test('speechless ranking renormalizes only over authenticated available evidence', () => {
	const [energyOnly] = rankAssistanceHighlightsV1([candidate('energy-only', 0, {
		transcriptEvidence: false,
		speechlessAvailableWeight: 0.15,
		energyDynamics: 0.6,
	})], { sampleRate: SAMPLE_RATE });
	const [noEvidence] = rankAssistanceHighlightsV1([candidate('no-evidence', 0, {
		transcriptEvidence: false,
		speechlessAvailableWeight: 0,
	})], { sampleRate: SAMPLE_RATE });

	assert.equal(energyOnly?.score, 0.6);
	assert.equal(noEvidence?.score, 0);
});

test('ranking applies the fixed duplication penalty before stable tie breaking', () => {
	const ranked = rankAssistanceHighlightsV1([
		candidate('later', 80, { hook: 0.8 }),
		candidate('penalized', 0, { hook: 1, duplication: 0.5 }),
		candidate('earlier-b', 40, { hook: 0.8 }),
		candidate('earlier-a', 40, { hook: 0.8 }),
	], { sampleRate: SAMPLE_RATE });

	assert.deepEqual(ranked.map(({ id }) => id), [
		'penalized', 'earlier-a', 'later',
	]);
	assert.equal(ranked[0]?.score, 0.225);
});

test('selection suppresses candidates whose overlap exceeds 25 percent', () => {
	const ranked = rankAssistanceHighlightsV1([
		candidate('best', 0, { excitement: 1 }),
		candidate('exact-quarter', 22.5, { excitement: 0.9 }),
		candidate('over-quarter', 22, { excitement: 0.8 }),
		candidate('disjoint', 60, { excitement: 0.7 }),
	], { sampleRate: SAMPLE_RATE, maximumResults: 4 });

	assert.deepEqual(ranked.map(({ id }) => id), ['best', 'exact-quarter', 'disjoint']);
});

test('count and duration controls are bounded and malformed evidence fails closed', () => {
	const values = Array.from({ length: 22 }, (_, index) => candidate(`candidate-${index}`, index * 200, {
		hook: 1 - index / 100,
	}));
	assert.equal(rankAssistanceHighlightsV1(values, { sampleRate: SAMPLE_RATE }).length, 5);
	assert.equal(rankAssistanceHighlightsV1(values, {
		sampleRate: SAMPLE_RATE, maximumResults: 20, maximumDurationSeconds: 180,
	}).length, 20);
	assert.deepEqual(rankAssistanceHighlightsV1([
		candidate('short', 0, { endFrame: 14_999 }),
		candidate('long', 200, { endFrame: 261_000 }),
	], { sampleRate: SAMPLE_RATE }), []);

	assert.throws(() => rankAssistanceHighlightsV1(values, {
		sampleRate: SAMPLE_RATE, maximumResults: 21,
	}), /result count/iu);
	assert.throws(() => rankAssistanceHighlightsV1(values, {
		sampleRate: SAMPLE_RATE, maximumDurationSeconds: 181,
	}), /duration/iu);
	assert.throws(() => rankAssistanceHighlightsV1([
		candidate('nan', 0, { excitement: Number.NaN }),
	], { sampleRate: SAMPLE_RATE }), /unit interval/iu);
	assert.throws(() => rankAssistanceHighlightsV1([
		candidate('bad-availability', 0, { speechlessAvailableWeight: 1.01 }),
	], { sampleRate: SAMPLE_RATE }), /available weight/iu);
	assert.throws(() => rankAssistanceHighlightsV1([
		candidate('nan-availability', 0, { speechlessAvailableWeight: Number.NaN }),
	], { sampleRate: SAMPLE_RATE }), /available weight/iu);
	assert.throws(() => rankAssistanceHighlightsV1([
		candidate('duplicate', 0), candidate('duplicate', 100),
	], { sampleRate: SAMPLE_RATE }), /unique/iu);
});
