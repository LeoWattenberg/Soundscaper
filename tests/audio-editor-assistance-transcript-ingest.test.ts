/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ingestRecognitionResult,
	type RecognitionResult,
} from '../src/common/editor/assistance/transcript-ingest.ts';

const OPTIONS = Object.freeze({
	sourceId: 'source-1',
	sampleRate: 48_000,
	modelId: 'parakeet-tdt-0.6b-v2',
});

function resultOf(segments: RecognitionResult['segments'], language: string | null = 'en'): RecognitionResult {
	return { language, segments };
}

test('seconds are rounded to the nearest sample frame', () => {
	const report = ingestRecognitionResult(resultOf([
		{ startSeconds: 0, endSeconds: 1, text: 'one' },
		{ startSeconds: 1.5, endSeconds: 2.000_01, text: 'two' },
	]), OPTIONS);

	assert.deepEqual(
		report.transcript.segments.map(({ startFrame, endFrame }) => [startFrame, endFrame]),
		[[0, 48_000], [72_000, 96_000]],
		'2.00001 s rounds to 96000 rather than truncating to 96000 minus a sample',
	);
	assert.equal(report.conformedBoundaries, 0);
	assert.equal(report.droppedSegments, 0);
});

test('an overlap reported by the model becomes an abutment rather than a refusal', () => {
	const report = ingestRecognitionResult(resultOf([
		{ startSeconds: 0, endSeconds: 1.02, text: 'first' },
		{ startSeconds: 1, endSeconds: 2, text: 'second' },
	]), OPTIONS);

	assert.deepEqual(
		report.transcript.segments.map(({ startFrame, endFrame }) => [startFrame, endFrame]),
		[[0, 48_960], [48_960, 96_000]],
	);
	assert.equal(report.conformedBoundaries, 1, 'the adjustment is counted, not hidden');
});

test('words are clamped inside their segment and kept ordered', () => {
	const report = ingestRecognitionResult(resultOf([{
		startSeconds: 1,
		endSeconds: 2,
		words: [
			{ text: 'early', startSeconds: 0.5, endSeconds: 1.2 },
			{ text: 'overlapping', startSeconds: 1.1, endSeconds: 1.5 },
			{ text: 'late', startSeconds: 1.9, endSeconds: 2.5 },
		],
	}]), OPTIONS);

	const [segment] = report.transcript.segments;
	assert.deepEqual(
		segment?.words.map(({ text, startFrame, endFrame }) => [text, startFrame, endFrame]),
		[
			['early', 48_000, 57_600],
			['overlapping', 57_600, 72_000],
			['late', 91_200, 96_000],
		],
	);
	assert.ok(report.conformedBoundaries >= 3);
	assert.equal(segment?.text, 'early overlapping late', 'text derives from the kept words');
});

test('boundaries are clamped inside the media when its length is known', () => {
	const report = ingestRecognitionResult(
		resultOf([{ startSeconds: 0, endSeconds: 10, text: 'runs long' }]),
		{ ...OPTIONS, sourceFrameCount: 48_000 },
	);

	assert.deepEqual(
		report.transcript.segments.map(({ endFrame }) => endFrame),
		[48_000],
	);
	assert.equal(report.conformedBoundaries, 1);
});

test('a segment that carries no frames after rounding is dropped and counted', () => {
	const report = ingestRecognitionResult(resultOf([
		{ startSeconds: 1, endSeconds: 1, text: 'empty' },
		{ startSeconds: 1.000_001, endSeconds: 1.000_002, text: 'sub-sample' },
		{ startSeconds: 2, endSeconds: 3, text: 'kept' },
	]), OPTIONS);

	assert.deepEqual(report.transcript.segments.map(({ text }) => text), ['kept']);
	assert.equal(report.droppedSegments, 2);
});

test('a segment with no usable text is dropped rather than labelled blank', () => {
	const report = ingestRecognitionResult(resultOf([
		{ startSeconds: 0, endSeconds: 1, words: [{ text: '   ', startSeconds: 0, endSeconds: 1 }] },
		{ startSeconds: 1, endSeconds: 2, text: 'kept' },
	]), OPTIONS);

	assert.deepEqual(report.transcript.segments.map(({ text }) => text), ['kept']);
	assert.equal(report.droppedSegments, 1);
	assert.equal(report.droppedWords, 1);
});

test('speakers and language survive ingest', () => {
	const report = ingestRecognitionResult(resultOf([
		{ startSeconds: 0, endSeconds: 1, text: 'hello', speaker: 'Speaker 1' },
	], 'de'), OPTIONS);

	assert.equal(report.transcript.language, 'de');
	assert.equal(report.transcript.segments[0]?.speaker, 'Speaker 1');
	assert.equal(report.transcript.modelId, 'parakeet-tdt-0.6b-v2');
});

test('unusable times and rates are refused rather than conformed', () => {
	assert.throws(
		() => ingestRecognitionResult(resultOf([{ startSeconds: -1, endSeconds: 1, text: 'x' }]), OPTIONS),
		/non-negative number of seconds/iu,
	);
	assert.throws(
		() => ingestRecognitionResult(resultOf([{ startSeconds: 0, endSeconds: Number.NaN, text: 'x' }]), OPTIONS),
		/finite, non-negative/iu,
	);
	assert.throws(
		() => ingestRecognitionResult(resultOf([{ startSeconds: 0, endSeconds: 1, text: 'x' }]), { ...OPTIONS, sampleRate: 0 }),
		/positive integer sample rate/iu,
	);
	assert.throws(
		() => ingestRecognitionResult(
			resultOf([{ startSeconds: 0, endSeconds: 1e12, text: 'x' }]),
			OPTIONS,
		),
		/representable sample frame/iu,
	);
	assert.throws(
		() => ingestRecognitionResult({ segments: null } as unknown as RecognitionResult, OPTIONS),
		/array of segments/iu,
	);
});

test('ingest is deterministic for the same recognition result', () => {
	const result = resultOf([
		{ startSeconds: 0, endSeconds: 1.02, words: [{ text: 'um', startSeconds: 0.1, endSeconds: 0.4 }] },
		{ startSeconds: 1, endSeconds: 2, text: 'second' },
	]);

	assert.deepEqual(
		ingestRecognitionResult(result, OPTIONS).transcript,
		ingestRecognitionResult(result, OPTIONS).transcript,
	);
});
