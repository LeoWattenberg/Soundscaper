/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoEffect } from '../src/common/editor/video-effects.js';
import {
	addVideoKeyframeAnchor,
	createVideoKeyframeCurve,
	createVideoKeyframeDialogModel,
	createVideoKeyframeSetCommand,
	listVideoKeyframeTargetChoices,
	removeVideoKeyframeAnchor,
	removeVideoKeyframeCurve,
	setVideoKeyframeSegment,
	updateVideoKeyframeAnchor,
	visiblePositionForVideoKeyframeAnchor,
} from '../src/common/editor/ui/video-keyframe-dialog-model.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createDefaultVideoKeyframeCurves } from '../src/common/editor/video-keyframe-curves.ts';
import { createVideoKeyframeApplicationMenuItems } from '../src/common/editor/ui/video-keyframe-application-menu.ts';

const rational = (num: number, den = 1) => ({ num, den });

test('the dialog model admits exactly one writable V20 timeline video and exposes registered targets', () => {
	const value = project();
	const model = createVideoKeyframeDialogModel({
		productId: 'framescaper', capability: true, project: value,
		snapshot: { selectedClipId: 'video' },
	});
	assert.equal(model.clipId, 'video');
	assert.equal(model.clipName, 'Picture');
	assert.equal(model.sequenceStartFrame, 100);
	assert.equal(model.sequenceFrameCount, 20);
	assert.equal(model.operationsBlocked, false);
	assert.equal(model.blockReason, null);
	assert.deepEqual(model.keyframes, createDefaultVideoKeyframeCurves(rational(20)));

	const choices = listVideoKeyframeTargetChoices(model);
	assert.equal(choices.length, 13);
	assert.deepEqual(choices[0], {
		key: '["composition","crop.left"]',
		target: { kind: 'composition', parameterId: 'crop.left' },
		labelKey: 'videoKeyframeTargetCropLeft', fallbackLabel: 'Crop left',
		minimum: 0, maximum: 1, step: 0.01, integer: false, baseValue: 0,
	});
	const blocks = choices.find(({ key }) => key === '["video-effect","pixels","blockSize"]');
	assert.deepEqual(blocks, {
		key: '["video-effect","pixels","blockSize"]',
		target: { kind: 'video-effect', effectId: 'pixels', parameterId: 'blockSize' },
		labelKey: 'videoEffectParamBlockSize', fallbackLabel: 'Pixelate — Block size',
		minimum: 2, maximum: 128, step: 1, integer: true, baseValue: 16,
	});

	for (const [name, input, reason] of [
		['capability', { productId: 'framescaper', capability: false, project: value, snapshot: { selectedClipId: 'video' } }, 'unsupported'],
		['product', { productId: 'soundscaper', capability: true, project: value, snapshot: { selectedClipId: 'video' } }, 'unsupported'],
		['schema', { productId: 'framescaper', capability: true, project: { ...value, schemaVersion: 19 }, snapshot: { selectedClipId: 'video' } }, 'unsupported'],
		['selection', { productId: 'framescaper', capability: true, project: project({ selection: ['video', 'video-2'] }), snapshot: { selectedClipId: 'video' } }, 'no-video-clip'],
		['locked', { productId: 'framescaper', capability: true, project: project({ locked: true }), snapshot: { selectedClipId: 'video' } }, 'locked'],
		['read-only', { productId: 'framescaper', capability: true, project: value, snapshot: { selectedClipId: 'video', readOnly: true } }, 'read-only'],
	] as const) {
		const blocked = createVideoKeyframeDialogModel(input);
		assert.equal(blocked.operationsBlocked, true, name);
		assert.equal(blocked.blockReason, reason, name);
	}
});

