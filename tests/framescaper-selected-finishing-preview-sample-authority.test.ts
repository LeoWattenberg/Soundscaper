/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoKeyframeExportPresentationAuthority } from '../src/common/editor/video-keyframe-export-presentation-authority.ts';
import { createVideoRetimeWebCoreOrdinalAuthority } from '../src/common/editor/video-retime-web-core-ordinal-authority.ts';
import { videoTimelineDurationFrames } from '../src/common/editor/video-timeline.js';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { framescaperProjectForRuntimeConsumersFinishing } from '../src/framescaper/editor-project-finishing-runtime.ts';
import { createSelectedFinishingPreviewSamplePresentation } from '../src/framescaper/selected-finishing-preview-sample-authority.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { bindCfrTiming, NTSC } from './helpers/video-retime-export-fixtures.ts';

type Data = Record<string, unknown>;

function fixture(reverse: boolean) {
	const options = framescaperV20Options();
	const frameCount = 19_020;
	const sampleCount = 30_462_432;
	const source = (options.sources as Data[]).find(({ kind }) => kind === 'video')!;
	Object.assign(source, { frameRate: NTSC, sourceFrameCount: frameCount,
		frameCount: sampleCount, sampleFrameCount: sampleCount,
		timingDecision: { ...(source.timingDecision as Data), rate: NTSC } });
	const clip = (options.clips as Data[]).find(({ kind }) => kind === 'video')!;
	Object.assign(clip, { sequenceFrameCount: frameCount, sourceFrameCount: frameCount,
		retimeMap: reverse ? {
			feature: 'video-retime', version: 2,
			points: [{ outerFrame: 0, sourceFrame: { num: frameCount, den: 1 } },
				{ outerFrame: frameCount, sourceFrame: { num: 0, den: 1 } }],
			segments: [{ mode: 'constant-reverse' }],
		} : null });
	(options.sequences as Data[])[0]!.rate = NTSC;
	const project = createFramescaperProjectFinishing(PROFILE, options as never);
	const runtimeProject = framescaperProjectForRuntimeConsumersFinishing(PROFILE, project);
	const timingBySourceId = new Map([['video-source', bindCfrTiming('video-source', frameCount, NTSC)]]);
	return { project: project as unknown as Data, runtimeProject, timingBySourceId,
		clip: (project.clips as readonly unknown[])[0] as Data,
		source: (project.sources as readonly unknown[])[0] as Data };
}

for (const reverse of [false, true]) {
	test(`bounded preview windows preserve exact NTSC ${reverse ? 'reverse' : 'forward'} sample ownership`, () => {
		const options = fixture(reverse);
		const preview = createSelectedFinishingPreviewSamplePresentation(options);
		const end = videoTimelineDurationFrames(options.runtimeProject);
		for (const sample of [0, 999_999, 1_000_000, 1_000_001, 15_216_000, end - 1, 1_000_000, 0]) {
			const oracle = createVideoKeyframeExportPresentationAuthority({
				project: options.project, timingBySourceId: options.timingBySourceId,
				exactOrdinalAuthority: createVideoRetimeWebCoreOrdinalAuthority({
					project: options.runtimeProject, timingBySourceId: options.timingBySourceId,
					startFrame: sample, endFrame: sample + 1, outputRate: { num: 48_000, den: 1 },
				}),
			});
			const request = { clip: options.clip, source: options.source,
				localSequencePosition: { num: 0, den: 1 }, outputOrdinal: sample };
			assert.deepEqual(preview.resolvePresentationDescriptor(request),
				oracle.resolvePresentationDescriptor({ ...request, outputOrdinal: 0 }), `sample ${String(sample)}`);
		}
	});
}

test('sample windows keep the export output-count limit and reject invalid preview samples', () => {
	const options = fixture(false);
	assert.throws(() => createVideoRetimeWebCoreOrdinalAuthority({
		project: options.runtimeProject, timingBySourceId: options.timingBySourceId,
		outputRate: { num: 48_000, den: 1 },
	}), /output frame count must be between 1 and 2000000/u);
	const preview = createSelectedFinishingPreviewSamplePresentation(options);
	for (const sample of [-1, 1.5, NaN, videoTimelineDurationFrames(options.runtimeProject)]) {
		assert.throws(() => preview.resolvePresentationDescriptor({
			clip: options.clip, source: options.source, localSequencePosition: { num: 0, den: 1 },
			outputOrdinal: sample,
		}), /sample is outside/u);
	}
});
