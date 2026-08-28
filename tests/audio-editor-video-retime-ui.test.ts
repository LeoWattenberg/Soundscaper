/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import VideoRetimeDialog from '../src/common/editor/ui/dialogs/VideoRetimeDialog.tsx';
import {
	formatVideoRetimeExactMapInput,
	parseVideoRetimeExactMapInput,
} from '../src/common/editor/ui/video-retime-exact-map-input.ts';
import { createVideoRetimeApplicationMenuItems } from '../src/common/editor/ui/video-retime-application-menu.ts';
import { createVideoRetimeDialogModel } from '../src/common/editor/ui/video-retime-dialog-model.ts';

function project() {
	return {
		schemaFamily: 'framescaper', schemaVersion: 1,
		clips: [{
			id: 'video-1', kind: 'video', name: 'Picture', sourceId: 'source-1',
			sequenceStartFrame: 12, sequenceFrameCount: 10, sourceInFrame: 3,
			sourceFrameCount: 10, retimeMap: null as unknown, videoKeyframes: [],
		}],
		tracks: [{ id: 'track-1', type: 'video', locked: false, clipIds: ['video-1'] }],
		selection: { clipIds: ['video-1'] },
	};
}

test('video-retime menu is a maintained Framescaper-v1 capability-gated lazy entry', () => {
	let opened = 0;
	const input = {
		productId: 'framescaper', capability: true, project: project(), selectedClipId: 'video-1',
		editingBlocked: false, copy: {}, open: () => { opened += 1; },
	};
	const [item] = createVideoRetimeApplicationMenuItems(input);
	assert.deepEqual({ id: item?.id, label: item?.label, disabled: item?.disabled }, {
		id: 'video-retime-editor', label: 'Video retime…', disabled: false,
	});
	item?.onClick();
	assert.equal(opened, 1);
	assert.equal(createVideoRetimeApplicationMenuItems({
		...input, project: project(),
	})[0]?.disabled, false);
	assert.deepEqual(createVideoRetimeApplicationMenuItems({ ...input, productId: 'soundscaper' }), []);
	assert.deepEqual(createVideoRetimeApplicationMenuItems({ ...input, capability: false }), []);
	assert.deepEqual(createVideoRetimeApplicationMenuItems({
		...input, project: { ...project(), schemaVersion: 2 },
	}), []);
});

test('video-retime menu disables locked, blocked, and ambiguous selections', () => {
	const base = {
		productId: 'framescaper', capability: true, selectedClipId: 'video-1',
		editingBlocked: false, copy: {}, open: () => undefined,
	};
	const locked = project();
	locked.tracks[0]!.locked = true;
	assert.equal(createVideoRetimeApplicationMenuItems({ ...base, project: locked })[0]?.disabled, true);
	assert.equal(createVideoRetimeApplicationMenuItems({ ...base, project: project(), editingBlocked: true })[0]?.disabled, true);
	const ambiguous = project();
	ambiguous.clips.push({ ...ambiguous.clips[0]!, id: 'video-2' });
	ambiguous.tracks[0]!.clipIds.push('video-2');
	ambiguous.selection.clipIds.push('video-2');
	assert.equal(createVideoRetimeApplicationMenuItems({ ...base, project: ambiguous })[0]?.disabled, true);
});

