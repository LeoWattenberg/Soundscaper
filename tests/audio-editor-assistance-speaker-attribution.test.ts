/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { attributeTranscriptSpeakers } from '../src/common/editor/assistance/speaker-attribution.ts';
import { createAssistanceTranscript } from '../src/common/editor/assistance/transcript.ts';

function transcript() {
	return createAssistanceTranscript({
		sourceId: 'source-1', sampleRate: 48_000, language: 'en', modelId: 'parakeet',
		segments: [
			{ startFrame: 0, endFrame: 48_000, text: 'first' },
			{ startFrame: 48_000, endFrame: 96_000, text: 'second', speaker: 'Old label' },
			{ startFrame: 120_000, endFrame: 144_000, text: 'unattributed' },
		],
	});
}

test('speaker attribution uses greatest aggregate temporal overlap at unlike sample rates', () => {
	const attributed = attributeTranscriptSpeakers(transcript(), {
		sampleRate: 16_000,
		turns: [
			{ startFrame: 0, endFrame: 8_000, speakerId: 1 },
			{ startFrame: 8_000, endFrame: 16_000, speakerId: 0 },
			{ startFrame: 16_000, endFrame: 22_000, speakerId: 1 },
			{ startFrame: 22_000, endFrame: 32_000, speakerId: 0 },
		],
	});

	assert.deepEqual(attributed.segments.map(({ speaker }) => speaker), [
		'Speaker 1',
		'Speaker 1',
		null,
	]);
	assert.equal(attributed.segments[1]?.text, 'second');
	assert.equal(attributed.segments[1]?.startFrame, 48_000);
});

test('speaker attribution aggregates disjoint turns and resolves exact ties by stable speaker id', () => {
	const input = createAssistanceTranscript({
		sourceId: 'source-1', sampleRate: 16_000, modelId: 'parakeet',
		segments: [{ startFrame: 0, endFrame: 16_000, text: 'one second' }],
	});
	const attributed = attributeTranscriptSpeakers(input, {
		sampleRate: 16_000,
		turns: [
			{ startFrame: 0, endFrame: 4_000, speakerId: 2 },
			{ startFrame: 4_000, endFrame: 8_000, speakerId: 1 },
			{ startFrame: 8_000, endFrame: 12_000, speakerId: 2 },
			{ startFrame: 12_000, endFrame: 16_000, speakerId: 1 },
		],
	});

	assert.equal(attributed.segments[0]?.speaker, 'Speaker 2');
});

test('overlapping speakers remain distinct candidates rather than being flattened', () => {
	const input = createAssistanceTranscript({
		sourceId: 'source-1', sampleRate: 16_000, modelId: 'parakeet',
		segments: [{ startFrame: 0, endFrame: 16_000, text: 'overlap' }],
	});
	const attributed = attributeTranscriptSpeakers(input, {
		sampleRate: 16_000,
		turns: [
			{ startFrame: 0, endFrame: 16_000, speakerId: 3 },
			{ startFrame: 4_000, endFrame: 12_000, speakerId: 0 },
		],
	});

	assert.equal(attributed.segments[0]?.speaker, 'Speaker 4');
});

test('speaker attribution refuses unstable turn geometry', () => {
	assert.throws(() => attributeTranscriptSpeakers(transcript(), {
		sampleRate: 16_000,
		turns: [
			{ startFrame: 10, endFrame: 20, speakerId: 0 },
			{ startFrame: 9, endFrame: 30, speakerId: 1 },
		],
	}), /ordered/iu);
	assert.throws(() => attributeTranscriptSpeakers(transcript(), {
		sampleRate: 16_000,
		turns: [{ startFrame: 10, endFrame: 10, speakerId: 0 }],
	}), /duration/iu);
});
