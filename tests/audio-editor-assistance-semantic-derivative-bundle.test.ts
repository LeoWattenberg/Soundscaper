/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAssistanceEmbeddingMatrixV1 } from
	'../src/common/editor/assistance/binary-formats-v1.ts';
import {
	createAssistanceSemanticDerivativeBundleV1,
	reviewAssistanceSemanticDerivativeBundleV1,
} from '../src/common/editor/assistance/semantic-derivative-bundle-v1.ts';

const MATRIX = createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [[1, 0], [0, 1]] });

test('semantic derivative bundles bind exact normalized matrices to revisioned searchable rows', () => {
	const draft = {
		provider: 'visual' as const, projectId: 'project-a', projectRevision: 8,
		sequenceId: 'sequence-a', sourceId: 'source-a', matrix: MATRIX,
		rows: [
			{ resultId: 'shot:1', timelineFrame: 10, label: 'speaker at desk' },
			{ resultId: 'shot:2', timelineFrame: 20, label: 'launch slide' },
		],
		ocr: [{ resultId: 'shot:2', timelineFrame: 20, label: 'Launch Plan' }],
	};
	const bytes = createAssistanceSemanticDerivativeBundleV1(draft);
	assert.deepEqual(bytes, createAssistanceSemanticDerivativeBundleV1(draft));
	const reviewed = reviewAssistanceSemanticDerivativeBundleV1(bytes);
	assert.equal(reviewed.provider, 'visual');
	assert.equal(reviewed.projectRevision, 8);
	assert.equal(reviewed.matrix.rowCount, 2);
	assert.deepEqual(reviewed.matrix.vector(1), new Float32Array([0, 1]));
	assert.deepEqual(reviewed.rows, draft.rows);
	assert.deepEqual(reviewed.ocr, draft.ocr);
});

test('semantic derivative bundles reject stale corruption, row drift, and provider substitutions', () => {
	assert.throws(() => createAssistanceSemanticDerivativeBundleV1({
		provider: 'transcript', projectId: 'project-a', projectRevision: 8,
		sequenceId: 'sequence-a', sourceId: 'source-a', matrix: MATRIX,
		rows: [{ resultId: 'chunk:1', timelineFrame: 0, label: 'Only one row' }], ocr: [],
	}), /row|matrix|inventory/iu);
	assert.throws(() => createAssistanceSemanticDerivativeBundleV1({
		provider: 'transcript', projectId: 'project-a', projectRevision: 8,
		sequenceId: 'sequence-a', sourceId: 'source-a', matrix: MATRIX,
		rows: [
			{ resultId: 'chunk:1', timelineFrame: 0, label: 'one' },
			{ resultId: 'chunk:2', timelineFrame: 1, label: 'two' },
		], ocr: [{ resultId: 'chunk:1', timelineFrame: 0, label: 'forged' }],
	}), /OCR|transcript/iu);
	const valid = createAssistanceSemanticDerivativeBundleV1({
		provider: 'transcript', projectId: 'project-a', projectRevision: 8,
		sequenceId: 'sequence-a', sourceId: 'source-a', matrix: MATRIX,
		rows: [
			{ resultId: 'chunk:1', timelineFrame: 0, label: 'one' },
			{ resultId: 'chunk:2', timelineFrame: 1, label: 'two' },
		], ocr: [],
	});
	const corrupt = Uint8Array.from(valid);
	corrupt[corrupt.length - 1] ^= 1;
	assert.throws(() => reviewAssistanceSemanticDerivativeBundleV1(corrupt),
		/digest|matrix|canonical|normalized/iu);
	assert.throws(() => reviewAssistanceSemanticDerivativeBundleV1(valid.subarray(0, valid.length - 1)),
		/truncated|length|matrix/iu);
});
