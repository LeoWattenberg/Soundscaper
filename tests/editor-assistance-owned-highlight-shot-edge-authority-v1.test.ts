/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { gatherOwnedHighlightSignalsV1 } from
	'../src/common/editor/assistance/owned-highlight-workflow-transforms-v1.ts';
import { createLocalAssistanceGuidedHighlightVideoSignalsV1 } from
	'../src/common/editor/controller/assistance/internal/guided/local-assistance-guided-highlight-signals.ts';

const SETTINGS = Object.freeze({
	settingsVersion: 1 as const,
	workflowId: 'make-highlights' as const,
	resultCount: 2,
	minimumDurationSeconds: 15 as const,
	maximumDurationSeconds: 60,
	targetAspectWidth: 9 as const,
	targetAspectHeight: 16 as const,
	editorialRerank: false,
});
const SOURCE_END_FRAME = 900;
const EXPECTED_SOURCE_RANGES = [
	[0, 60], [120, 180], [240, 300], [360, 420],
	[480, 540], [600, 660], [720, 780], [840, 900],
];

test('whole-file shot counts equal to the selected source end still gather highlights', () => {
	const gathered = gatherOwnedHighlightSignalsV1(
		highlightInputs(SOURCE_END_FRAME), SETTINGS,
	);
	assert.deepEqual(gathered.candidates.map(({ sourceStartFrame, sourceEndFrame }) =>
		[sourceStartFrame, sourceEndFrame]), EXPECTED_SOURCE_RANGES);
	assert.deepEqual(gathered.candidates.map(({ startFrame, endFrame }) => [startFrame, endFrame]),
		EXPECTED_SOURCE_RANGES.map(([start, end]) => [start! * 1_000, end! * 1_000]));
	assert.ok(gathered.candidates.every(({ shotStructure }) => shotStructure > 0));
});

test('whole-file shot counts beyond a trimmed selected source end stay admitted', () => {
	const gathered = gatherOwnedHighlightSignalsV1(highlightInputs(1_200), SETTINGS);
	assert.deepEqual(gathered.candidates.map(({ sourceStartFrame, sourceEndFrame }) =>
		[sourceStartFrame, sourceEndFrame]), EXPECTED_SOURCE_RANGES);
});

test('shot counts short of the selected source end remain refused', () => {
	assert.throws(() => gatherOwnedHighlightSignalsV1(highlightInputs(800), SETTINGS),
		/Highlight shots disagree with exact source-time authority\./u);
});

function highlightInputs(sourceFrameCount: number) {
	return {
		video: highlightVideoSignals(),
		audio: null,
		transcript: null,
		'shot-boundaries': {
			schemaVersion: 1 as const, detector: 'transnetv2' as const, timescale: 1_000,
			sourceFrameCount,
			boundaries: Array.from({ length: 14 }, (_, index) => (index + 1) * 60)
				.filter((sourceFrame) => sourceFrame < sourceFrameCount)
				.map((sourceFrame) => ({ sourceFrame,
					presentationTick: String(sourceFrame * 100), score: 1 })),
		},
		'audio-tags': null,
		'reaction-ranges': null,
		embeddings: null,
	};
}

function highlightVideoSignals() {
	return createLocalAssistanceGuidedHighlightVideoSignalsV1({
		authority: sourceTimeAuthority(), audioOccurrenceId: null, settings: SETTINGS,
	});
}

function sourceTimeAuthority() {
	return {
		descriptorVersion: 1 as const, kind: 'selected-video-source-time-authority' as const,
		schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
		projectId: 'project-a', projectRevision: 3, sequenceId: 'sequence-a',
		videoOccurrenceId: 'video-occurrence', sourceId: 'video-source',
		sourceSha256: '12'.repeat(32), timingAuthoritySha256: '34'.repeat(32),
		sourceWidth: 1_920, sourceHeight: 1_080,
		sourceStartFrame: 0, sourceEndFrame: SOURCE_END_FRAME,
		sampleRate: 1_000, timescale: 1_000,
		selectionStartFrame: 0, selectionEndFrame: SOURCE_END_FRAME * 1_000,
		frames: Array.from({ length: SOURCE_END_FRAME / 30 + 1 }, (_, index) => {
			const sourceFrame = index * 30;
			return { sourceFrame, presentationTick: String(sourceFrame * 100),
				timelineFrame: sourceFrame * 1_000 };
		}),
	};
}