test('video-retime dialog model snapshots exact selected clip command authority', () => {
	const value = project();
	const model = createVideoRetimeDialogModel({
		productId: 'framescaper', capability: true,
		project: value, selectedClipId: 'video-1', editingBlocked: false,
	});
	assert.equal(model.blockReason, null);
	assert.equal(model.clipId, 'video-1');
	assert.equal(model.clipName, 'Picture');
	assert.equal(model.hasRetimeMap, false);
	assert.deepEqual(model.commandAuthority, { clipId: 'video-1', expectedRetimeMap: null });
	assert.deepEqual(model.bounds, { outerFrameCount: 10, sourceFirstFrame: 3, sourceLastFrame: 13 });
	assert.equal(Object.isFrozen(model.commandAuthority), true);

	value.clips[0]!.retimeMap = {
		feature: 'video-retime', version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 13, den: 1 } },
			{ outerFrame: 10, sourceFrame: { num: 3, den: 1 } },
		],
		segments: [{ mode: 'constant-reverse' }],
	};
	const mapped = createVideoRetimeDialogModel({
		productId: 'framescaper', capability: true,
		project: value, selectedClipId: 'video-1', editingBlocked: false,
	});
	assert.equal(mapped.hasRetimeMap, true);
	assert.ok(mapped.commandAuthority);
	assert.notEqual(mapped.commandAuthority.expectedRetimeMap, value.clips[0]!.retimeMap);
	assert.deepEqual(mapped.commandAuthority.expectedRetimeMap, value.clips[0]!.retimeMap);

	const selected = createVideoRetimeDialogModel({
		productId: 'framescaper', capability: true,
		project: project(), selectedClipId: 'video-1', editingBlocked: false,
	});
	assert.equal(selected.blockReason, null);
	assert.equal(selected.clipId, 'video-1');
});

test('video-retime exact-map input accepts only a clip-bound canonical V2 map', () => {
	const bounds = { outerFrameCount: 10, sourceFirstFrame: 3, sourceLastFrame: 13 };
	const value = {
		feature: 'video-retime', version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 3, den: 1 } },
			{ outerFrame: 5, sourceFrame: { num: 8, den: 1 } },
			{ outerFrame: 10, sourceFrame: { num: 8, den: 1 } },
		],
		segments: [{ mode: 'constant-forward' }, { mode: 'freeze' }],
	};
	const parsed = parseVideoRetimeExactMapInput(JSON.stringify(value), bounds);
	assert.deepEqual(parsed, value);
	assert.equal(Object.isFrozen(parsed), true);
	assert.equal(Object.isFrozen(parsed.points), true);
	assert.equal(Object.isFrozen(parsed.points[0]), true);
	assert.equal(Object.isFrozen(parsed.segments), true);

	assert.throws(() => parseVideoRetimeExactMapInput(JSON.stringify({ ...value, version: 1 }), bounds),
		/version must be 2/iu);
	assert.throws(() => parseVideoRetimeExactMapInput(JSON.stringify({ ...value, hidden: true }), bounds),
		/unsupported field/iu);
	assert.throws(() => parseVideoRetimeExactMapInput(JSON.stringify({
		...value,
		points: [value.points[0], { outerFrame: 9, sourceFrame: { num: 8, den: 1 } }],
		segments: [{ mode: 'constant-forward' }],
	}), bounds), /last curve outer frame/iu);
	assert.throws(() => parseVideoRetimeExactMapInput('', bounds), /JSON object/iu);
});

test('video-retime exact-map authoring is menu-dialog reached and submits through retimeSet', () => {
	const value = project();
	const expectedDefault = {
		feature: 'video-retime', version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 3, den: 1 } },
			{ outerFrame: 10, sourceFrame: { num: 13, den: 1 } },
		],
		segments: [{ mode: 'constant-forward' }],
	};
	assert.deepEqual(JSON.parse(formatVideoRetimeExactMapInput(null, {
		outerFrameCount: 10, sourceFirstFrame: 3, sourceLastFrame: 13,
	})), expectedDefault);

	const markup = renderToStaticMarkup(React.createElement(VideoRetimeDialog, {
		productId: 'framescaper', capability: true, editingBlocked: false,
		controller: { actions: { sequences: {
			retimeConstant: () => undefined, retimeReset: () => undefined,
			retimeReverse: () => undefined, retimeFreeze: () => undefined,
			retimeRamp: () => undefined, retimeSet: () => undefined,
		} } },
		snapshot: { project: value, selectedClipId: 'video-1' }, copy: {},
		run: (operation: () => unknown) => operation(), onClose: () => undefined,
	}));
	assert.match(markup, /data-video-retime-exact-map="true"/u);
	assert.match(markup, /data-video-retime-set="true"/u);
	assert.match(markup, /Exact retime map/iu);
});
