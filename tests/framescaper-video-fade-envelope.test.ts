/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createDefaultVideoKeyframeCurves, evaluateVideoKeyframeCurves, normalizeVideoKeyframeCurves, splitVideoKeyframeCurvesAt, trimVideoKeyframeCurvesToRange } from '../src/common/editor/video-keyframe-curves.ts';
import { createVideoFadeKeyframes, readVideoFadeEnvelope } from '../src/common/editor/ui/timeline/video-fade-envelope.ts';

const clip = {
	sequenceFrameCount: 120,
	videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
	videoEffects: [],
	videoKeyframes: createDefaultVideoKeyframeCurves(120),
};

test('video fade handles author opacity that persists in the existing keyframe contract', () => {
	const keyframes = createVideoFadeKeyframes(clip, 'in', 30);
	const faded = { ...clip, videoKeyframes: keyframes };
	assert.equal(opacityAt(faded, 0), 0);
	assert.equal(opacityAt(faded, 15), 0.5);
	assert.equal(opacityAt(faded, 30), 1);
	assert.deepEqual(readVideoFadeEnvelope(faded), { fadeInFrames: 30, fadeOutFrames: 0, peak: 1 });
	const both = { ...faded, videoKeyframes: createVideoFadeKeyframes(faded, 'out', 40) };
	assert.equal(opacityAt(both, 100), 0.5);
	assert.equal(opacityAt(both, 120), 0);
	assert.deepEqual(readVideoFadeEnvelope(both), { fadeInFrames: 30, fadeOutFrames: 40, peak: 1 });
});

test('editing and removing a fade preserves other composition curves and the base opacity', () => {
	const dim = { ...clip, videoComposition: { ...DEFAULT_VIDEO_CLIP_COMPOSITION, opacity: 0.7 } };
	const keyframes = normalizeVideoKeyframeCurves({ ...clip.videoKeyframes, curves: [{
		target: { kind: 'composition', parameterId: 'transform.scaleX' },
		curve: { anchors: [{ position: { num: 0, den: 1 }, value: 1 }, { position: { num: 120, den: 1 }, value: 2 }], segments: [{ kind: 'linear' }] },
	}] }, { duration: 120, composition: dim.videoComposition, videoEffects: [] });
	const original = { ...dim, videoKeyframes: keyframes };
	const faded = { ...original, videoKeyframes: createVideoFadeKeyframes(original, 'out', 24) };
	assert.equal(opacityAt(faded, 108), 0.35);
	assert.deepEqual(faded.videoKeyframes.curves[1], keyframes.curves[0]);
	assert.deepEqual(createVideoFadeKeyframes(faded, 'out', 0), keyframes);
});

test('fade ranges are bounded by the other edge and arbitrary authored opacity is preserved', () => {
	const faded = { ...clip, videoKeyframes: createVideoFadeKeyframes(clip, 'in', 80) };
	assert.equal(readVideoFadeEnvelope({ ...faded, videoKeyframes: createVideoFadeKeyframes(faded, 'out', 120) })?.fadeOutFrames, 40);
	const custom = { ...clip, videoKeyframes: normalizeVideoKeyframeCurves({ ...clip.videoKeyframes, curves: [{
		target: { kind: 'composition', parameterId: 'opacity' },
		curve: { anchors: [{ position: { num: 0, den: 1 }, value: 0.4 }, { position: { num: 120, den: 1 }, value: 0.8 }], segments: [{ kind: 'linear' }] },
	}] }, { duration: 120, composition: clip.videoComposition, videoEffects: [] }) };
	assert.equal(readVideoFadeEnvelope(custom), null);
	assert.throws(() => createVideoFadeKeyframes(custom, 'in', 12), /opacity/u);
});

test('quick fades remain editable in a trimmed keyframe view', () => {
	const trimmed = { ...clip, sequenceFrameCount: 60, videoKeyframes: normalizeVideoKeyframeCurves({
		...clip.videoKeyframes, timeDomain: { authoredDuration: { num: 120, den: 1 }, viewStart: { num: 30, den: 1 }, viewDuration: { num: 60, den: 1 } },
	}, { duration: 60, composition: clip.videoComposition, videoEffects: [] }) };
	const faded = { ...trimmed, videoKeyframes: createVideoFadeKeyframes(trimmed, 'in', 15) };
	assert.equal(opacityAt(faded, 0), 0);
	assert.equal(opacityAt(faded, 7.5), 0.5);
	assert.deepEqual(readVideoFadeEnvelope(faded), { fadeInFrames: 15, fadeOutFrames: 0, peak: 1 });
	const both = { ...faded, videoKeyframes: createVideoFadeKeyframes(faded, 'out', 10) };
	assert.equal(opacityAt(both, 60), 0);
	assert.equal(readVideoFadeEnvelope(both)?.fadeOutFrames, 10);
});

