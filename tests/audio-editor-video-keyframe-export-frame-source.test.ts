/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import {
	createVideoKeyframeExportFrameSource,
} from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import {
	framescaperV20Options,
	opacityKeyframes,
} from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;

test('frame source maps output indices exactly and evaluates shared keyed state lazily', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const clip = project.clips[0] as unknown as Record<string, unknown>;
	clip.videoKeyframes = opacityKeyframes();
	const runtime = runtimeProject(project);
	const source = createVideoKeyframeExportFrameSource({
		project: runtime,
		canvas: { width: 320, height: 180, frameRate: 3 },
		startFrame: 0,
		endFrame: 48_000,
	});
	assert.equal(source.frameCount, 3);
	const middle = source.frame(1);
	assert.deepEqual(middle.timelinePosition, { num: 16_000, den: 1 });
	assert.equal(middle.timelineSample, 16_000);
	const keyed = middle.layers[0] as {
		clips: readonly [{ opacity: number; renderDescription: { opacityStart: number } }];
	};
	assert.ok(Math.abs(keyed.clips[0].opacity - (5 / 12)) < 1e-12);
	assert.equal(keyed.clips[0].opacity, keyed.clips[0].renderDescription.opacityStart);
	assert.equal(Object.isFrozen(middle), true);
	assert.throws(() => source.frame(3), /outside the range/u);
});

test('frame source retains wide exact frame positions and static composition parity', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const runtime = runtimeProject(project);
	const source = createVideoKeyframeExportFrameSource({
		project: runtime,
		canvas: { width: 320, height: 180, frameRate: { num: 30_000, den: 1_001 } },
		startFrame: 1,
		endFrame: 48_000,
	});
	assert.equal(source.frameCount, 30);
	const frame = source.frame(1);
	assert.deepEqual(frame.timelinePosition, { num: 8_013, den: 5 });
	const active = frame.layers[0] as {
		clips: readonly [{ renderDescription: { opacityStart: number; blendMode: string } }];
	};
	assert.equal(active.clips[0].renderDescription.opacityStart, DEFAULT_VIDEO_CLIP_COMPOSITION.opacity);
	assert.equal(active.clips[0].renderDescription.blendMode, DEFAULT_VIDEO_CLIP_COMPOSITION.blendMode);
});

test('frame source owns an immutable project snapshot', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const runtime = runtimeProject(project) as unknown as {
		tracks: Array<{ hidden?: boolean; clipIds: string[] }>;
	};
	const source = createVideoKeyframeExportFrameSource({
		project: runtime,
		canvas: { width: 320, height: 180, frameRate: 3 },
		startFrame: 0,
		endFrame: 48_000,
	});
	assert.equal(source.frame(0).layers.length, 1);
	runtime.tracks[0].hidden = true;
	runtime.tracks[0].clipIds.length = 0;
	assert.equal(source.frame(0).layers.length, 1);
});

test('frame source preflights every advertised position and binary snapshot payload', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const runtime = runtimeProject(project);
	assert.throws(
		() => createVideoKeyframeExportFrameSource({
			project: runtime,
			canvas: { width: 320, height: 180, frameRate: 100_000 },
			startFrame: Number.MAX_SAFE_INTEGER - 1,
			endFrame: Number.MAX_SAFE_INTEGER,
		}),
		/timeline position.*safe rational domain/u,
	);
	const wideRate = {
		...runtime,
		sampleRate: 4_503_599_627_370_495,
	};
	assert.throws(
		() => createVideoKeyframeExportFrameSource({
			project: wideRate,
			canvas: { width: 320, height: 180, frameRate: 4 },
			startFrame: 0,
			endFrame: 4_503_599_627_370_496,
		}),
		/timeline positions.*safe rational domain/u,
	);
	const binary = { ...runtime, opaque: new Uint8Array(4 * 1024 * 1024) };
	assert.throws(
		() => createVideoKeyframeExportFrameSource({
			project: binary,
			canvas: { width: 320, height: 180, frameRate: 30 },
		}),
		/cannot embed binary data/u,
	);
});

test('frame source rejects hostile canvas accessors without invoking them', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const runtime = runtimeProject(project);
	let calls = 0;
	const canvas = { height: 180, frameRate: 30 } as Record<string, unknown>;
	Object.defineProperty(canvas, 'width', {
		enumerable: true,
		get() { calls += 1; return 320; },
	});
	assert.throws(
		() => createVideoKeyframeExportFrameSource({ project: runtime, canvas: canvas as never }),
		/canvas\.width.*data property/u,
	);
	assert.equal(calls, 0);
	const hostileRate = { den: 1_001 } as Record<string, unknown>;
	Object.defineProperty(hostileRate, 'num', {
		enumerable: true,
		get() { calls += 1; return 30_000; },
	});
	assert.throws(
		() => createVideoKeyframeExportFrameSource({
			project: runtime,
			canvas: { width: 320, height: 180, frameRate: hostileRate as never },
		}),
		/frameRate\.num.*data property/u,
	);
	const hostileProject = { ...runtime } as Record<string, unknown>;
	Object.defineProperty(hostileProject, 'sampleRate', {
		enumerable: true,
		get() { calls += 1; return 48_000; },
	});
	assert.throws(
		() => createVideoKeyframeExportFrameSource({
			project: hostileProject,
			canvas: { width: 320, height: 180, frameRate: 30 },
		}),
		/project\.sampleRate.*data property/u,
	);
	assert.equal(calls, 0);
});

function runtimeProject(project: unknown) {
	const compatible = structuredClone(project) as Record<string, unknown>;
	compatible.schemaVersion = 17;
	return resolveRuntimeProjectProjection(compatible);
}
