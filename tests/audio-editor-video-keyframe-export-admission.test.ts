/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import {
	VideoKeyframeExportUnavailableError,
	animatedVideoKeyframeClipIdsForExport,
	assertStaticVideoKeyframesForExport,
} from '../src/common/editor/video-keyframe-export-admission.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV20,
} from '../src/framescaper/editor-project-feature-requirements-v20.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import {
	framescaperV20Options,
	opacityKeyframes,
} from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;

test('V6 video export admits contextual empty V20 fields without changing static output', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const plan = createVideoExportPlan(exportRuntimeProject(project), {
		includeAudio: false,
		range: { startFrame: 0, endFrame: 48_000 },
	});
	assert.equal(plan.version, 6);
	assert.equal(plan.intervals[0]?.layers[0]?.clips[0]?.clipId, 'video-clip');
});

test('V6 refuses authored keyframes before producing a static plan', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	(project.clips[0] as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes();
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	assert.throws(
		() => createVideoExportPlan(exportRuntimeProject(project), {
			includeAudio: false,
			range: { startFrame: 0, endFrame: 48_000 },
		}),
		(error: unknown) => error instanceof VideoKeyframeExportUnavailableError
			&& error.code === 'VIDEO_KEYFRAME_EXPORT_UNAVAILABLE'
			&& error.clipId === 'video-clip',
	);
});

test('keyed export classification returns detached ordered active clip IDs', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const first = project.clips[0] as unknown as Record<string, unknown>;
	first.videoKeyframes = opacityKeyframes();
	const second = structuredClone(first);
	second.id = 'second-video';
	const ids = animatedVideoKeyframeClipIdsForExport([first, second, first]);
	assert.deepEqual(ids, ['video-clip', 'second-video']);
	assert.equal(Object.isFrozen(ids), true);
});

test('export admission rejects disguised keyframe state without invoking accessors', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const clip = project.clips[0] as unknown as Record<string, unknown>;
	let getterCalls = 0;
	Object.defineProperty(clip, 'videoKeyframes', {
		enumerable: true,
		get() { getterCalls += 1; return opacityKeyframes(); },
	});
	assert.throws(
		() => assertStaticVideoKeyframesForExport([clip]),
		/videoKeyframes.*data property/iu,
	);
	assert.equal(getterCalls, 0);
});

test('an authored clip outside the exported intervals does not block a static range', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const clip = project.clips[0] as unknown as Record<string, unknown>;
	clip.sequenceStartFrame = 20;
	clip.videoKeyframes = opacityKeyframes();
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	const plan = createVideoExportPlan(exportRuntimeProject(project), {
		includeAudio: false,
		range: { startFrame: 0, endFrame: 48_000 },
	});
	assert.deepEqual(plan.intervals.map((interval: { kind: string }) => interval.kind), ['black']);
});

function exportRuntimeProject(project: unknown): Record<string, unknown> {
	const runtime = structuredClone(project) as Record<string, unknown>;
	runtime.schemaVersion = 17;
	return runtime;
}
