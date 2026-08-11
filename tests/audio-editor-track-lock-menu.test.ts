/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createTrackLockMenuItems,
	createTrackLockMenuModel,
} from '../src/common/editor/ui/track-lock-menu-model.ts';

const COPY = Object.freeze({ lockTrack: 'Lock track', unlockTrack: 'Unlock track' });

test('audio, video, and label selections expose one exact frozen lock operation', () => {
	for (const type of ['audio', 'video', 'label'] as const) {
		const model = createTrackLockMenuModel({
			project: project([{ id: `${type}-track`, type, locked: false }]),
			selectedTrackId: `${type}-track`, editingBlocked: false, copy: COPY,
		});
		assert.deepEqual(model.toggle, {
			id: 'track-lock-toggle', label: 'Lock track', disabled: false,
			operation: { trackId: `${type}-track`, locked: true },
		});
		assert.equal(Object.isFrozen(model), true);
		assert.equal(Object.isFrozen(model.toggle), true);
		assert.equal(Object.isFrozen(model.toggle.operation), true);
	}
});

test('a locked selected track exposes only the inverse Unlock operation', () => {
	const model = createTrackLockMenuModel({
		project: project([{ id: 'locked-track', type: 'video', locked: true }]),
		selectedTrackId: 'locked-track', editingBlocked: false, copy: COPY,
	});
	assert.deepEqual(model.toggle, {
		id: 'track-lock-toggle', label: 'Unlock track', disabled: false,
		operation: { trackId: 'locked-track', locked: false },
	});
});

test('missing, malformed, and unsupported selections fail closed without guessing a toggle', () => {
	for (const input of [
		{ project: project([]), selectedTrackId: null },
		{ project: project([{ id: 'folder', type: 'folder', locked: false }]), selectedTrackId: 'folder' },
		{ project: project([{ id: 'audio', type: 'audio' }]), selectedTrackId: 'audio' },
		{ project: project([{ id: 'audio', type: 'audio', locked: 'false' }]), selectedTrackId: 'audio' },
		{ project: null, selectedTrackId: 'audio' },
	] as const) {
		const model = createTrackLockMenuModel({
			...input, editingBlocked: false, copy: COPY,
		});
		assert.deepEqual(model.toggle, {
			id: 'track-lock-toggle', label: 'Lock track', disabled: true, operation: null,
		});
	}
});

test('editing block preserves the current label but disables dispatch', () => {
	const model = createTrackLockMenuModel({
		project: project([{ id: 'locked-track', type: 'label', locked: true }]),
		selectedTrackId: 'locked-track', editingBlocked: true, copy: COPY,
	});
	assert.equal(model.toggle.label, 'Unlock track');
	assert.equal(model.toggle.disabled, true);
	assert.deepEqual(model.toggle.operation, { trackId: 'locked-track', locked: false });

	const calls: unknown[] = [];
	const item = createTrackLockMenuItems(model, {
		setTrackLocked: (trackId, locked) => calls.push({ trackId, locked }),
	}).toggle;
	assert.equal(item.onClick(), undefined);
	assert.deepEqual(calls, []);
});

test('application item dispatches the stored exact ID and boolean only', () => {
	const model = createTrackLockMenuModel({
		project: project([{ id: 'audio-track', type: 'audio', locked: false }]),
		selectedTrackId: 'audio-track', editingBlocked: false, copy: COPY,
	});
	const calls: unknown[] = [];
	const items = createTrackLockMenuItems(model, {
		setTrackLocked: (trackId, locked) => calls.push({ trackId, locked }),
	});
	assert.equal(Object.isFrozen(items), true);
	assert.equal(Object.isFrozen(items.toggle), true);
	items.toggle.onClick();
	assert.deepEqual(calls, [{ trackId: 'audio-track', locked: true }]);
});

function project(tracks: readonly Readonly<Record<string, unknown>>[]) {
	return { id: 'project', tracks };
}
