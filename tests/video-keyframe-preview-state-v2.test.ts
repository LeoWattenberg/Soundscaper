/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createVideoPreviewKeyframeStateProvider } from '../src/common/editor/ui/workspace/video-preview-keyframe-state-provider.ts';
import { resolveVideoKeyframePreviewStateCurrent } from '../src/common/editor/video-keyframe-preview-state-v2.ts';
import { isVideoKeyframePreviewStateError } from '../src/common/editor/video-keyframe-preview-state.ts';
import { bindCubeLutEffectPortV1 } from '../src/common/editor/controller/clip-video/cube-lut-effect-port-v1.ts';

const REF = { storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: 73,
	size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
function request(enabled = true, lut: unknown = REF) {
	return { clip: { kind: 'video', id: 'clip', timelineStartFrame: 100, durationFrames: 1000, sequenceFrameCount: 10,
		videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		videoEffects: [{ id: 'cube', type: 'cube-lut-profile-v1', enabled, params: { lut } }],
		videoKeyframes: { schemaVersion: 1, timeDomain: { authoredDuration: { num: 10, den: 1 }, viewStart: { num: 0, den: 1 }, viewDuration: { num: 10, den: 1 } },
			curves: [{ target: { kind: 'composition', parameterId: 'opacity' }, curve: {
				anchors: [{ position: { num: 0, den: 1 }, value: 0 }, { position: { num: 10, den: 1 }, value: 1 }], segments: [{ kind: 'linear' }] } }] } },
		timelineSample: 350, sourceDisplaySize: { width: 2, height: 2 }, canvas: { width: 2, height: 2, fit: 'contain' as const } };
}

test('current preview provider requires the private product capability and preserves exact discrete resources at the playing clock position', () => {
	const owner = {}, legacy = createVideoPreviewKeyframeStateProvider(owner);
	assert.throws(() => resolveVideoKeyframePreviewStateCurrent(legacy, request()), isVideoKeyframePreviewStateError);
	bindCubeLutEffectPortV1(owner, { capture: () => null, isCurrent: () => false,
		importFile: () => Promise.reject(new Error('No IO in state admission.')), clear: () => Promise.resolve(), close: () => Promise.resolve() });
	const provider = createVideoPreviewKeyframeStateProvider(owner);
	for (const [enabled, lut] of [[true, REF], [false, REF], [true, null]] as const) {
		const state = resolveVideoKeyframePreviewStateCurrent(provider, request(enabled, lut)); assert.ok(state);
		assert.equal(state.composition.opacity, 0.25); assert.deepEqual(state.videoEffects[0]?.params.lut, lut);
		assert.equal(state.videoEffects[0]?.enabled, enabled); assert.equal(Object.isFrozen(state.videoEffects), true);
	}
});

test('current preview admission preserves old legacy bypass and brands malformed keyed state without interpolating references', () => {
	assert.equal(resolveVideoKeyframePreviewStateCurrent(null, { ...request(), clip: {} }), null);
	assert.throws(() => resolveVideoKeyframePreviewStateCurrent(createVideoPreviewKeyframeStateProvider({}), request()), isVideoKeyframePreviewStateError);
});
