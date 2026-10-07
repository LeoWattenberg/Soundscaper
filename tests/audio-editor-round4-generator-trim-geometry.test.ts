/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVideoGeneratorClipV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { prepareTimelineGeneratorTrim } from '../src/common/editor/timeline-generator-trim.ts';
import { resolveTimelineTrimPointerPreview } from '../src/common/editor/ui/timeline/trim-pointer-routing.ts';
import { FOUNDATION_TIME_CONVERSION_SITES } from '../src/common/editor/foundation-time-conversion-audit.ts';

const original = normalizeVideoGeneratorClipV1({ schemaVersion: 1, kind: 'generator', id: 'title', sourceId: 'source',
	sequenceId: 'sequence', sequenceStartFrame: 0, sequenceFrameCount: 150, sourceInFrame: 0, sourceFrameCount: 150 });
const clock = { sampleRate: 48_000, sequences: [{ id: 'sequence', rate: { num: 30, den: 1 } }] };

test('normal Title edge previews accept its decorated display record and retain exact native phase', () => {
	const displayed = { ...original, title: 'Title', timelineStartFrame: 0, durationFrames: 240_000,
		sourceStartFrame: 0, sourceDurationFrames: 150, waveformPreviewKind: 'ordinary' };
	const preview = resolveTimelineTrimPointerPreview({ project: { ...clock,
		sources: [{ id: 'source', kind: 'generator', frameCount: 150 }], tracks: [{ id: 'picture', clipIds: ['title'] }] },
		projectIndex: null, session: { clipId: 'title', clipIds: ['title'], original: displayed },
		edge: 'left', requestedBoundarySample: 48_000,
		legacyRequestedDelta: () => assert.fail('No audio clock'), previewVideo: () => assert.fail('No camera trim'),
		createLegacyPreview: () => assert.fail('No audio source EOF'),
	}) as Readonly<{ timelineStartFrame: number; durationFrames: number; sourceStartFrame: number; sourceDurationFrames: number }>;
	assert.deepEqual([preview.timelineStartFrame, preview.durationFrames, preview.sourceStartFrame, preview.sourceDurationFrames],
		[48_000, 192_000, 30, 120]);
});

test('normal Title right edge restores an earlier trim and clamps at its authored source end', () => {
	const shortened = prepareTimelineGeneratorTrim(clock, original, { frameCount: 150 }, { durationFrames: 192_000 });
	assert.equal(shortened.sequenceFrameCount, 120);
	assert.deepEqual(prepareTimelineGeneratorTrim(clock, shortened, { frameCount: 150 }, { durationFrames: 480_000 }), original);
	const minimum = prepareTimelineGeneratorTrim(clock, original, { frameCount: 150 }, { durationFrames: 1 });
	assert.equal(minimum.sequenceFrameCount, 1);
	assert.equal(minimum.sourceFrameCount, 1);
});

test('native generated visual trims and live previews have exact owning conversion policies', () => {
	const planner = FOUNDATION_TIME_CONVERSION_SITES.find(site => site.id === 'timeline-generator-trim-sequence-boundaries');
	assert.equal(planner?.file, 'src/common/editor/timeline-generator-trim.ts');
	assert.deepEqual(planner?.conversions, [{ helper: 'sampleFrameToVideoFrame', policies: ['point'] },
		{ helper: 'videoFrameToSampleFrame', policies: ['point'] }]);
	const preview = FOUNDATION_TIME_CONVERSION_SITES.find(site => site.id === 'timeline-generator-trim-pointer-preview');
	assert.equal(preview?.file, 'src/common/editor/ui/timeline/generator-trim-pointer-preview.ts');
	assert.deepEqual(preview?.conversions, [{ helper: 'videoFrameToSampleFrame', policies: ['point'] }]);
});
