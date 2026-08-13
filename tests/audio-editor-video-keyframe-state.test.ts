/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
} from '../src/common/editor/video-clip-composition.ts';
import {
	compileVideoKeyframedClipState,
	evaluateVideoKeyframedClipState,
} from '../src/common/editor/video-keyframe-state.ts';
import {
	mapVideoKeyframeVisiblePosition,
	normalizeVideoKeyframeTimeDomain,
} from '../src/common/editor/video-keyframe-time-domain.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const rational = (num: number, den = 1) => ({ num, den });
const timeDomain = (duration: number) => ({
	authoredDuration: rational(duration),
	viewStart: rational(0),
	viewDuration: rational(duration),
});
const curve = (start: number, end: number, kind: 'hold' | 'linear' = 'linear') => ({
	anchors: [
		{ position: rational(0), value: start },
		{ position: rational(10), value: end },
	],
	segments: [{ kind }],
});

test('compiled keyframe state evaluates composition and effect patches through one immutable authority', () => {
	const composition = structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION);
	const videoEffects = [
		createVideoEffect('color-adjust', { id: 'color' }),
		createVideoEffect('pixelate', { id: 'pixel' }),
	];
	const input = {
		schemaVersion: 1,
		timeDomain: timeDomain(10),
		curves: [{
			target: { kind: 'composition', parameterId: 'transform.positionX' },
			curve: curve(0.5, 0.75),
		}, {
			target: { kind: 'composition', parameterId: 'crop.left' },
			curve: curve(0, 0.2),
		}, {
			target: { kind: 'composition', parameterId: 'opacity' },
			curve: curve(1, 0.5),
		}, {
			target: { kind: 'video-effect', effectId: 'color', parameterId: 'brightness' },
			curve: curve(-1, 1),
		}, {
			target: { kind: 'video-effect', effectId: 'pixel', parameterId: 'blockSize' },
			curve: curve(8, 32, 'hold'),
		}],
	};
	const compiled = compileVideoKeyframedClipState({
		videoKeyframes: input,
		sequenceFrameCount: rational(10),
		composition,
		videoEffects,
	});
	const evaluated = evaluateVideoKeyframedClipState(compiled, rational(5));

	assert.equal(evaluated.composition.transform.positionX, 0.625);
	assert.equal(evaluated.composition.crop.left, 0.1);
	assert.equal(evaluated.composition.opacity, 0.75);
	assert.equal(evaluated.videoEffects[0]?.params['brightness'], 0);
	assert.equal(evaluated.videoEffects[1]?.params['blockSize'], 8);
	assert.deepEqual(composition, DEFAULT_VIDEO_CLIP_COMPOSITION);
	assert.equal(effectParameter(videoEffects[0], 'brightness'), 0);
	assert.notStrictEqual(evaluated.composition, composition);
	assert.notStrictEqual(evaluated.videoEffects, videoEffects);
	assertDeepFrozen(evaluated);

	input.curves[0]!.curve.anchors[1]!.value = 0.6;
	setEffectParameter(videoEffects[0], 'brightness', 0.5);
	assert.equal(
		evaluateVideoKeyframedClipState(compiled, rational(10)).composition.transform.positionX,
		0.75,
	);
	assert.equal(
		evaluateVideoKeyframedClipState(compiled, rational(10)).videoEffects[0]?.params['brightness'],
		1,
	);
});

test('effect targets reject inherited registry member names', () => {
	for (const parameterId of ['__proto__', 'constructor', 'toString']) assert.throws(
		() => compileVideoKeyframedClipState({
			videoKeyframes: {
				schemaVersion: 1, timeDomain: timeDomain(10),
				curves: [{
					target: { kind: 'video-effect', effectId: 'color', parameterId },
					curve: curve(0, 1),
				}],
			},
			sequenceFrameCount: rational(10),
			composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
			videoEffects: [createVideoEffect('color-adjust', { id: 'color' })],
		}),
		/parameterId.*not registered/iu,
	);
});

test('the public compiler rejects request accessors without invoking them', () => {
	let getterCalls = 0;
	const request = {
		videoKeyframes: { schemaVersion: 1, timeDomain: timeDomain(1), curves: [] },
		sequenceFrameCount: rational(1),
		composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		videoEffects: [],
	};
	Object.defineProperty(request, 'composition', {
		enumerable: true,
		get() { getterCalls += 1; return DEFAULT_VIDEO_CLIP_COMPOSITION; },
	});
	assert.throws(
		() => compileVideoKeyframedClipState(request),
		/composition.*data property|accessor/iu,
	);
	assert.equal(getterCalls, 0);

	assert.throws(() => compileVideoKeyframedClipState({
		videoKeyframes: {
			schemaVersion: 1,
			timeDomain: timeDomain(1),
			curves: Array.from({ length: 100_001 }, () => null),
		},
		sequenceFrameCount: rational(1),
		composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		videoEffects: [],
	}), /structural traversal node limit/iu);
});

