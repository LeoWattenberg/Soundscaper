/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	areVideoPreviewMediaLayersReadyForExactRender,
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

test('exact readback waits for every seek to drain rather than capturing the preceding picture', () => {
	const video = { readyState: 4, seeking: false };
	const layers = [{ entries: [{ video }] }];
	assert.equal(areVideoPreviewMediaLayersReadyForExactRender(layers), true);
	video.seeking = true;
	assert.equal(areVideoPreviewMediaLayersReadyForExactRender(layers), false);
	video.seeking = false;
	video.readyState = 1;
	assert.equal(areVideoPreviewMediaLayersReadyForExactRender(layers), false);
	assert.equal(areVideoPreviewMediaLayersReadyForExactRender([{ entries: [{ video: null }] }]), false);
});

test('exact product visuals and canvas-backed media do not require a decoder seek', () => {
	assert.equal(areVideoPreviewMediaLayersReadyForExactRender([]), true);
	assert.equal(areVideoPreviewMediaLayersReadyForExactRender([
		{ entries: [{ video: { readyState: 4, drawable: {} } }] },
	]), true);
});
