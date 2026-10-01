/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { clipHeaderActions } from '../src/common/editor/ui/timeline/clip-header-actions.ts';

function fixture(blocked = false) {
	const calls: unknown[] = [];
	const actions = clipHeaderActions({
		blocked,
		copy: { clipPitchIndicator: 'Clip-Tonhöhe', clipSpeedIndicator: 'Clip-Geschwindigkeit' },
		controller: { actions: {
			timeline: { selectClip: (id: string) => { calls.push(['select', id]); } },
			clip: { setTimePitch: (id: string, changes: unknown) => { calls.push(['update', id, changes]); } },
		} },
		run: (action: () => unknown) => { action(); },
		onOpenClipProperties: (id, field) => { calls.push(['properties', id, field]); },
	});
	return { calls, actions };
}

test('clip badges select their own clip before opening the matching properties control', () => {
	const { calls, actions } = fixture();
	assert.equal(actions.clipPitchLabel, 'Clip-Tonhöhe');
	assert.equal(actions.clipSpeedLabel, 'Clip-Geschwindigkeit');
	actions.onClipPitchClick(7);
	actions.onClipSpeedClick('other-clip');
	assert.deepEqual(calls, [
		['select', '7'], ['properties', '7', 'pitch'],
		['select', 'other-clip'], ['properties', 'other-clip', 'speed'],
	]);
});

test('double-clicking each badge resets only its own transform through undoable clip actions', () => {
	const { calls, actions } = fixture();
	actions.onClipPitchReset?.('clip');
	actions.onClipSpeedReset?.('clip');
	assert.deepEqual(calls, [
		['update', 'clip', { pitchCents: 0 }],
		['update', 'clip', { speedRatio: 1 }],
	]);
});

test('blocked editing keeps properties readable and removes badge reset actions', () => {
	const { calls, actions } = fixture(true);
	assert.equal(actions.onClipPitchReset, undefined);
	assert.equal(actions.onClipSpeedReset, undefined);
	actions.onClipSpeedClick('clip');
	assert.deepEqual(calls, [['select', 'clip'], ['properties', 'clip', 'speed']]);
});
