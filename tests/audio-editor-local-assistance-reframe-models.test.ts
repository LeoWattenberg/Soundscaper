/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	localAssistanceModelCompatible,
	localAssistanceModelTaskSlots,
	localAssistanceOperationModelsAvailable,
	localAssistanceSelectedModels,
} from '../src/common/editor/ui/local-assistance-preparation.ts';

const YUNET_MODEL = Object.freeze({
	modelId: 'yunet-face-detection-2026may', version: '2026.5.0', task: 'face-detection',
	artifactSha256s: Object.freeze(['a'.repeat(64)]),
});
const DFINE_MODEL = Object.freeze({
	modelId: 'dfine-nano-coco', version: '1.0.0', task: 'object-detection',
	artifactSha256s: Object.freeze(['b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)]),
});
const SUBSTITUTE_FACE_MODEL = Object.freeze({
	modelId: 'substitute-face-detector', version: '1.0.0', task: 'face-detection',
	artifactSha256s: Object.freeze(['e'.repeat(64)]),
});
const SUBSTITUTE_OBJECT_MODEL = Object.freeze({
	modelId: 'substitute-object-detector', version: '1.0.0', task: 'object-detection',
	artifactSha256s: Object.freeze(['f'.repeat(64)]),
});

test('Reframe requires exact separate YuNet and D-FINE model slots in canonical role order', () => {
	assert.deepEqual(localAssistanceModelTaskSlots('subject-detection'), [
		['face-detection'], ['object-detection'],
	]);
	assert.equal(localAssistanceModelCompatible('subject-detection', YUNET_MODEL), true);
	assert.equal(localAssistanceModelCompatible('subject-detection', DFINE_MODEL), true);
	assert.equal(localAssistanceModelCompatible('subject-detection', SUBSTITUTE_FACE_MODEL), false);
	assert.equal(localAssistanceModelCompatible('subject-detection', SUBSTITUTE_OBJECT_MODEL), false);
	assert.equal(localAssistanceOperationModelsAvailable('subject-detection', [YUNET_MODEL]), false);
	assert.equal(localAssistanceOperationModelsAvailable('subject-detection', [DFINE_MODEL]), false);
	assert.equal(localAssistanceOperationModelsAvailable('subject-detection', [
		YUNET_MODEL, DFINE_MODEL,
	]), true);

	assert.deepEqual(localAssistanceSelectedModels('subject-detection', [
		DFINE_MODEL, YUNET_MODEL,
	], [DFINE_MODEL.modelId, YUNET_MODEL.modelId]), [YUNET_MODEL, DFINE_MODEL]);
	assert.equal(localAssistanceSelectedModels('subject-detection', [
		YUNET_MODEL, DFINE_MODEL,
	], [YUNET_MODEL.modelId]), null);
});
