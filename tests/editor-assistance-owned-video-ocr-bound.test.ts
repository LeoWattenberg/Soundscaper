/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAssistanceEmbeddingMatrixV1 } from
	'../src/common/editor/assistance/binary-formats-v1.ts';
import { publishOwnedVideoIndexV1 } from
	'../src/common/editor/assistance/owned-video-workflow-transforms-v1.ts';

test('video-index publication bounds dense OCR without splitting a surrogate pair', () => {
	const framePack = {
		schemaVersion: 1 as const, kind: 'frame-pack-plan' as const, sourceId: 'video-source',
		width: 1_920, height: 1_080, timescale: 1_000, frames: [{
			resultId: 'visual-sample:0', shotId: 'shot:000000', anchor: 'midpoint' as const,
			sourceFrame: 12, presentationTick: '400', timelineFrame: 19_200,
		}],
	};
	const firstText = 'a'.repeat(2_048);
	const secondText = `${'b'.repeat(2_046)}\u{1F600}`;
	const result = publishOwnedVideoIndexV1({
		'visual-embeddings': {
			schemaVersion: 1, kind: 'visual-embeddings', framePack,
			matrix: createAssistanceEmbeddingMatrixV1({ dimensions: 1, vectors: [[1]] }),
			tags: [{ resultId: 'visual-sample:0', tags: [] }],
		},
		'recognized-text': {
			schemaVersion: 1, width: 1_920, height: 1_080, timescale: 1_000,
			frames: [{ sourceFrame: 12, presentationTick: '400', regions: [
				{ text: firstText, confidence: 0.9, box: { x: 0, y: 0, width: 0.5, height: 0.5 } },
				{ text: secondText, confidence: 0.8,
					box: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } },
			] }],
		},
	}, {
		settingsVersion: 1, workflowId: 'index-video', shotMode: 'accurate', includeOcr: true,
	});

	const bounded = result.records.ocr[0]?.text;
	assert.equal(bounded?.length, 4_095);
	assert.equal(bounded, `${firstText} ${'b'.repeat(2_046)}`);
	assert.equal(result.rows.ocr[0]?.label, bounded);
});
