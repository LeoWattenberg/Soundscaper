/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createDefaultVideoKeyframeCurves } from '../src/common/editor/video-keyframe-curves.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createVideoKeyframeDialogModel } from '../src/common/editor/ui/video-keyframe-dialog-model.ts';
import {
	applyVideoKeyframeCurveTransfer,
	createVideoKeyframeCurveTransfer,
	parseVideoKeyframeCurveTransfer,
	serializeVideoKeyframeCurveTransfer,
} from '../src/common/editor/ui/video-keyframe-curve-transfer.ts';

const rational = (num: number, den = 1) => ({ num, den });

test('curve transfer is a detached bounded UI wire with explicit clipboard and preset roles', () => {
	const model = keyframeModel();
	const clipboard = createVideoKeyframeCurveTransfer(model, {
		role: 'clipboard',
		target: { kind: 'composition', parameterId: 'opacity' },
	});
	assert.deepEqual(clipboard, {
		schemaVersion: 1,
		role: 'clipboard',
		curve: {
			anchors: [
				{ position: rational(0), value: 0.25 },
				{ position: rational(20), value: 0.75 },
			],
			segments: [{ kind: 'linear' }],
		},
	});
	assert.equal(Object.isFrozen(clipboard), true);
	assert.equal(Object.isFrozen(clipboard.curve.anchors), true);

	const encoded = serializeVideoKeyframeCurveTransfer(clipboard);
	const parsed = parseVideoKeyframeCurveTransfer(encoded, 'clipboard');
	assert.deepEqual(parsed, clipboard);
	assert.notStrictEqual(parsed, clipboard);
	const preset = parseVideoKeyframeCurveTransfer({ ...clipboard, role: 'preset' }, 'preset');
	assert.equal(preset.role, 'preset');
	assert.throws(() => parseVideoKeyframeCurveTransfer(clipboard, 'preset'), /role/iu);
});

test('transfer application chooses the destination target and preserves exact authored positions', () => {
	const source = createVideoKeyframeCurveTransfer(keyframeModel(), {
		role: 'preset', target: { kind: 'composition', parameterId: 'opacity' },
	});
	const empty = keyframeModel(false);
	const applied = applyVideoKeyframeCurveTransfer(empty, source, {
		kind: 'composition', parameterId: 'transform.positionX',
	});
	assert.deepEqual(applied.curves[0]?.target, {
		kind: 'composition', parameterId: 'transform.positionX',
	});
	assert.deepEqual(applied.curves[0]?.curve.anchors, source.curve.anchors);
	assert.throws(() => applyVideoKeyframeCurveTransfer(empty, source, {
		kind: 'video-effect', effectId: 'pixels', parameterId: 'blockSize',
	}), /range|outside|integer/iu, 'target ranges are destination-owned');

	const overwrite = applyVideoKeyframeCurveTransfer(keyframeModel(), {
		...source,
		curve: {
			anchors: [
				{ position: rational(0), value: 0.1 },
				{ position: rational(20), value: 0.9 },
			],
			segments: [{ kind: 'eased' }],
		},
	}, { kind: 'composition', parameterId: 'opacity' });
	assert.deepEqual(overwrite.curves[0]?.curve.segments, [{ kind: 'eased' }]);
});

test('transfer parsing rejects oversized, open, accessor-backed, cyclic, binary, and negative-zero input', () => {
	assert.throws(() => parseVideoKeyframeCurveTransfer('x'.repeat(262_145)), /byte|size|limit/iu);
	assert.throws(() => parseVideoKeyframeCurveTransfer('{'), /JSON/iu);
	const base = createVideoKeyframeCurveTransfer(keyframeModel(), {
		role: 'clipboard', target: { kind: 'composition', parameterId: 'opacity' },
	});
	assert.throws(() => parseVideoKeyframeCurveTransfer({ ...base, future: true }), /unsupported field/iu);
	let reads = 0;
	const accessor = { ...base } as unknown as Record<string, unknown>;
	Object.defineProperty(accessor, 'curve', {
		enumerable: true,
		get() { reads += 1; return base.curve; },
	});
	assert.throws(() => parseVideoKeyframeCurveTransfer(accessor), /data property/iu);
	assert.equal(reads, 0);
	const cyclic = structuredClone(base) as unknown as Record<string, unknown>;
	(cyclic.curve as Record<string, unknown>).cycle = cyclic;
	assert.throws(() => parseVideoKeyframeCurveTransfer(cyclic), /cycle|cyclic|unsupported field/iu);
	const binary = structuredClone(base) as unknown as Record<string, unknown>;
	(binary.curve as Record<string, unknown>).anchors = new Uint8Array([1, 2]);
	assert.throws(() => parseVideoKeyframeCurveTransfer(binary), /array|binary/iu);
	const negativeZero = structuredClone(base) as unknown as Record<string, unknown>;
	(((negativeZero.curve as Record<string, unknown>).anchors as Array<Record<string, unknown>>)[0]!).value = -0;
	assert.throws(() => parseVideoKeyframeCurveTransfer(negativeZero), /negative zero/iu);

	const tooMany = structuredClone(base) as unknown as Record<string, unknown>;
	const anchors = Array.from({ length: 4_097 }, (_, index) => ({ position: rational(index), value: 0.5 }));
	(tooMany.curve as Record<string, unknown>).anchors = anchors;
	(tooMany.curve as Record<string, unknown>).segments = anchors.slice(1).map(() => ({ kind: 'linear' }));
	assert.throws(() => parseVideoKeyframeCurveTransfer(tooMany), /4096|entries|anchor/iu);
});

function keyframeModel(withCurve = true) {
	const keyframes = createDefaultVideoKeyframeCurves(rational(20));
	const project = {
		schemaFamily: 'framescaper',
		schemaVersion: 1,
		clips: [{
			id: 'video', kind: 'video', title: 'Picture',
			sequenceStartFrame: 0, sequenceFrameCount: 20,
			videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
			videoEffects: [createVideoEffect('pixelate', { id: 'pixels' })],
			videoKeyframes: withCurve ? {
				...keyframes,
				curves: [{
					target: { kind: 'composition', parameterId: 'opacity' },
					curve: {
						anchors: [
							{ position: rational(0), value: 0.25 },
							{ position: rational(20), value: 0.75 },
						],
						segments: [{ kind: 'linear' }],
					},
				}],
			} : keyframes,
		}],
		tracks: [{ id: 'track', type: 'video', locked: false, clipIds: ['video'] }],
		selection: { clipIds: ['video'] },
	};
	return createVideoKeyframeDialogModel({
		productId: 'framescaper', capability: true, project,
		snapshot: { selectedClipId: 'video' },
	});
}
