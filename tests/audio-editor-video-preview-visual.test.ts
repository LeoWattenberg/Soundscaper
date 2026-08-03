/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveVideoPreviewVisual } from '../src/common/editor/ui/workspace/video-preview-visual.ts';

test('video preview visuals prefer canonical clips and fall back to transient source identity', () => {
	const clip = Object.freeze({ mediaUrl: 'blob:clip', source: Object.freeze({ id: 'original-video' }) });
	const source = Object.freeze({ mediaUrl: 'blob:source', source: Object.freeze({ id: 'fallback-video' }) });
	const calls: string[] = [];
	const controller = {
		actions: {
			video: {
				getClipVisualData(clipId: string) {
					calls.push(`clip:${clipId}`);
					return clipId === 'canonical-clip' ? clip : null;
				},
				getSourceVisualData(sourceId: string) {
					calls.push(`source:${sourceId}`);
					return source;
				},
			},
			timeline: { getClipVisualData: () => null },
		},
	};

	assert.strictEqual(resolveVideoPreviewVisual(controller, 'canonical-clip', 'original-video'), clip);
	assert.strictEqual(resolveVideoPreviewVisual(controller, 'canonical-clip', 'fallback-video'), source);
	assert.strictEqual(resolveVideoPreviewVisual(controller, 'transient-clip', 'fallback-video'), source);
	assert.deepEqual(calls, [
		'clip:canonical-clip',
		'clip:canonical-clip',
		'source:fallback-video',
		'clip:transient-clip',
		'source:fallback-video',
	]);
});