test('curve creation and point edits map visible-local rationals into the stable authored domain', () => {
	const model = createVideoKeyframeDialogModel({
		productId: 'framescaper', capability: true, project: project({
			timeDomain: { authoredDuration: rational(40), viewStart: rational(10), viewDuration: rational(20) },
		}), snapshot: { selectedClipId: 'video' },
	});
	const target = { kind: 'composition' as const, parameterId: 'opacity' as const };
	const created = createVideoKeyframeCurve(model, {
		target,
		start: { position: rational(1, 2), value: 0.2 },
		end: { position: rational(39, 2), value: 0.8 },
		segment: { kind: 'eased' },
	});
	assert.deepEqual(created.curves[0]?.curve, {
		anchors: [
			{ position: rational(21, 2), value: 0.2 },
			{ position: rational(59, 2), value: 0.8 },
		],
		segments: [{ kind: 'eased' }],
	});
	assert.deepEqual(visiblePositionForVideoKeyframeAnchor(model, rational(21, 2)), rational(1, 2));
	assert.equal(visiblePositionForVideoKeyframeAnchor(model, rational(5)), null);

	const inserted = addVideoKeyframeAnchor({ ...model, keyframes: created }, {
		target, position: rational(10), value: 0.5,
		incomingSegment: { kind: 'linear' }, outgoingSegment: { kind: 'hold' },
	});
	assert.deepEqual(inserted.curves[0]?.curve.anchors.map(({ position, value }) => ({ position, value })), [
		{ position: rational(21, 2), value: 0.2 },
		{ position: rational(20), value: 0.5 },
		{ position: rational(59, 2), value: 0.8 },
	]);
	assert.deepEqual(inserted.curves[0]?.curve.segments, [{ kind: 'linear' }, { kind: 'hold' }]);

	const updated = updateVideoKeyframeAnchor({ ...model, keyframes: inserted }, {
		target, anchorIndex: 1, position: rational(21, 2), value: 0.55,
	});
	assert.deepEqual(updated.curves[0]?.curve.anchors[1], {
		position: rational(41, 2), value: 0.55,
	});
	const bezier = setVideoKeyframeSegment({ ...model, keyframes: updated }, {
		target, segmentIndex: 0,
		segment: {
			kind: 'bezier',
			control1: { position: rational(1), value: 0.25 },
			control2: { position: rational(10), value: 0.45 },
		},
	});
	assert.deepEqual(bezier.curves[0]?.curve.segments[0], {
		kind: 'bezier',
		control1: { position: rational(11), value: 0.25 },
		control2: { position: rational(20), value: 0.45 },
	});

	const removed = removeVideoKeyframeAnchor({ ...model, keyframes: bezier }, {
		target, anchorIndex: 1, bridgeSegment: { kind: 'linear' },
	});
	assert.equal(removed.curves[0]?.curve.anchors.length, 2);
	assert.deepEqual(removed.curves[0]?.curve.segments, [{ kind: 'linear' }]);
	assert.deepEqual(removeVideoKeyframeCurve({ ...model, keyframes: removed }, target).curves, []);
});

test('integer targets are hold-only and every candidate is context-normalized before command creation', () => {
	const model = createVideoKeyframeDialogModel({
		productId: 'framescaper', capability: true, project: project(),
		snapshot: { selectedClipId: 'video' },
	});
	const target = { kind: 'video-effect' as const, effectId: 'pixels', parameterId: 'blockSize' };
	assert.throws(() => createVideoKeyframeCurve(model, {
		target,
		start: { position: rational(0), value: 8 },
		end: { position: rational(20), value: 32 },
		segment: { kind: 'linear' },
	}), /hold/iu);
	const next = createVideoKeyframeCurve(model, {
		target,
		start: { position: rational(0), value: 8 },
		end: { position: rational(20), value: 32 },
		segment: { kind: 'hold' },
	});
	const command = createVideoKeyframeSetCommand(model, next);
	assert.deepEqual(command, {
		type: 'video-keyframes/set', clipId: 'video',
		expectedKeyframes: model.keyframes, keyframes: next,
	});
	assert.equal(Object.isFrozen(command), true);
	assert.throws(() => createVideoKeyframeCurve(model, {
		target: { kind: 'composition', parameterId: 'opacity' },
		start: { position: rational(0), value: 0 },
		end: { position: rational(20), value: 2 }, segment: { kind: 'linear' },
	}), /range|outside/iu);
});

test('model selection and project reads reject accessor authority without invocation', () => {
	let reads = 0;
	const hostile = project();
	Object.defineProperty(hostile.clips[0], 'videoKeyframes', {
		enumerable: true,
		get() { reads += 1; return createDefaultVideoKeyframeCurves(rational(20)); },
	});
	const model = createVideoKeyframeDialogModel({
		productId: 'framescaper', capability: true, project: hostile,
		snapshot: { selectedClipId: 'video' },
	});
	assert.equal(model.blockReason, 'no-video-clip');
	assert.equal(reads, 0);
});

