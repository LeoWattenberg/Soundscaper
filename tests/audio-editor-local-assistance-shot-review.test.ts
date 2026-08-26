/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	reviewLocalAssistanceShotBoundaries,
} from '../src/common/editor/ui/local-assistance-shot-review.ts';

function result() {
	return {
		schemaVersion: 1,
		detector: 'ffmpeg-scdet',
		timescale: 90_000,
		sourceFrameCount: 240,
		boundaries: [
			{ sourceFrame: 24, presentationTick: '90090', score: 0.425 },
			{ sourceFrame: 120, presentationTick: '450450', score: 1 },
		],
	};
}

function accurateResult() {
	return { ...result(), detector: 'transnetv2' };
}

test('reviews exact ordered FFmpeg shot boundaries without changing their source authority', () => {
	assert.deepEqual(reviewLocalAssistanceShotBoundaries(result()), {
		kind: 'shot-boundaries',
		schemaVersion: 1,
		detector: 'ffmpeg-scdet',
		timescale: 90_000,
		sourceFrameCount: 240,
		boundaries: [
			{ sourceFrame: 24, presentationTick: '90090', score: 0.425 },
			{ sourceFrame: 120, presentationTick: '450450', score: 1 },
		],
	});
	assert.deepEqual(reviewLocalAssistanceShotBoundaries({ ...result(), boundaries: [] }).boundaries, []);
});

test('reviews exact ordered TransNetV2 boundaries in the same canonical form', () => {
	assert.deepEqual(reviewLocalAssistanceShotBoundaries(accurateResult()), {
		kind: 'shot-boundaries',
		schemaVersion: 1,
		detector: 'transnetv2',
		timescale: 90_000,
		sourceFrameCount: 240,
		boundaries: [
			{ sourceFrame: 24, presentationTick: '90090', score: 0.425 },
			{ sourceFrame: 120, presentationTick: '450450', score: 1 },
		],
	});
});

test('shot review rejects unknown schemas, detectors, fields, and collection overflows', () => {
	for (const candidate of [
		{ ...result(), schemaVersion: 2 },
		{ ...result(), detector: 'claimed-accurate-model' },
		{ ...accurateResult(), detector: 'ffmpeg-scdet-v2' },
		{ ...result(), extra: true },
		{ ...result(), boundaries: Array.from({ length: 241 }, (_, sourceFrame) => ({
			sourceFrame, presentationTick: String(sourceFrame), score: 0.5,
		})) },
	]) assert.throws(() => reviewLocalAssistanceShotBoundaries(candidate), /shot|bound|schema|field/iu);
});

test('shot review rejects malformed frame, tick, score, and ordering evidence', () => {
	for (const detector of ['ffmpeg-scdet', 'transnetv2']) for (const boundary of [
		{ sourceFrame: -1, presentationTick: '1', score: 0.5 },
		{ sourceFrame: 240, presentationTick: '1', score: 0.5 },
		{ sourceFrame: 1.5, presentationTick: '1', score: 0.5 },
		{ sourceFrame: 1, presentationTick: '01', score: 0.5 },
		{ sourceFrame: 1, presentationTick: '-1', score: 0.5 },
		{ sourceFrame: 1, presentationTick: String(0x8000_0000_0000_0000n), score: 0.5 },
		{ sourceFrame: 1, presentationTick: '1', score: -0.1 },
		{ sourceFrame: 1, presentationTick: '1', score: Number.NaN },
		{ sourceFrame: 1, presentationTick: '1', score: 1.1 },
		{ sourceFrame: 1, presentationTick: '1', score: 0.5, extra: true },
	]) assert.throws(() => reviewLocalAssistanceShotBoundaries({
		...result(), detector, boundaries: [boundary],
	}), /shot|boundary|frame|tick|score|field/iu, JSON.stringify(boundary));

	for (const detector of ['ffmpeg-scdet', 'transnetv2']) for (const boundaries of [
		[
			{ sourceFrame: 5, presentationTick: '10', score: 0.5 },
			{ sourceFrame: 5, presentationTick: '11', score: 0.6 },
		],
		[
			{ sourceFrame: 5, presentationTick: '10', score: 0.5 },
			{ sourceFrame: 6, presentationTick: '10', score: 0.6 },
		],
	]) assert.throws(() => reviewLocalAssistanceShotBoundaries({
		...result(), detector, boundaries,
	}), /ordered|increasing/iu);
});
