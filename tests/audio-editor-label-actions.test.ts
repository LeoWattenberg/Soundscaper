/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudacityLabelActionRuntime } from '../src/common/editor/audacity-label-action-runtime.ts';
import { resolveAudioEditorShortcutHandler } from '../src/common/editor/ui/workspace-shortcuts.ts';

test('adding a label requests immediate inline editing of the label that was created', () => {
	const fixture = labelActionsFixture();
	assert.equal(fixture.actions.add(), 'new-label');
	assert.deepEqual(fixture.requests, [['edit-label', { trackId: 'labels', labelId: 'new-label' }]]);
});

test('F2 renames the focused or selected label and preserves clip renaming when no label is targeted', () => {
	const fixture = labelActionsFixture();
	fixture.focus({ trackId: 'labels', labelId: 'existing-label' });
	fixture.actions.renameItem();
	assert.deepEqual(fixture.requests, [['edit-label', { trackId: 'labels', labelId: 'existing-label' }]]);
	fixture.actions.renameItem('Revised annotation');
	assert.deepEqual(fixture.updates, [['labels', 'existing-label', { title: 'Revised annotation' }]]);
	fixture.focus(null);
	fixture.actions.renameItem('Clip title');
	assert.deepEqual(fixture.clipRenames, ['Clip title']);
});

test('adding a blocked label and renaming a removed label do not request nonexistent inputs', () => {
	const fixture = labelActionsFixture();
	fixture.block();
	assert.equal(fixture.actions.add(), null);
	assert.deepEqual(fixture.requests, []);
	fixture.focus({ trackId: 'labels', labelId: 'missing-label' });
	fixture.actions.renameItem();
	assert.deepEqual(fixture.clipRenames, [null]);
});

test('F2 has no effect when neither a label nor a clip is selected', () => {
	const fixture = labelActionsFixture();
	fixture.clearClip();
	assert.equal(fixture.actions.renameItem(), null);
	assert.deepEqual(fixture.requests, []);
	assert.deepEqual(fixture.clipRenames, []);
});

test('F2 dispatches contextual label or clip renaming while pitch keeps its selected-clip scope', () => {
	const fixture = labelActionsFixture();
	fixture.clearClip();
	fixture.focus({ trackId: 'labels', labelId: 'existing-label' });
	let selected = false;
	let readOnly = false;
	const pitchSpeed = () => 'pitch-speed';
	const runtime = {
		getActionContext: () => ({ focusedLabel: selected ? null : { trackId: 'labels', labelId: 'existing-label' }, snapshot: {
			project: {
				tracks: [{ id: 'labels', type: 'label', labels: [{ id: 'existing-label' }] }, { id: 'audio', type: 'audio', clipIds: selected ? ['clip'] : [] }],
				clips: selected ? [{ id: 'clip' }] : [],
				selection: { startFrame: 0, endFrame: 0, trackIds: ['labels'], clipIds: selected ? ['clip'] : [] },
			},
			selectedTrackId: selected ? 'audio' : 'labels', selectedClipId: selected ? 'clip' : null, readOnly,
		} }),
		clip: { rename: fixture.actions.renameItem, openPitchSpeed: pitchSpeed },
	};
	const renameLabel = resolveAudioEditorShortcutHandler('rename-item', { actionRuntime: runtime });
	assert.equal(renameLabel, fixture.actions.renameItem);
	renameLabel?.();
	assert.deepEqual(fixture.requests, [['edit-label', { trackId: 'labels', labelId: 'existing-label' }]]);
	assert.equal(resolveAudioEditorShortcutHandler('clip-pitch-speed', { actionRuntime: runtime }), null);
	selected = true;
	fixture.selectClip();
	fixture.focus(null);
	resolveAudioEditorShortcutHandler('rename-item', { actionRuntime: runtime })?.();
	assert.deepEqual(fixture.clipRenames, [null]);
	assert.equal(resolveAudioEditorShortcutHandler('clip-pitch-speed', { actionRuntime: runtime }), pitchSpeed);
	readOnly = true;
	assert.equal(resolveAudioEditorShortcutHandler('rename-item', { actionRuntime: runtime }), null);
});

function labelActionsFixture() {
	let target: Readonly<{ trackId: string; labelId: string }> | null = null;
	let blocked = false;
	let clipSelected = true;
	const project = { tracks: [{ id: 'labels', type: 'label', labels: [{ id: 'existing-label' }] }] };
	const requests: [string, unknown][] = [];
	const updates: [string, string, unknown][] = [];
	const clipRenames: unknown[] = [];
	const actions = createAudacityLabelActionRuntime({
		getProject: () => project,
		getFocusedLabel: () => target,
		hasSelectedClip: () => clipSelected,
		addLabel: () => {
			if (blocked) return null;
			project.tracks[0].labels.push({ id: 'new-label' });
			return 'new-label';
		},
		updateLabel: (trackId, labelId, changes) => updates.push([trackId, labelId, changes]),
		issue: (type, payload) => requests.push([type, payload]),
		renameClip: (title) => clipRenames.push(title),
	});
	return { actions, requests, updates, clipRenames, focus: (value: typeof target) => { target = value; }, block: () => { blocked = true; }, clearClip: () => { clipSelected = false; }, selectClip: () => { clipSelected = true; } };
}
