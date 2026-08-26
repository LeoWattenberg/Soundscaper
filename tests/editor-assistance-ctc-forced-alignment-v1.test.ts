/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	alignAssistanceCtcWordsV1,
} from '../src/common/editor/assistance/ctc-forced-alignment-v1.ts';

const NEGATIVE = -20;

function emissions(rows: readonly (readonly number[])[]): Float32Array {
	return Float32Array.from(rows.flat());
}

function request(overrides: Readonly<Record<string, unknown>> = {}) {
	const rows = [
		[0, NEGATIVE, NEGATIVE],
		[NEGATIVE, 0, NEGATIVE],
		[0, NEGATIVE, NEGATIVE],
		[NEGATIVE, NEGATIVE, 0],
		[0, NEGATIVE, NEGATIVE],
	];
	return {
		schemaVersion: 1,
		sampleRate: 16_000,
		frameStrideSamples: 320,
		blankTokenId: 0,
		vocabularySize: 3,
		frameCount: rows.length,
		emissionLogProbabilities: emissions(rows),
		words: [
			{ segmentIndex: 0, wordIndex: 0, text: 'Hello', tokenIds: [1] },
			{ segmentIndex: 0, wordIndex: 1, text: 'world', tokenIds: [2] },
		],
		...overrides,
	};
}

test('CTC alignment emits canonical ordered 16 kHz word geometry', () => {
	assert.deepEqual(alignAssistanceCtcWordsV1(request()), {
		schemaVersion: 1,
		sampleRate: 16_000,
		words: [
			{ segmentIndex: 0, wordIndex: 0, text: 'Hello', startSample: 320,
				endSample: 640, confidence: 1 },
			{ segmentIndex: 0, wordIndex: 1, text: 'world', startSample: 960,
				endSample: 1_280, confidence: 1 },
		],
	});
});

test('CTC alignment requires a blank between repeated adjacent tokens', () => {
	const rows = [
		[0, -10], [-10, 0], [0, -10], [-10, 0], [0, -10],
	];
	const result = alignAssistanceCtcWordsV1(request({
		vocabularySize: 2,
		frameCount: rows.length,
		emissionLogProbabilities: emissions(rows),
		words: [
			{ segmentIndex: 0, wordIndex: 0, text: 'one', tokenIds: [1] },
			{ segmentIndex: 0, wordIndex: 1, text: 'again', tokenIds: [1] },
		],
	}));
	assert.deepEqual(result.words.map(({ startSample, endSample }) => [startSample, endSample]), [
		[320, 640], [960, 1_280],
	]);
});

test('CTC alignment is deterministic for tied paths and averages token confidence', () => {
	const result = alignAssistanceCtcWordsV1(request({
		frameCount: 4,
		emissionLogProbabilities: emissions([
			[0, -1, -10], [-1, -1, -10], [-1, -10, -0.5], [0, -10, -10],
		]),
	}));
	assert.equal(result.words[0]?.startSample, 320);
	assert.ok(Math.abs(result.words[0]!.confidence! - Math.exp(-1)) < 1e-12);
	assert.ok(Math.abs(result.words[1]!.confidence! - Math.exp(-0.5)) < 1e-12);
});

test('CTC alignment refuses malformed emissions, transcript order, unreachable paths, and excess work', () => {
	assert.throws(() => alignAssistanceCtcWordsV1(request({
		emissionLogProbabilities: Float32Array.of(Number.NaN, ...request()
			.emissionLogProbabilities.slice(1)),
	})), /emission.*NaN|finite/iu);
	assert.throws(() => alignAssistanceCtcWordsV1(request({
		words: [
			{ segmentIndex: 0, wordIndex: 1, text: 'later', tokenIds: [1] },
			{ segmentIndex: 0, wordIndex: 0, text: 'earlier', tokenIds: [2] },
		],
	})), /transcript order/iu);
	assert.throws(() => alignAssistanceCtcWordsV1(request({
		frameCount: 1,
		emissionLogProbabilities: emissions([[0, -1, -1]]),
	})), /reachable|frames/iu);
	assert.throws(() => alignAssistanceCtcWordsV1(request({
		frameCount: 100_001,
		emissionLogProbabilities: new Float32Array(100_001 * 3),
	})), /bound|work|frame count/iu);
});

test('CTC alignment requires exact fields, token bounds, and a Float32 emission matrix', () => {
	assert.throws(() => alignAssistanceCtcWordsV1({ ...request(), extra: true }), /fields/iu);
	assert.throws(() => alignAssistanceCtcWordsV1(request({
		words: [{ segmentIndex: 0, wordIndex: 0, text: 'bad', tokenIds: [3] }],
	})), /token/iu);
	assert.throws(() => alignAssistanceCtcWordsV1(request({
		emissionLogProbabilities: Array.from(request().emissionLogProbabilities),
	})), /Float32Array/iu);
});