test('the keyframe entry is menu-only, exact-V20-only, and available under the shipped capability', () => {
	const opened: string[] = [];
	const input = {
		productId: 'framescaper', capability: true, project: project(),
		selectedClipId: 'video', editingBlocked: false, copy: { videoKeyframesMenu: 'Video keyframes…' },
		open: () => { opened.push('video-keyframes'); },
	};
	const [item] = createVideoKeyframeApplicationMenuItems(input);
	assert.deepEqual({ id: item?.id, label: item?.label, disabled: item?.disabled }, {
		id: 'video-keyframes-editor', label: 'Video keyframes…', disabled: false,
	});
	item?.onClick();
	assert.deepEqual(opened, ['video-keyframes']);
	assert.deepEqual(createVideoKeyframeApplicationMenuItems({ ...input, capability: false }), []);
	assert.deepEqual(createVideoKeyframeApplicationMenuItems({
		...input, project: { ...project(), schemaVersion: 19 },
	}), [], 'the active V19 route remains absent even if a caller forges the UI capability');
	assert.deepEqual(createVideoKeyframeApplicationMenuItems({ ...input, productId: 'soundscaper' }), []);
	assert.equal(createVideoKeyframeApplicationMenuItems({ ...input, editingBlocked: true })[0]?.disabled, true);
	let traversals = 0;
	const large = project();
	(large.clips[0] as unknown as Record<string, unknown>).videoKeyframes = new Proxy({}, {
		get() { traversals += 1; throw new Error('curve traversal'); },
		ownKeys() { traversals += 1; throw new Error('curve traversal'); },
	});
	assert.equal(createVideoKeyframeApplicationMenuItems({ ...input, project: large })[0]?.disabled, false);
	assert.equal(traversals, 0, 'menu rebuilds never normalize or traverse the curve carrier');
	const hostile = project();
	Object.defineProperty(hostile.tracks[0]!.clipIds, '0', {
		enumerable: true,
		get() { traversals += 1; return 'video'; },
	});
	assert.equal(createVideoKeyframeApplicationMenuItems({ ...input, project: hostile })[0]?.disabled, true);
	assert.equal(traversals, 0, 'menu admission never invokes accessor-backed arrays');
	const carrierAccessor = project();
	Object.defineProperty(carrierAccessor.clips[0], 'videoKeyframes', {
		enumerable: true,
		get() { traversals += 1; return {}; },
	});
	assert.equal(createVideoKeyframeApplicationMenuItems({ ...input, project: carrierAccessor })[0]?.disabled, true);
	assert.equal(traversals, 0, 'menu admission rejects but never invokes an accessor-backed carrier');
	const custom = project();
	Object.setPrototypeOf(custom.clips[0], { inherited: true });
	assert.equal(createVideoKeyframeApplicationMenuItems({ ...input, project: custom })[0]?.disabled, true);
	const overBudget = project();
	const reused = Array.from({ length: 70_000 }, () => 'unrelated');
	overBudget.tracks = [
		{ id: 'a', type: 'video', locked: false, clipIds: reused },
		{ id: 'b', type: 'video', locked: false, clipIds: reused },
		{ id: 'c', type: 'video', locked: false, clipIds: reused },
	];
	assert.equal(createVideoKeyframeApplicationMenuItems({ ...input, project: overBudget })[0]?.disabled, true,
		'reused large arrays are charged per traversal under one aggregate menu budget');
});

function project(options: Readonly<{
	locked?: boolean;
	selection?: readonly string[];
	timeDomain?: unknown;
}> = {}) {
	const keyframes = createDefaultVideoKeyframeCurves(rational(20));
	return {
		schemaVersion: 20,
		clips: [
			{
				id: 'video', kind: 'video', title: 'Picture',
				sequenceStartFrame: 100, sequenceFrameCount: 20,
				videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
				videoEffects: [createVideoEffect('pixelate', { id: 'pixels' })],
				videoKeyframes: options.timeDomain ? { ...keyframes, timeDomain: options.timeDomain } : keyframes,
			},
			{
				id: 'video-2', kind: 'video', title: 'Second', sequenceStartFrame: 0,
				sequenceFrameCount: 20, videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
				videoEffects: [], videoKeyframes: keyframes,
			},
			{ id: 'audio', kind: 'audio' },
		],
		tracks: [
			{ id: 'video-track', type: 'video', locked: options.locked === true, clipIds: ['video'] },
			{ id: 'video-track-2', type: 'video', locked: false, clipIds: ['video-2'] },
		],
		selection: { clipIds: options.selection ?? [] },
	};
}
