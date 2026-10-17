/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeContextVideoEffects } from '../src/common/editor/video-keyframe-effect-context.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { normalizeVideoKeyframeCurves, createDefaultVideoKeyframeCurves } from '../src/common/editor/video-keyframe-curves.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';

test('keyframe context retains closed point recipes without weakening any old numeric parameter admission', () => {
	const points = [{ x: 0, y: 1 }, { x: 1, y: 0 }], input = createVideoEffect('point-curves-v1', { id: 'p', params: { master: points } });
	const result = normalizeContextVideoEffects([input, createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } })], 'context');
	assert.deepEqual(result[0]!.params.master, points); points[0]!.y = 0;
	assert.deepEqual(result[0]!.params.master, [{ x: 0, y: 1 }, { x: 1, y: 0 }]);
	assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result[0]!.params.master)); assert.equal(result[1]!.params.exposure, 1);
	for (const type of ['tone-ladder-v1', 'color-adjust', 'pixelate']) {
		const param = type === 'tone-ladder-v1' ? 'exposure' : type === 'color-adjust' ? 'brightness' : 'blockSize';
		assert.throws(() => normalizeContextVideoEffects([{ id: 'bad', type, enabled: true, params: { [param]: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } }], 'context'));
	}
});

test('numeric keyframes explicitly refuse structured point targets while parametric numeric controls remain interpolable', () => {
	const curves = { ...createDefaultVideoKeyframeCurves(1), curves: [{ target: { kind: 'video-effect', effectId: 'p', parameterId: 'master' },
		curve: { anchors: [{ position: { num: 0, den: 1 }, value: 0 }, { position: { num: 1, den: 1 }, value: 1 }], segments: [{ kind: 'linear' }] } }] };
	const options = { duration: { num: 1, den: 1 }, composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		videoEffects: [createVideoEffect('point-curves-v1', { id: 'p' })] };
	assert.throws(() => normalizeVideoKeyframeCurves(curves, options), /numeric/u);
	const target = { kind: 'video-effect', effectId: 'q', parameterId: 'masterShadows' };
	const result = normalizeVideoKeyframeCurves({ ...curves, curves: [{ ...curves.curves[0]!, target }] },
		{ ...options, videoEffects: [createVideoEffect('parametric-curves-v1', { id: 'q' })] });
	assert.deepEqual(result.curves[0]!.target, target);
});

test('keyframe context keeps closed effect fields, unique IDs, dense4096 bound and descriptor-safe parameters', () => {
	let reads = 0;
	const points = Object.defineProperty({}, 'master', { enumerable: true, get() { reads++; return []; } });
	assert.throws(() => normalizeContextVideoEffects([{ id: 'p', type: 'point-curves-v1', enabled: true, params: points }], 'context'));
	const numeric = Object.defineProperty({}, 'brightness', { enumerable: true, get() { reads++; return 0; } });
	assert.throws(() => normalizeContextVideoEffects([{ id: 'c', type: 'color-adjust', enabled: true, params: numeric }], 'context'));
	assert.equal(reads, 0);
	const effect = createVideoEffect('point-curves-v1', { id: 'p' });
	assert.throws(() => normalizeContextVideoEffects([effect, effect], 'context'));
	assert.throws(() => normalizeContextVideoEffects([{ ...effect, future: 1 }], 'context'));
	assert.throws(() => normalizeContextVideoEffects(Array.from({ length: 4097 }, () => effect), 'context'));
});
