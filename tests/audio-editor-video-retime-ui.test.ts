/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoRetimeApplicationMenuItems } from '../src/common/editor/ui/video-retime-application-menu.ts';
import { createVideoRetimeDialogModel } from '../src/common/editor/ui/video-retime-dialog-model.ts';

function project(schemaVersion: 20 | 27 = 20) {
	return {
		schemaVersion,
		clips: [{
			id: 'video-1', kind: 'video', name: 'Picture', sourceId: 'source-1',
			sequenceStartFrame: 12, sequenceFrameCount: 10, sourceInFrame: 3,
			sourceFrameCount: 10, retimeMap: null as unknown, videoKeyframes: [],
		}],
		tracks: [{ id: 'track-1', type: 'video', locked: false, clipIds: ['video-1'] }],
		selection: { clipIds: ['video-1'] },
	};
}

test('video-retime menu is a maintained V20/V27 Framescaper capability-gated lazy entry', () => {
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
		...input, project: project(27),
	})[0]?.disabled, false);
	assert.deepEqual(createVideoRetimeApplicationMenuItems({ ...input, productId: 'soundscaper' }), []);
	assert.deepEqual(createVideoRetimeApplicationMenuItems({ ...input, capability: false }), []);
	assert.deepEqual(createVideoRetimeApplicationMenuItems({
		...input, project: { ...project(), schemaVersion: 19 },
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
		project: project(27), selectedClipId: 'video-1', editingBlocked: false,
	});
	assert.equal(selected.blockReason, null);
	assert.equal(selected.clipId, 'video-1');
});
