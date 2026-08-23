/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import {
	assertVideoKeyframeExportFrame,
	assertVideoKeyframeExportFrameSource,
	createVideoExactPictureExportFrameSource,
	createVideoKeyframeExportFrameSource,
} from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import {
	framescaperV20Options,
	opacityKeyframes,
} from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;

test('product picture frames use an exact authenticated clock without video layers', () => {
	const source = createVideoExactPictureExportFrameSource({
		sampleRate: 48_000, startFrame: 4_800, endFrame: 14_400,
		canvas: {
			width: 4, height: 2, frameRate: { num: 10, den: 1 },
			fit: 'contain', backgroundColor: '#000000',
		},
	});
	assert.equal(source.frameCount, 2);
	assert.deepEqual(source.frame(1), {
		index: 1, timelineSample: 9_600,
		timelinePosition: { num: 9_600, den: 1 }, layers: [],
	});
});

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

test('static clips without keyed sequence geometry use the renderer-neutral fast path', () => {
	const project = {
		schemaVersion: 9,
		sampleRate: 1,
		primarySequenceId: 'sequence-1',
		sequences: [{ id: 'sequence-1', type: 'samples', trackIds: ['track-1'] }],
		sources: [{ id: 'source-1', kind: 'video', sampleRate: 1, width: 2, height: 2 }],
		clips: [{
			id: 'clip-1', kind: 'video', sourceId: 'source-1', sequenceId: 'sequence-1',
			timelineStartFrame: 0, durationFrames: 1,
			sourceStartFrame: 0, sourceDurationFrames: 1, videoEffects: [],
		}],
		tracks: [{ id: 'track-1', type: 'video', clipIds: ['clip-1'] }],
		projectBin: { clips: [] },
	};
	const source = createVideoKeyframeExportFrameSource({
		project,
		canvas: { width: 2, height: 2, frameRate: 1 },
	});
	const entry = (source.frame(0).layers[0] as {
		clips: readonly [{ renderDescription: { blendMode: string } }];
	}).clips[0];
	assert.equal(entry.renderDescription.blendMode, DEFAULT_VIDEO_CLIP_COMPOSITION.blendMode);
});

test('frame source binds exact presentation descriptors to keyed and static clip entries', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const runtime = runtimeProject(project);
	const calls: Array<Readonly<Record<string, unknown>>> = [];
	const descriptor = Object.freeze({ authority: 'exact-presentation' });
	const source = createVideoKeyframeExportFrameSource({
		project: runtime,
		canvas: { width: 320, height: 180, frameRate: 3 },
		resolvePresentationDescriptor(request) {
			calls.push(request as unknown as Readonly<Record<string, unknown>>);
			return descriptor as never;
		},
	});
	const frame = source.frame(1);
	const entry = (frame.layers[0] as { clips: readonly [Readonly<Record<string, unknown>>] }).clips[0];
	assert.equal(entry.presentationDescriptor, descriptor);
	assert.equal(calls.length, 1);
	assert.equal((calls[0]?.clip as { id: string }).id, entry.clipId);
	assert.equal((calls[0]?.source as { id: string }).id, entry.sourceId);
	assert.deepEqual(calls[0]?.localSequencePosition, { num: 10, den: 3 });
	assert.equal(calls[0]?.outputOrdinal, 1);

	const keyedProject = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	(keyedProject.clips[0] as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes();
	const keyedSource = createVideoKeyframeExportFrameSource({
		project: runtimeProject(keyedProject),
		canvas: { width: 320, height: 180, frameRate: 3 },
		resolvePresentationDescriptor: () => descriptor as never,
	});
	const keyedEntry = (keyedSource.frame(1).layers[0] as {
		clips: readonly [Readonly<Record<string, unknown>>];
	}).clips[0];
	assert.equal(keyedEntry.presentationDescriptor, descriptor);
	assert.ok(Array.isArray(keyedEntry.videoEffects));
});

test('frame source snapshots presentation authority without invoking accessors', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const runtime = runtimeProject(project);
	let calls = 0;
	const request: Record<string, unknown> = {
		project: runtime,
		canvas: { width: 320, height: 180, frameRate: 3 },
	};
	Object.defineProperty(request, 'resolvePresentationDescriptor', {
		enumerable: true,
		get() { calls += 1; return () => ({}); },
	});
	assert.throws(
		() => createVideoKeyframeExportFrameSource(request as never),
		/resolvePresentationDescriptor.*data property/u,
	);
	assert.equal(calls, 0);
});

test('frame source privately brands each lazy frame to its exact owning snapshot', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const request = {
		project: runtimeProject(project),
		canvas: { width: 320, height: 180, frameRate: 3 },
	} as const;
	const first = createVideoKeyframeExportFrameSource(request);
	const second = createVideoKeyframeExportFrameSource(request);
	const frame = first.frame(0);
	assert.doesNotThrow(() => assertVideoKeyframeExportFrameSource(first));
	assert.throws(
		() => assertVideoKeyframeExportFrameSource({ ...first }),
		/authenticated.*frame source/u,
	);
	assert.doesNotThrow(() => assertVideoKeyframeExportFrame(first, frame));
	assert.throws(
		() => assertVideoKeyframeExportFrame(second, frame),
		/owned by the requested.*frame source/u,
	);
	assert.throws(
		() => assertVideoKeyframeExportFrame(first, structuredClone(frame)),
		/owned by the requested.*frame source/u,
	);
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

test('a keyed frame is placed by the fit its delivery canvas states', () => {
	// Nothing tied the keyed path's fit to the picture it renders: replacing this
	// seam with the constant `contain` kept every video and Framescaper test
	// green, and a 9:16 cover delivery would have letterboxed while the plan and
	// the report both still said cover — the quieter of the two bugs commit
	// b2b909bd was written about.
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const clip = project.clips[0] as unknown as Record<string, unknown>;
	clip.videoKeyframes = opacityKeyframes();
	const runtime = runtimeProject(project);
	const placement = (fit: 'contain' | 'cover' | 'stretch') => {
		const source = createVideoKeyframeExportFrameSource({
			project: runtime,
			canvas: { width: 1_080, height: 1_920, frameRate: 3, fit },
			startFrame: 0,
			endFrame: 48_000,
		});
		const layer = source.frame(1).layers[0] as {
			clips: readonly [{ renderDescription: { sourceDisplayToCanvas: readonly number[] } }];
		};
		return layer.clips[0].renderDescription.sourceDisplayToCanvas;
	};

	const contain = placement('contain');
	const cover = placement('cover');
	const stretch = placement('stretch');

	// `contain` fits inside and leaves bars; `cover` fills the height and
	// overhangs; `stretch` abandons the aspect. Each scale is the fit's own.
	assert.ok(cover[0]! > contain[0]!, 'cover scales past the contain fit rather than matching it');
	assert.ok(cover[4]! < 0, 'and hangs off the left edge, which is the crop');
	assert.equal(contain[4], 0);
	assert.ok(contain[5]! > 0, 'contain centres the picture between its bars');
	// Rounding the fitted extents to whole pixels leaves the two axes a fraction
	// apart; the fit is what makes them near-equal at all.
	assert.ok(Math.abs(contain[0]! - contain[3]!) < 0.001, 'contain keeps the aspect');
	assert.ok(Math.abs(stretch[0]! - stretch[3]!) > 0.5, 'stretch does not');
});
