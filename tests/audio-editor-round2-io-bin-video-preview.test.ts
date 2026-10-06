/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { projectBinVideoPreviewModel, projectBinVisualDurationFrames } from '../src/common/editor/ui/workspace/project-bin-video-preview-model.ts';
import { registerVideoTimingIndex, unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { createVideoTimingAssetPublication, validateVideoTimingAssetBytes } from '../src/common/editor/video-timing-asset.ts';

const project = {
	schemaFamily: 'framescaper', schemaVersion: 1, sampleRate: 48_000,
	primarySequenceId: 'sequence', sequences: [{ id: 'sequence', rate: { num: 30, den: 1 } }],
};
const clip = {
	id: 'video', kind: 'video', sourceId: 'source', sequenceId: 'sequence',
	sequenceStartFrame: 0, sequenceFrameCount: 60, sourceInFrame: 12, sourceFrameCount: 24,
};

test('a bin video uses its source frame clock and its independently stretched sequence extent', () => {
	const source = {
		id: 'source', kind: 'video', frameRate: { num: 24, den: 1 }, sourceFrameCount: 48,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 24, den: 1 } },
	};
	assert.deepEqual(projectBinVideoPreviewModel(project, clip, source), {
		durationFrames: 96_000, startSeconds: 0.5, endSeconds: 1.5, playbackRate: 0.5,
	});
	assert.equal(Object.hasOwn(clip, 'durationFrames'), false, 'the authored bin clip stays canonical');
});

test('exact video timing retains source in and out times in a bin preview', () => {
	const publication = createVideoTimingAssetPublication('8'.repeat(64), {
		timescale: 1_000, presentationTicks: [0n, 100n, 300n, 700n], finalFrameDurationTicks: 100n,
	});
	const source = {
		id: 'source', kind: 'video', frameRate: { num: 24, den: 1 }, sourceFrameCount: 4,
		contentSha256: '8'.repeat(64), timingAsset: publication.reference,
		timingDecision: { mode: 'exact', rate: { num: 24, den: 1 } },
	};
	registerVideoTimingIndex(source, validateVideoTimingAssetBytes(publication.reference, publication.bytes));
	try {
		const result = projectBinVideoPreviewModel(project, {
			...clip, sequenceFrameCount: 15, sourceInFrame: 1, sourceFrameCount: 2,
		}, source);
		assert.deepEqual(result, { durationFrames: 24_000, startSeconds: 0.1, endSeconds: 0.7, playbackRate: 1.2 });
		assert.ok(Object.isFrozen(result));
	} finally { unregisterVideoTimingIndex(source); }
});

test('audio and unavailable source cards do not acquire a video preview clock', () => {
	assert.equal(projectBinVideoPreviewModel(project, { ...clip, kind: 'audio' }, null), null);
	assert.equal(projectBinVideoPreviewModel(project, clip, null), null);
	assert.equal(projectBinVideoPreviewModel(project, clip, { id: 'other' }), null);
});

test('owned visual card duration counts its authored sequence frames', () => {
	assert.equal(projectBinVisualDurationFrames(project, { kind: 'image', sequenceFrameCount: 150 }), 240_000);
	assert.equal(projectBinVisualDurationFrames(project, { kind: 'generator', sequenceFrameCount: 30 }), 48_000);
	assert.equal(projectBinVisualDurationFrames(project, { kind: 'audio' }), null);
});
