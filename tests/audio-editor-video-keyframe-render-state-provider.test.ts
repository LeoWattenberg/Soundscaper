/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
	normalizeVideoClipComposition,
} from '../src/common/editor/video-clip-composition.ts';
import {
	createVideoKeyframeRenderStateProvider,
} from '../src/common/editor/video-keyframe-render-state-provider.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const rational = (num: number, den = 1) => ({ num, den });

function composition(changes: Readonly<Record<string, unknown>> = {}) {
	return normalizeVideoClipComposition({
		...DEFAULT_VIDEO_CLIP_COMPOSITION,
		...changes,
		crop: {
			...DEFAULT_VIDEO_CLIP_COMPOSITION.crop,
			...(changes.crop as Readonly<Record<string, unknown>> | undefined),
		},
		transform: {
			...DEFAULT_VIDEO_CLIP_COMPOSITION.transform,
			...(changes.transform as Readonly<Record<string, unknown>> | undefined),
		},
	});
}

function interpolationCurve(
	kind: 'hold' | 'linear' | 'eased' | 'bezier',
	start: number,
	end: number,
	duration = 12,
) {
	return {
		anchors: [
			{ position: rational(0), value: start },
			{ position: rational(duration), value: end },
		],
		segments: [kind === 'bezier' ? {
			kind,
			control1: { position: rational(duration / 3), value: 1 },
			control2: { position: rational(duration * 2 / 3), value: 1 },
		} : { kind }],
	};
}

function keyframes(
	curves: readonly unknown[],
	authoredDuration = 12,
	viewStart = rational(0),
	viewDuration = rational(authoredDuration),
) {
	return {
		schemaVersion: 1,
		timeDomain: {
			authoredDuration: rational(authoredDuration),
			viewStart,
			viewDuration,
		},
		curves,
	};
}

function clip(options: Readonly<{
	duration?: number;
	composition?: unknown;
	effects?: unknown;
	keyframes?: unknown;
}> = {}) {
	const duration = options.duration ?? 12;
	return {
		kind: 'video',
		sequenceFrameCount: duration,
		videoComposition: Object.hasOwn(options, 'composition')
			? options.composition
			: DEFAULT_VIDEO_CLIP_COMPOSITION,
		videoEffects: Object.hasOwn(options, 'effects') ? options.effects : [],
		videoKeyframes: Object.hasOwn(options, 'keyframes')
			? options.keyframes
			: keyframes([], duration),
	};
}

function request(
	clipValue: unknown,
	localSequencePosition: number | Readonly<{ num: number; den: number }>,
	changes: Readonly<Record<string, unknown>> = {},
) {
	return {
		clip: clipValue,
		localSequencePosition,
		sourceDisplaySize: { width: 320, height: 180 },
		canvas: { width: 640, height: 360 },
		...changes,
	};
}

test('one current-frame query resolves hold, linear, eased, Bezier, and effect curves', () => {
	const effects = [createVideoEffect('color-adjust', { id: 'color' })];
	const clipValue = clip({
		composition: composition({
			blendMode: 'screen',
			compositingOrder: 7,
			transform: { flipHorizontal: true, flipVertical: true },
		}),
		effects,
		keyframes: keyframes([
			{
				target: { kind: 'composition', parameterId: 'opacity' },
				curve: interpolationCurve('hold', 0.2, 0.8),
			}, {
				target: { kind: 'composition', parameterId: 'transform.positionX' },
				curve: interpolationCurve('linear', 0, 1),
			}, {
				target: { kind: 'composition', parameterId: 'transform.positionY' },
				curve: interpolationCurve('eased', 0, 1),
			}, {
				target: { kind: 'composition', parameterId: 'transform.anchorX' },
				curve: interpolationCurve('bezier', 0, 1),
			}, {
				target: { kind: 'video-effect', effectId: 'color', parameterId: 'brightness' },
				curve: interpolationCurve('linear', -1, 1),
			},
		]),
	});
	const provider = createVideoKeyframeRenderStateProvider();
	const state = provider.resolve(request(clipValue, rational(3), {
		transitionWeightStart: 0.5,
		transitionWeightEnd: 0.25,
	}));

	assert.equal(state.composition.opacity, 0.2);
	assert.equal(state.composition.transform.positionX, 0.25);
	assert.equal(state.composition.transform.positionY, 0.15625);
	assertClose(state.composition.transform.anchorX, 0.578125);
	assert.equal(state.composition.transform.flipHorizontal, true);
	assert.equal(state.composition.transform.flipVertical, true);
	assert.equal(state.composition.blendMode, 'screen');
	assert.equal(state.composition.compositingOrder, 7);
	assert.equal(state.videoEffects[0]?.params['brightness'], -0.5);
	assert.deepEqual(state.transitionWeights, { start: 0.5, end: 0.25 });
	assertClose(state.renderDescription.opacityStart, 0.1);
	assertClose(state.renderDescription.opacityEnd, 0.05);
	assert.equal(state.renderDescription.blendMode, 'screen');
	assert.equal(state.renderDescription.compositingOrder, 7);
	assertDeepFrozen(state);
});

