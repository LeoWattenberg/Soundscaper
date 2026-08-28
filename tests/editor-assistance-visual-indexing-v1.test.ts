/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	fuseAssistanceSearchRanksV1,
	sampleAssistanceShotsV1,
} from '../src/common/editor/assistance/visual-indexing-v1.ts';

test('shot sampling uses midpoint, thirds, then quarter/midpoint anchors deterministically', () => {
	assert.deepEqual(sampleAssistanceShotsV1([
		{ shotId: 'short', startFrame: 0, endFrame: 4_000 },
		{ shotId: 'medium', startFrame: 10_000, endFrame: 22_000 },
		{ shotId: 'long', startFrame: 30_000, endFrame: 50_000 },
	], 1_000), [
		{ shotId: 'short', sourceFrame: 2_000, anchor: 'midpoint' },
		{ shotId: 'medium', sourceFrame: 14_000, anchor: 'first-third' },
		{ shotId: 'medium', sourceFrame: 18_000, anchor: 'second-third' },
		{ shotId: 'long', sourceFrame: 35_000, anchor: 'first-quarter' },
		{ shotId: 'long', sourceFrame: 40_000, anchor: 'midpoint' },
		{ shotId: 'long', sourceFrame: 45_000, anchor: 'third-quarter' },
	]);
});

test('sampling keeps every anchor inside its shot and refuses malformed shot geometry', () => {
	assert.deepEqual(sampleAssistanceShotsV1([
		{ shotId: 'single', startFrame: 7, endFrame: 8 },
	], 48_000), [{ shotId: 'single', sourceFrame: 7, anchor: 'midpoint' }]);
	assert.throws(() => sampleAssistanceShotsV1([
		{ shotId: 'later', startFrame: 10, endFrame: 20 },
		{ shotId: 'earlier', startFrame: 0, endFrame: 5 },
	], 48_000), /ordered|shot/iu);
	assert.throws(() => sampleAssistanceShotsV1([
		{ shotId: 'empty', startFrame: 1, endFrame: 1 },
	], 48_000), /positive/iu);
});

test('reciprocal-rank fusion combines transcript, visual, and OCR without score-scale coupling', () => {
	const fused = fuseAssistanceSearchRanksV1({
		transcript: [
			{ resultId: 'shared', timelineFrame: 10, label: 'spoken shared' },
			{ resultId: 'transcript-only', timelineFrame: 20, label: 'spoken only' },
		],
		visual: [
			{ resultId: 'visual-only', timelineFrame: 30, label: 'visual only' },
			{ resultId: 'shared', timelineFrame: 10, label: 'shared image' },
		],
		ocr: [
			{ resultId: 'shared', timelineFrame: 10, label: 'shared title' },
			{ resultId: 'ocr-only', timelineFrame: 40, label: 'screen title' },
		],
	});

	assert.deepEqual(fused.map(({ resultId, timelineFrame, providers }) => ({
		resultId, timelineFrame, providers,
	})), [
		{ resultId: 'shared', timelineFrame: 10, providers: ['transcript', 'visual', 'ocr'] },
		{ resultId: 'visual-only', timelineFrame: 30, providers: ['visual'] },
		{ resultId: 'transcript-only', timelineFrame: 20, providers: ['transcript'] },
		{ resultId: 'ocr-only', timelineFrame: 40, providers: ['ocr'] },
	]);
	assert.ok(fused[0]!.score > fused[1]!.score);
});

test('reciprocal-rank fusion resolves equal-score positions by code-unit result ID', () => {
	const fused = fuseAssistanceSearchRanksV1({
		transcript: [{ resultId: 'alpha', timelineFrame: 10, label: 'spoken' }],
		visual: [{ resultId: 'Zebra', timelineFrame: 10, label: 'visual' }],
		ocr: [],
	});

	assert.deepEqual(fused.map(({ resultId }) => resultId), ['Zebra', 'alpha']);
});

test('fused search suppresses duplicate provider identities and stale timing disagreements', () => {
	assert.throws(() => fuseAssistanceSearchRanksV1({
		transcript: [
			{ resultId: 'same', timelineFrame: 10, label: 'one' },
			{ resultId: 'same', timelineFrame: 10, label: 'two' },
		],
		visual: [], ocr: [],
	}), /duplicate/iu);
	assert.throws(() => fuseAssistanceSearchRanksV1({
		transcript: [{ resultId: 'same', timelineFrame: 10, label: 'one' }],
		visual: [{ resultId: 'same', timelineFrame: 11, label: 'two' }],
		ocr: [],
	}), /timeline|disagree/iu);
	assert.throws(() => fuseAssistanceSearchRanksV1({
		transcript: [{ resultId: 'bad', timelineFrame: 0, label: 'bad', score: Number.NaN }],
		visual: [], ocr: [],
	} as never), /fields|unsupported/iu);
});
