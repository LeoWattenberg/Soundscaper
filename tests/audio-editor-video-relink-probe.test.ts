/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { admitChangedContentVideoCandidate } from '../src/common/editor/controller/video-relink-probe.ts';

test('changed-content video relink admits the persisted sample-frame duration', async () => {
	let disposals = 0;
	const runtime = {
		createAudioEditorVideoFrameExtractor: () => ({
			metadata: { width: 1_920, height: 1_080, durationSeconds: 1 },
			dispose() { disposals += 1; },
		}),
		engine: { async decodeAudioData() { throw new Error('silent'); } },
		ffmpeg: { async decode() { throw new Error('silent'); } },
	};
	await admitChangedContentVideoCandidate(new Blob(), {
		width: 1_920, height: 1_080, sampleFrameCount: 48_000, sampleRate: 48_000,
	}, runtime);
	assert.equal(disposals, 1);
});