test('visible mapping reduces the complete affine expression before publishing it', () => {
	const wide = 9_007_199_253_999_999;
	assert.deepEqual(mapVideoKeyframeVisiblePosition({
		authoredDuration: rational(1),
		viewStart: rational(1, 1_000_000),
		viewDuration: rational(1, 1_000_000),
	}, rational(1), rational(1, wide)), { num: 9_007_199_254, den: wide });
});

test('time-domain containment compares an exact sum without publishing the intermediate', () => {
	const almostWide = 9_007_199_254_740_991;
	assert.deepEqual(normalizeVideoKeyframeTimeDomain({
		authoredDuration: rational(20_000_000_000),
		viewStart: rational(almostWide, 999_983),
		viewDuration: rational(almostWide, 999_983),
	}), {
		authoredDuration: rational(20_000_000_000),
		viewStart: rational(almostWide, 999_983),
		viewDuration: rational(almostWide, 999_983),
	});
});

test('empty keyframes still return detached normalized static state', () => {
	const composition = structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION);
	const effects = [createVideoEffect('vignette', { id: 'vignette' })];
	const evaluated = evaluateVideoKeyframedClipState(compileVideoKeyframedClipState({
		videoKeyframes: { schemaVersion: 1, timeDomain: timeDomain(1), curves: [] },
		sequenceFrameCount: rational(1),
		composition,
		videoEffects: effects,
	}), 0);

	assert.deepEqual(evaluated, { composition, videoEffects: effects });
	assert.notStrictEqual(evaluated.composition, composition);
	assert.notStrictEqual(evaluated.videoEffects, effects);
	assert.notStrictEqual(evaluated.videoEffects[0], effects[0]);
	assertDeepFrozen(evaluated);
});

test('compiled state owns the exact visible-view mapping for every renderer consumer', () => {
	const compiled = compileVideoKeyframedClipState({
		videoKeyframes: {
			schemaVersion: 1,
			timeDomain: {
				authoredDuration: rational(10),
				viewStart: rational(2),
				viewDuration: rational(4),
			},
			curves: [{
				target: { kind: 'composition', parameterId: 'opacity' },
				curve: curve(0, 1),
			}],
		},
		sequenceFrameCount: rational(8),
		composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		videoEffects: [],
	});

	assert.equal(evaluateVideoKeyframedClipState(compiled, rational(0)).composition.opacity, 0.2);
	assert.equal(evaluateVideoKeyframedClipState(compiled, rational(4)).composition.opacity, 0.4);
	assert.equal(evaluateVideoKeyframedClipState(compiled, rational(8)).composition.opacity, 0.6);
});

test('the evaluator rejects uncompiled state, out-of-domain queries, and contradictory derived patches', () => {
	const request = {
		videoKeyframes: { schemaVersion: 1, curves: [{
			target: { kind: 'composition', parameterId: 'crop.left' },
			curve: curve(0, 0.9),
		}, {
			target: { kind: 'composition', parameterId: 'crop.right' },
			curve: curve(0, 0.2),
		}], timeDomain: timeDomain(10) },
		sequenceFrameCount: rational(10),
		composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		videoEffects: [],
	};
	assert.throws(() => compileVideoKeyframedClipState(request), /crop|sum|less than 1/iu);
	assert.throws(() => evaluateVideoKeyframedClipState({}, 0), /compiled|keyframe state/iu);

	const compiled = compileVideoKeyframedClipState({
		...request,
		videoKeyframes: { schemaVersion: 1, timeDomain: timeDomain(10), curves: [] },
	});
	assert.throws(() => evaluateVideoKeyframedClipState(compiled, rational(11)), /domain|position/iu);
});

function assertDeepFrozen(value: unknown): void {
	if (!value || typeof value !== 'object') return;
	assert.equal(Object.isFrozen(value), true);
	for (const child of Object.values(value)) assertDeepFrozen(child);
}

function effectParameter(value: unknown, parameterId: string): number | undefined {
	return (value as { readonly params?: Readonly<Record<string, number>> } | undefined)
		?.params?.[parameterId];
}

function setEffectParameter(value: unknown, parameterId: string, parameterValue: number): void {
	const effect = value as { params: Record<string, number> };
	effect.params[parameterId] = parameterValue;
}