test('trimmed and stretched views map exact local positions without rewriting authored curves', () => {
	const clipValue = clip({
		duration: 12,
		keyframes: keyframes([{
			target: { kind: 'composition', parameterId: 'opacity' },
			curve: interpolationCurve('linear', 0, 1),
		}], 12, rational(3), rational(6)),
	});
	const provider = createVideoKeyframeRenderStateProvider();

	assert.equal(provider.resolve(request(clipValue, rational(0))).composition.opacity, 0.25);
	assert.equal(provider.resolve(request(clipValue, rational(6))).composition.opacity, 0.5);
	assert.equal(provider.resolve(request(clipValue, rational(12))).composition.opacity, 0.75);
});

test('the snapshot authority compiles lazily once and retains only its current resolved frame', () => {
	const baseComposition = structuredClone(composition({ opacity: 0.4 }));
	const effects = structuredClone([createVideoEffect('color-adjust', { id: 'color' })]);
	const authored = keyframes([]);
	const active = clip({ composition: baseComposition, effects, keyframes: authored });
	const dormantInvalid = clip({ keyframes: null });
	const provider = createVideoKeyframeRenderStateProvider();

	const first = provider.resolve(request(active, rational(0)));
	assert.strictEqual(provider.resolve(request(active, rational(0))), first);
	assert.doesNotThrow(() => first);

	(baseComposition as unknown as { opacity: number }).opacity = 0.9;
	(effects[0] as unknown as { params: Record<string, number> }).params.brightness = 1;
	(authored.curves as unknown[]).push({ unsupported: true });
	const second = provider.resolve(request(active, rational(1)));
	assert.notStrictEqual(second, first);
	assert.equal(second.composition.opacity, 0.4);
	assert.equal(second.videoEffects[0]?.params['brightness'], 0);
	const firstAgain = provider.resolve(request(active, rational(0)));
	assert.notStrictEqual(firstAgain, first, 'only the immediately current query may be retained');
	assert.throws(() => provider.resolve(request(dormantInvalid, rational(0))), /keyframe|plain object/iu);
	assertDeepFrozen(firstAgain);
});

test('a two-million-frame clip is queried directly without materializing a frame table', () => {
	const duration = 2_000_000;
	const provider = createVideoKeyframeRenderStateProvider();
	const clipValue = clip({
		duration,
		keyframes: keyframes([{
			target: { kind: 'composition', parameterId: 'opacity' },
			curve: interpolationCurve('linear', 0, 1, duration),
		}], duration),
	});

	const state = provider.resolve(request(clipValue, rational(1_999_999)));
	assertClose(state.composition.opacity, 1_999_999 / 2_000_000);
	assert.equal(Object.hasOwn(clipValue.videoKeyframes as object, 'samples'), false);
	assert.equal(Object.hasOwn(state, 'samples'), false);
});

test('invalid clip descriptors, positions, transition weights, and discrete targets fail closed', () => {
	const provider = createVideoKeyframeRenderStateProvider();
	let getterCalls = 0;
	const accessorClip = clip();
	Object.defineProperty(accessorClip, 'videoKeyframes', {
		enumerable: true,
		get() {
			getterCalls += 1;
			return keyframes([]);
		},
	});
	assert.throws(() => provider.resolve(request(accessorClip, rational(0))), /videoKeyframes.*data property/iu);
	assert.equal(getterCalls, 0);

	const valid = clip();
	assert.throws(() => provider.resolve(request(valid, rational(13))), /domain|position/iu);
	assert.throws(() => provider.resolve(request(valid, rational(0), {
		transitionWeightStart: 1.01,
	})), /transitionWeightStart/iu);
	assert.throws(() => provider.resolve(request([], rational(0))), /clip.*object/iu);
	assert.throws(() => provider.resolve(request({ ...valid, kind: 'audio' }, rational(0))), /kind.*video/iu);
	assert.throws(() => provider.resolve(request(clip({
		keyframes: keyframes([{
			target: { kind: 'composition', parameterId: 'blendMode' },
			curve: interpolationCurve('hold', 0, 1),
		}]),
	}), rational(0))), /interpolable|target|parameter/iu);
});

function assertClose(actual: number, expected: number): void {
	assert.ok(Math.abs(actual - expected) < 1e-12, `${String(actual)} != ${String(expected)}`);
}

function assertDeepFrozen(value: unknown): void {
	if (!value || typeof value !== 'object') return;
	assert.equal(Object.isFrozen(value), true);
	for (const child of Object.values(value)) assertDeepFrozen(child);
}
