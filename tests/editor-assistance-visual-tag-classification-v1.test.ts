/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceEmbeddingMatrixV1,
	reviewAssistanceEmbeddingMatrixV1,
} from '../src/common/editor/assistance/binary-formats-v1.ts';
import {
	ASSISTANCE_NON_BIOMETRIC_VISUAL_TAGS_V1,
} from '../src/common/editor/assistance/visual-search-records-v1.ts';
import {
	ASSISTANCE_VISUAL_TAG_PROMPTS_V1,
	classifyAssistanceVisualTagEmbeddingsV1,
} from '../src/common/editor/assistance/visual-tag-classification-v1.ts';

test('SigLIP visual prototypes produce canonical non-biometric tags and strip prototype rows', () => {
	assert.equal(ASSISTANCE_VISUAL_TAG_PROMPTS_V1.length,
		ASSISTANCE_NON_BIOMETRIC_VISUAL_TAGS_V1.length);
	assert.deepEqual(ASSISTANCE_VISUAL_TAG_PROMPTS_V1.map(({ tag }) => tag),
		ASSISTANCE_NON_BIOMETRIC_VISUAL_TAGS_V1);
	const person = ASSISTANCE_NON_BIOMETRIC_VISUAL_TAGS_V1.indexOf('person');
	const outdoor = ASSISTANCE_NON_BIOMETRIC_VISUAL_TAGS_V1.indexOf('outdoor');
	const dimensions = ASSISTANCE_NON_BIOMETRIC_VISUAL_TAGS_V1.length;
	const vectors = [basis(dimensions, person), basis(dimensions, outdoor),
		...Array.from({ length: dimensions }, (_, index) => basis(dimensions, index))];
	const classified = classifyAssistanceVisualTagEmbeddingsV1(
		createAssistanceEmbeddingMatrixV1({ dimensions, vectors }), 2,
	);
	const matrix = reviewAssistanceEmbeddingMatrixV1(classified.matrix);
	assert.equal(matrix.rowCount, 2);
	assert.deepEqual(matrix.vector(0), basis(dimensions, person));
	assert.deepEqual(matrix.vector(1), basis(dimensions, outdoor));
	assert.deepEqual(classified.tags.map((tags) => tags.map(({ tag }) => tag)), [
		['person'], ['outdoor'],
	]);
	assert.ok(classified.tags.every((tags) => tags[0]!.score === 1));
});

test('visual tag classification rejects absent, malformed, or non-versioned prototype custody', () => {
	const dimensions = ASSISTANCE_NON_BIOMETRIC_VISUAL_TAGS_V1.length;
	assert.throws(() => classifyAssistanceVisualTagEmbeddingsV1(
		createAssistanceEmbeddingMatrixV1({ dimensions, vectors: [basis(dimensions, 0)] }), 1,
	), /prototype/iu);
	assert.throws(() => classifyAssistanceVisualTagEmbeddingsV1(
		createAssistanceEmbeddingMatrixV1({ dimensions, vectors: [
			basis(dimensions, 0),
			...Array.from({ length: dimensions }, (_, index) => basis(dimensions, index)),
		] }), 0,
	), /frame/iu);
});

function basis(dimensions: number, index: number): Float32Array {
	const result = new Float32Array(dimensions);
	result[index] = 1;
	return result;
}
