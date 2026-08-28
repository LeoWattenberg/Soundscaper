/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveVideoRetimeExactPictureOrdinal } from '../src/common/editor/video-retime-exact-ordinal-authority.ts';
import { createVideoKeyframeExportPresentationAuthority } from '../src/common/editor/video-keyframe-export-presentation-authority.ts';
import { createVideoRetimeWebCoreOrdinalAuthority } from '../src/common/editor/video-retime-web-core-ordinal-authority.ts';
import { createVideoRetimeWebCorePreviewResolver } from '../src/common/editor/video-retime-web-core-preview.ts';
import { resolveActiveVideoLayers } from '../src/common/editor/video-timeline.js';
import { applyFramescaperProjectCommandRetime } from '../src/framescaper/editor-project-retime-commands.ts';
import { createFramescaperVideoRetimeReverseCommandRetime } from '../src/framescaper/editor-project-retime-retime-command.ts';
import { FRAMESCAPER_RETIME_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-retime-profile.ts';
import { framescaperProjectForRuntimeConsumersRetime } from '../src/framescaper/editor-project-retime-runtime.ts';
import { createFramescaperProjectRetime } from '../src/framescaper/editor-project-retime.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { bindCfrTiming, bindVfrTiming, NTSC } from './helpers/video-retime-export-fixtures.ts';

const PROFILE = FRAMESCAPER_RETIME_PROJECT_MODEL_PROFILE;

test('web-core exact ordinal authority owns CFR, NTSC and random reverse seeks', () => {
	const canonical = createFramescaperProjectRetime(PROFILE, framescaperV20Options());
	const retimed = applyFramescaperProjectCommandRetime(
		PROFILE,
		canonical,
		createFramescaperVideoRetimeReverseCommandRetime({
			clipId: 'video-clip', expectedRetimeMap: null,
		}),
		{ now: '2026-08-23T12:30:00.000Z' },
	);
	const project = framescaperProjectForRuntimeConsumersRetime(PROFILE, retimed);
	const clip = project.clips.find(({ kind }) => kind === 'video')!;
	const authority = createVideoRetimeWebCoreOrdinalAuthority({
		project,
		timingBySourceId: new Map([[
			'video-source', bindCfrTiming('video-source', 10, { num: 10, den: 1 }),
		]]),
		startFrame: 0,
		endFrame: 48_000,
		outputRate: NTSC,
	});
	assert.equal(authority.outputFrameCount, 30);
	assert.deepEqual([29, 0, 15, 0].map((outputOrdinal) => picture(
		authority, outputOrdinal, String(clip.id),
	).sourceOrdinal), [0, 9, 4, 9]);
	const presentation = createVideoKeyframeExportPresentationAuthority({
		project: { clips: project.clips, sources: project.sources },
		timingBySourceId: new Map([[
			'video-source', bindCfrTiming('video-source', 10, { num: 10, den: 1 }),
		]]),
		exactOrdinalAuthority: authority,
	});
	const descriptor = presentation.resolvePresentationDescriptor({
		clip: structuredClone(clip),
		source: structuredClone((project.sources as readonly Readonly<Record<string, unknown>>[])
			.find(({ id }) => id === 'video-source')!),
		localSequencePosition: { num: 0, den: 1 },
		outputOrdinal: 29,
	});
	assert.equal(descriptor.drawableSourceFrame, 0);
});

test('web-core exact ordinal authority retains authenticated VFR source time', () => {
	const canonical = createFramescaperProjectRetime(PROFILE, framescaperV20Options());
	const retimed = applyFramescaperProjectCommandRetime(
		PROFILE,
		canonical,
		createFramescaperVideoRetimeReverseCommandRetime({
			clipId: 'video-clip', expectedRetimeMap: null,
		}),
		{ now: '2026-08-23T12:31:00.000Z' },
	);
	const project = framescaperProjectForRuntimeConsumersRetime(PROFILE, retimed);
	const clip = project.clips.find(({ kind }) => kind === 'video')!;
	const authority = createVideoRetimeWebCoreOrdinalAuthority({
		project,
		timingBySourceId: new Map([[
			'video-source', bindVfrTiming(
				'video-source', [0n, 2n, 5n, 9n, 14n, 20n, 27n, 35n, 44n, 54n], 11n, 10,
			),
		]]),
		startFrame: 0,
		endFrame: 48_000,
		outputRate: { num: 10, den: 1 },
	});
	const first = picture(authority, 0, String(clip.id));
	assert.equal(first.sourceOrdinal, 9);
	assert.deepEqual(first.sourceTime, { numerator: 13n, denominator: 2n });
	assert.deepEqual(first.drawableSourceEndTime, { numerator: 13n, denominator: 2n });
});

test('program preview consumes the same exact ordinal descriptor at random sample seeks', () => {
	const canonical = createFramescaperProjectRetime(PROFILE, framescaperV20Options());
	const retimed = applyFramescaperProjectCommandRetime(
		PROFILE,
		canonical,
		createFramescaperVideoRetimeReverseCommandRetime({
			clipId: 'video-clip', expectedRetimeMap: null,
		}),
		{ now: '2026-08-23T12:33:00.000Z' },
	);
	const project = framescaperProjectForRuntimeConsumersRetime(PROFILE, retimed);
	const preview = createVideoRetimeWebCorePreviewResolver({
		project,
		timingBySourceId: new Map([[
			'video-source', bindCfrTiming('video-source', 10, { num: 10, den: 1 }),
		]]),
	});
	for (const [sample, expectedOrdinal] of [[0, 9], [24_000, 4], [47_999, 0]] as const) {
		const layers = resolveActiveVideoLayers(project, sample, {
			resolveClipPresentation: preview.resolveClipPresentation,
		});
		const entry = layers[0]?.clips[0];
		assert.equal(entry?.presentationDescriptor.drawableSourceFrame, expectedOrdinal);
		assert.equal(entry?.playbackRate, 0);
		assert.equal(entry?.exactPresentation, true);
	}
});

function picture(
	authority: ReturnType<typeof createVideoRetimeWebCoreOrdinalAuthority>,
	outputOrdinal: number,
	clipId: string,
) {
	return resolveVideoRetimeExactPictureOrdinal(authority, {
		outputOrdinal, clipId, sourceId: 'video-source',
	});
}