test('removing a visible fade retains authored opacity outside the trimmed view', () => {
	const original = { ...clip, videoKeyframes: createVideoFadeKeyframes(clip, 'in', 20) };
	const trimmed = { ...original, sequenceFrameCount: 60, videoKeyframes: normalizeVideoKeyframeCurves({
		...original.videoKeyframes,
		timeDomain: { authoredDuration: { num: 120, den: 1 }, viewStart: { num: 20, den: 1 }, viewDuration: { num: 60, den: 1 } },
		curves: original.videoKeyframes.curves.map(entry => ({ ...entry, curve: {
			anchors: [...entry.curve.anchors.slice(0, -1), { position: { num: 80, den: 1 }, value: 1 }, entry.curve.anchors.at(-1)!],
			segments: [{ kind: 'linear' }, { kind: 'linear' }, { kind: 'linear' }],
		} })),
	}, { duration: 60, composition: clip.videoComposition, videoEffects: [] }) };
	const faded = { ...trimmed, videoKeyframes: createVideoFadeKeyframes(trimmed, 'out', 10) };
	const cleared = createVideoFadeKeyframes(faded, 'out', 0);
	assert.deepEqual(cleared.curves[0]?.curve.anchors[0], { position: { num: 0, den: 1 }, value: 0 });
	assert.equal(opacityAt({ ...trimmed, videoKeyframes: cleared }, 60), 1);
});

test('splitting an existing fade keeps both visible envelopes editable without boundary anchors', () => {
	const original = { ...clip, videoKeyframes: createVideoFadeKeyframes(clip, 'in', 20) };
	const split = splitVideoKeyframeCurvesAt(original.videoKeyframes, {
		duration: 120, composition: original.videoComposition, videoEffects: [],
	}, 60);
	const left = { ...original, sequenceFrameCount: 60, videoKeyframes: split.left };
	const right = { ...original, sequenceFrameCount: 60, videoKeyframes: split.right };
	assert.deepEqual(readVideoFadeEnvelope(left), { fadeInFrames: 20, fadeOutFrames: 0, peak: 1 });
	assert.deepEqual(readVideoFadeEnvelope(right), { fadeInFrames: 0, fadeOutFrames: 0, peak: 1 });
	const faded = { ...right, videoKeyframes: createVideoFadeKeyframes(right, 'in', 15) };
	assert.equal(opacityAt(faded, 0), 0);
	assert.equal(opacityAt(faded, 7.5), 0.5);
	assert.equal(opacityAt(faded, 15), 1);
	assert.deepEqual(faded.videoKeyframes.curves[0]?.curve.anchors.slice(0, 2),
		original.videoKeyframes.curves[0]?.curve.anchors.slice(0, 2));
});

test('persisted snapshot fades remain readable and editable after compiled curve identity is lost', () => {
	const snapshot = structuredClone({ ...clip, videoKeyframes: createVideoFadeKeyframes(clip, 'in', 20) });
	assert.deepEqual(readVideoFadeEnvelope(snapshot), { fadeInFrames: 20, fadeOutFrames: 0, peak: 1 });
	assert.deepEqual(readVideoFadeEnvelope({ ...snapshot, videoKeyframes: createVideoFadeKeyframes(snapshot, 'out', 10) }),
		{ fadeInFrames: 20, fadeOutFrames: 10, peak: 1 });
});

test('trimming through a partial fade keeps the authored opacity protected', () => {
	const original = { ...clip, videoKeyframes: createVideoFadeKeyframes(clip, 'in', 20) };
	const trimmed = { ...original, sequenceFrameCount: 60, videoKeyframes: trimVideoKeyframeCurvesToRange(original.videoKeyframes, {
		duration: 120, composition: original.videoComposition, videoEffects: [],
	}, { start: 10, end: 70 }) };
	assert.equal(opacityAt(trimmed, 0), 0.5);
	assert.equal(readVideoFadeEnvelope(trimmed), null);
	assert.throws(() => createVideoFadeKeyframes(trimmed, 'out', 10), /custom opacity curve/u);
});

function opacityAt(value: typeof clip, position: number): number {
	const values = evaluateVideoKeyframeCurves(value.videoKeyframes, position);
	return values.find(({ target }) => target.kind === 'composition' && target.parameterId === 'opacity')?.value ?? value.videoComposition.opacity;
}
