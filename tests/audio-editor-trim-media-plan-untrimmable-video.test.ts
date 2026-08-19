/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTrimMediaPlan } from '../src/common/editor/trim-media-plan.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';

/**
 * A trim only plans what the document will accept once the bytes are written.
 *
 * A video source states its timing twice: the picture count, and a timing asset
 * bound to the exact content digest of the file it was probed from. Trimming
 * changes both, and nothing in the trim re-probes the copy, so a planned video
 * trim ended with FFmpeg writing the trimmed body and the commit failing
 * validation — a wasted cut, an orphaned body, and an operation the operator
 * could never complete on any project the shipped importer built, because that
 * importer always attaches a timing asset.
 *
 * A source another camera in a multicamera group reads is untrimmable for a
 * different reason: the plan only walks clips, and a member's read position is
 * derived from the output clip's in-point plus its own sync offset, so moving
 * that in-point into a trimmed copy would shift every other angle by the same
 * amount.
 *
 * Both are reported and retained whole, rather than cut and then refused.
 */

const SOURCE_SHA256 = 'a'.repeat(64);
const OTHER_SHA256 = 'b'.repeat(64);

test('a video source bound to a timing asset is retained whole, and says why', () => {
	const plan = createTrimMediaPlan({ project: videoProject({ timing: true }) });
	const source = plan.sources.find(({ sourceId }) => sourceId === 'cam');

	assert.equal(source?.wholeSourceRetained, true);
	assert.equal(source?.discardedFrames, 0);
	assert.deepEqual(source?.retained, [{ startFrame: 0, endFrame: 300 }]);
	assert.equal(plan.discardedFrames, 0);
	const item = plan.report.items.find(({ scope }) => scope?.id === 'cam');
	assert.equal(item?.code, 'trim.source-timing-bound');
	assert.equal(item?.disposition, 'omitted');
});

test('a video source with no timing asset still trims to what is used', () => {
	const plan = createTrimMediaPlan({ project: videoProject({ timing: false }) });
	const source = plan.sources.find(({ sourceId }) => sourceId === 'cam');

	assert.equal(source?.wholeSourceRetained, false);
	assert.deepEqual(source?.retained, [{ startFrame: 100, endFrame: 110 }]);
	assert.equal(source?.discardedFrames, 290);
});

test('a source another camera reads is retained whole, and says why', () => {
	const project = videoProject({ timing: false }) as Record<string, unknown>;
	const plan = createTrimMediaPlan({
		project: {
			...project,
			sources: [
				...(project.sources as readonly unknown[]),
				{
					kind: 'video', id: 'cam-b', name: 'CAM B', storageKey: 'media/cam-b.mp4',
					mimeType: 'video/mp4', contentSha256: OTHER_SHA256,
					frameCount: 480_000, sampleFrameCount: 480_000, sourceFrameCount: 300,
					frameRate: { num: 30, den: 1 }, sampleRate: 48_000, timingAsset: null,
				},
			],
			multicameraGroups: [{
				id: 'group-a', projectId: 'trim-plan', sequenceId: 'seq',
				outputClipId: 'v-clip', activeMemberId: 'member-a',
				members: [
					{ id: 'member-a', groupId: 'group-a', sourceId: 'cam', syncOffsetSamples: 0 },
					{ id: 'member-b', groupId: 'group-a', sourceId: 'cam-b', syncOffsetSamples: 0 },
				],
			}],
		},
	});

	for (const sourceId of ['cam', 'cam-b']) {
		const source = plan.sources.find((candidate) => candidate.sourceId === sourceId);
		assert.equal(source?.wholeSourceRetained, true, sourceId);
		const item = plan.report.items.find(({ scope }) => scope?.id === sourceId);
		assert.equal(item?.code, 'trim.source-multicamera-bound', sourceId);
	}
});

function videoProject({ timing }: { timing: boolean }) {
	const publication = createVideoTimingAssetPublication(SOURCE_SHA256, {
		timescale: 30_000,
		presentationTicks: Array.from({ length: 300 }, (_, index) => BigInt(index) * 1_001n),
		finalFrameDurationTicks: 1_001n,
	});
	return {
		id: 'trim-plan', title: 'Trim plan', sampleRate: 48_000, primarySequenceId: 'seq',
		sequences: [{ id: 'seq', trackIds: ['v1'] }],
		sources: [{
			kind: 'video', id: 'cam', name: 'CAM A', storageKey: 'media/cam.mp4',
			mimeType: 'video/mp4', contentSha256: SOURCE_SHA256,
			frameCount: 480_000, sampleFrameCount: 480_000, sourceFrameCount: 300,
			frameRate: { num: 30, den: 1 }, sampleRate: 48_000,
			timingAsset: timing ? publication.reference : null,
		}],
		clips: [{
			kind: 'video', id: 'v-clip', sourceId: 'cam', sequenceId: 'seq',
			sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 100, sourceFrameCount: 10,
		}],
		tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['v-clip'] }],
		projectBin: { clips: [] },
	};
}
