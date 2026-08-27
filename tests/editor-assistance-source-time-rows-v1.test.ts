/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceSourceTimeRowChunksV1,
	reviewAssistanceSourceTimeRowsV1,
} from '../src/common/editor/assistance/source-time-rows-v1.ts';

test('compact source-time chunks reject truncation, noncanonical base64, mixed forms, and order drift', () => {
	const chunks = createAssistanceSourceTimeRowChunksV1((function* () {
		for (let sourceFrame = 0; sourceFrame < 65_538; sourceFrame += 1) {
			yield { sourceFrame, presentationTick: String(sourceFrame + 1),
				timelineFrame: sourceFrame * 2 };
		}
	})());
	assert.equal(chunks.length, 2);
	assert.equal(reviewAssistanceSourceTimeRowsV1(chunks).rowCount, 65_538);
	assert.throws(() => reviewAssistanceSourceTimeRowsV1([
		{ ...chunks[0]!, bodyBase64: chunks[0]!.bodyBase64.slice(0, -4) }, chunks[1]!,
	]), /byte geometry|truncated|base64/iu);
	const padded = createAssistanceSourceTimeRowChunksV1([
		{ sourceFrame: 0, presentationTick: '1', timelineFrame: 0 },
		{ sourceFrame: 1, presentationTick: '2', timelineFrame: 1 },
	])[0]!;
	assert.ok(padded.bodyBase64.endsWith('=='));
	assert.throws(() => reviewAssistanceSourceTimeRowsV1([{
		...padded, bodyBase64: `${padded.bodyBase64.slice(0, -3)}B==`,
	}]), /base64|canonical/iu);
	assert.throws(() => reviewAssistanceSourceTimeRowsV1([
		{ sourceFrame: 0, presentationTick: '1', timelineFrame: 0 }, chunks[0]!,
	]), /fields|row|authority/iu);
	assert.throws(() => reviewAssistanceSourceTimeRowsV1([chunks[1]!, chunks[0]!]),
		/order|forward|summary/iu);
});

test('compact source-time chunks reject endpoint-summary substitution', () => {
	const chunks = createAssistanceSourceTimeRowChunksV1([
		{ sourceFrame: 20, presentationTick: '100', timelineFrame: 2_000 },
		{ sourceFrame: 30, presentationTick: '200', timelineFrame: 4_000 },
	]);
	assert.throws(() => reviewAssistanceSourceTimeRowsV1([
		{ ...chunks[0]!, lastSourceFrame: 29 },
	]), /summary/iu);
});
