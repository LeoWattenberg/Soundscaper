/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	shouldRenderExactProductVideoPreview,
} from '../src/common/editor/ui/workspace/video-preview-exact-render-policy.ts';

const exactSession = Object.freeze({ renderExact: async () => ({}) });

test('settled preview frames use the exact export-equivalent renderer', () => {
	assert.equal(shouldRenderExactProductVideoPreview(exactSession, 'stopped'), true);
	assert.equal(shouldRenderExactProductVideoPreview(exactSession, 'paused'), true);
});

test('playing preview frames stay on the complete real-time shader path', () => {
	assert.equal(shouldRenderExactProductVideoPreview(exactSession, 'playing'), false);
});

test('a session without exact execution always uses composed preview layers', () => {
	assert.equal(shouldRenderExactProductVideoPreview(Object.freeze({}), 'stopped'), false);
	assert.equal(shouldRenderExactProductVideoPreview(null, 'playing'), false);
});
