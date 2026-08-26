/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { fuseAssistanceSearchRanksV1 } from
	'../src/common/editor/assistance/visual-indexing-v1.ts';
import {
	ASSISTANCE_VISUAL_SEARCH_RECORDS_MEDIA_TYPE,
	createAssistanceVisualSearchDerivativePayloadV1,
	createAssistanceVisualSearchRowsV1,
	createAssistanceVisualSearchSampleAuthorityV1,
	parseAssistanceVisualSearchRecordsV1,
	reviewAssistanceVisualSearchRecordsV1,
} from '../src/common/editor/assistance/visual-search-records-v1.ts';

const AUTHORITY = createAssistanceVisualSearchSampleAuthorityV1([
	{ shotId: 'short', startFrame: 0, endFrame: 100 },
	{ shotId: 'long', startFrame: 100, endFrame: 500 },
], 25, [1_000, 2_000, 2_100, 2_200]);

function records() {
	return {
		schemaVersion: 1,
		tagTaxonomyVersion: 1,
		visual: AUTHORITY.map((sample, embeddingRow) => ({
			recordVersion: 1,
			...sample,
			embeddingRow,
			tags: embeddingRow === 0
				? [{ tag: 'person', score: 0.9 }, { tag: 'presentation', score: 0.8 }]
				: [],
		})),
		ocr: [{
			recordVersion: 1,
			...AUTHORITY[0]!,
			text: 'Quarterly launch plan',
			confidence: 0.95,
		}],
	};
}

test('visual/OCR records bind versioned non-biometric metadata to deterministic sample jumps', () => {
	assert.deepEqual(AUTHORITY, [
		{ resultId: 'visual-sample:0', shotId: 'short', anchor: 'midpoint',
			sourceFrame: 50, timelineFrame: 1_000 },
		{ resultId: 'visual-sample:1', shotId: 'long', anchor: 'first-quarter',
			sourceFrame: 200, timelineFrame: 2_000 },
		{ resultId: 'visual-sample:2', shotId: 'long', anchor: 'midpoint',
			sourceFrame: 300, timelineFrame: 2_100 },
		{ resultId: 'visual-sample:3', shotId: 'long', anchor: 'third-quarter',
			sourceFrame: 400, timelineFrame: 2_200 },
	]);
	const reviewed = reviewAssistanceVisualSearchRecordsV1(records(), AUTHORITY);
	assert.equal(reviewed.visual[0]?.tags[0]?.tag, 'person');
	assert.equal(reviewed.ocr[0]?.timelineFrame, 1_000);
	assert.ok(Object.isFrozen(reviewed.visual[0]?.tags));

	const rows = createAssistanceVisualSearchRowsV1(reviewed, AUTHORITY);
	assert.deepEqual(rows.visual[0], {
		resultId: 'visual-sample:0', timelineFrame: 1_000,
		label: 'person, presentation',
	});
	assert.deepEqual(rows.ocr[0], {
		resultId: 'visual-sample:0', timelineFrame: 1_000,
		label: 'Quarterly launch plan',
	});
});

test('visual search records serialize canonically for the disposable derivative repository', () => {
	const payload = createAssistanceVisualSearchDerivativePayloadV1(records(), AUTHORITY);
	assert.equal(payload.mediaType, ASSISTANCE_VISUAL_SEARCH_RECORDS_MEDIA_TYPE);
	const parsed = parseAssistanceVisualSearchRecordsV1(payload.bytes, AUTHORITY);
	assert.deepEqual(parsed, reviewAssistanceVisualSearchRecordsV1(records(), AUTHORITY));
	assert.deepEqual(payload.bytes,
		createAssistanceVisualSearchDerivativePayloadV1(parsed, AUTHORITY).bytes);
});

test('versioned records retain one exact jump through transcript, visual, and OCR fusion', () => {
	const rows = createAssistanceVisualSearchRowsV1(records(), AUTHORITY);
	const fused = fuseAssistanceSearchRanksV1({
		transcript: [{ resultId: 'visual-sample:0', timelineFrame: 1_000,
			label: 'spoken launch plan' }],
		visual: rows.visual,
		ocr: rows.ocr,
	});
	assert.deepEqual({
		resultId: fused[0]?.resultId,
		timelineFrame: fused[0]?.timelineFrame,
		providers: fused[0]?.providers,
	}, {
		resultId: 'visual-sample:0', timelineFrame: 1_000,
		providers: ['transcript', 'visual', 'ocr'],
	});
});

test('visual search records reject biometric tags, invented jumps, row aliases, and unsafe OCR', () => {
	const biometric = records();
	biometric.visual[0]!.tags = [{ tag: 'face-identity', score: 1 }] as never;
	assert.throws(() => reviewAssistanceVisualSearchRecordsV1(biometric, AUTHORITY),
		/non-biometric|tag|taxonomy/iu);

	const extraIdentity = records();
	Object.assign(extraIdentity.visual[0]!, { personName: 'Alice' });
	assert.throws(() => reviewAssistanceVisualSearchRecordsV1(extraIdentity, AUTHORITY),
		/field|record/iu);

	const wrongJump = records();
	wrongJump.visual[0]!.timelineFrame = 999;
	assert.throws(() => reviewAssistanceVisualSearchRecordsV1(wrongJump, AUTHORITY),
		/authority|timeline|jump/iu);

	const wrongRow = records();
	wrongRow.visual[1]!.embeddingRow = 0;
	assert.throws(() => reviewAssistanceVisualSearchRecordsV1(wrongRow, AUTHORITY),
		/embedding|row/iu);

	const unsafeOcr = records();
	unsafeOcr.ocr[0]!.text = 'unsafe\u0000text';
	assert.throws(() => reviewAssistanceVisualSearchRecordsV1(unsafeOcr, AUTHORITY), /OCR|text/iu);
});
