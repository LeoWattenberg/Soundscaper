/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { normalizeContextVideoEffects } from '../src/common/editor/video-keyframe-effect-context.ts';
import { compileVideoKeyframedClipState, evaluateVideoKeyframedClipState } from '../src/common/editor/video-keyframe-state.ts';
import { normalizeContextVideoEffectsV2 } from '../src/common/editor/video-keyframe-effect-context-v2.ts';
import { normalizeVideoKeyframeCurvesV2 } from '../src/common/editor/video-keyframe-curves-v2.ts';
import { compileVideoKeyframedClipStateV2, evaluateVideoKeyframedClipStateV2 } from '../src/common/editor/video-keyframe-state-v2.ts';
import { createVideoKeyframeRenderStateProviderV2 } from '../src/common/editor/video-keyframe-render-state-provider-v2.ts';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';

const rational = (num: number, den = 1) => ({ num, den });
function reference() { return { storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: 73,
	size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] }; }
function keyframes(target?: Record<string, unknown>) { return { schemaVersion: 1,
	timeDomain: { authoredDuration: rational(10), viewStart: rational(0), viewDuration: rational(10) },
	curves: target ? [{ target, curve: { anchors: [{ position: rational(0), value: 0 }, { position: rational(10), value: 1 }], segments: [{ kind: 'linear' }] } }] : [] }; }
function request() { return { videoKeyframes: keyframes(), sequenceFrameCount: rational(10), composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
	videoEffects: [createVideoEffectV2('tone-ladder-v1', { id: 'tone' }), createVideoEffectV2('cube-lut-profile-v1', { id: 'cube', params: { lut: reference() } })] }; }

test('named V2 context retains exact detached discrete LUT references while old context and compiler remain strict', () => {
	const ref = reference(), raw = [{ id: 'cube', type: 'cube-lut-profile-v1', enabled: false, params: { lut: ref } }];
	const admitted = normalizeContextVideoEffectsV2(raw, 'context'); ref.domainMin[0] = -1;
	assert.deepEqual(admitted[0]?.params.lut, reference()); assert.equal(Object.isFrozen(admitted[0]?.params.lut), true);
	assert.throws(() => normalizeContextVideoEffects(raw, 'old context'));
	assert.throws(() => compileVideoKeyframedClipState(request()));
	assert.deepEqual(normalizeContextVideoEffectsV2([{ ...raw[0], params: { lut: null } }], 'null')[0]?.params, { lut: null });
});

test('V2 empty and numeric contexts preserve cube refs at authored position without numeric resource interpolation', () => {
	const base = request();
	const compiled = compileVideoKeyframedClipStateV2({ ...base, videoKeyframes: keyframes({ kind: 'video-effect', effectId: 'tone', parameterId: 'exposure' }) });
	const evaluated = evaluateVideoKeyframedClipStateV2(compiled, rational(5));
	assert.equal(evaluated.videoEffects[0]?.params.exposure, 0.5); assert.deepEqual(evaluated.videoEffects[1]?.params.lut, reference());
	assert.equal(Object.isFrozen(evaluated.videoEffects), true);
	for (const lut of [reference(), null]) {
		const options = { duration: rational(10), composition: base.composition,
			videoEffects: [{ id: 'cube', type: 'cube-lut-profile-v1', enabled: true, params: { lut } }] };
		assert.throws(() => normalizeVideoKeyframeCurvesV2(keyframes({ kind: 'video-effect', effectId: 'cube', parameterId: 'lut' }), options), /numeric/u);
	}
	assert.throws(() => evaluateVideoKeyframedClipStateV2(structuredClone(compiled), rational(5)), /compiled/u);
	assert.throws(() => evaluateVideoKeyframedClipState(compiled, rational(5)), /compiled/u);
});

test('V2 legacy numeric evaluation remains byte-equivalent and the render provider fences clip identity and exact sample', () => {
	const old = { ...request(), videoEffects: [createVideoEffectV2('tone-ladder-v1', { id: 'tone' })],
		videoKeyframes: keyframes({ kind: 'video-effect', effectId: 'tone', parameterId: 'exposure' }) };
	const legacy = compileVideoKeyframedClipState(old), current = compileVideoKeyframedClipStateV2(old);
	for (const position of [0, 5, 10]) assert.deepEqual(evaluateVideoKeyframedClipStateV2(current, position), evaluateVideoKeyframedClipState(legacy, position));
	const base = request(), clip = { kind: 'video', sequenceFrameCount: 10, videoComposition: base.composition,
		videoKeyframes: base.videoKeyframes, videoEffects: base.videoEffects };
	const provider = createVideoKeyframeRenderStateProviderV2(), query = { clip, localSequencePosition: rational(5),
		sourceDisplaySize: { width: 2, height: 2 }, canvas: { width: 2, height: 2, fit: 'contain' as const } };
	const first = provider.resolve(query); assert.equal(provider.resolve(query), first);
	assert.deepEqual(first.videoEffects[1]?.params.lut, reference());
	assert.notEqual(provider.resolve({ ...query, clip: structuredClone(clip) }), first);
});
