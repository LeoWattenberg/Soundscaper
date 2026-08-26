/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { voiceActivitySilenceProposals } from '../src/common/editor/assistance/vad-silence.ts';

test('VAD gaps become bounded leading, interior, and trailing silence proposals', () => {
	assert.deepEqual(voiceActivitySilenceProposals({
		sampleRate: 16_000,
		selectionStartFrame: 0,
		selectionEndFrame: 64_000,
		segments: [
			{ startFrame: 8_000, endFrame: 24_000 },
			{ startFrame: 40_000, endFrame: 56_000 },
		],
	}, { minimumFrames: 4_000, paddingFrames: 1_000 }), [
		{ id: 'vad-silence-0-7000', kind: 'silence', startFrame: 0, endFrame: 7_000, text: '' },
		{ id: 'vad-silence-25000-39000', kind: 'silence', startFrame: 25_000, endFrame: 39_000, text: '' },
		{ id: 'vad-silence-57000-64000', kind: 'silence', startFrame: 57_000, endFrame: 64_000, text: '' },
	]);
});

test('VAD silence threshold applies after speech padding', () => {
	assert.deepEqual(voiceActivitySilenceProposals({
		sampleRate: 16_000,
		selectionStartFrame: 0,
		selectionEndFrame: 16_000,
		segments: [{ startFrame: 0, endFrame: 8_000 }],
	}, { minimumFrames: 7_501, paddingFrames: 500 }), []);
});

test('an empty VAD result proposes the whole exact selection without inventing speech', () => {
	assert.deepEqual(voiceActivitySilenceProposals({
		sampleRate: 16_000,
		selectionStartFrame: 1_000,
		selectionEndFrame: 17_000,
		segments: [],
	}, { minimumFrames: 16_000 }), [{
		id: 'vad-silence-1000-17000', kind: 'silence', startFrame: 1_000, endFrame: 17_000, text: '',
	}]);
});

test('VAD silence refuses overlapping or out-of-selection speech geometry', () => {
	assert.throws(() => voiceActivitySilenceProposals({
		sampleRate: 16_000, selectionStartFrame: 0, selectionEndFrame: 16_000,
		segments: [
			{ startFrame: 0, endFrame: 10_000 },
			{ startFrame: 9_999, endFrame: 12_000 },
		],
	}), /ordered and disjoint/iu);
	assert.throws(() => voiceActivitySilenceProposals({
		sampleRate: 16_000, selectionStartFrame: 1_000, selectionEndFrame: 16_000,
		segments: [{ startFrame: 0, endFrame: 2_000 }],
	}), /selection/iu);
});
