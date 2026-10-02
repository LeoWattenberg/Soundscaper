/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	clipPropertiesSelection,
	reconcileClipPropertiesTarget,
} from '../src/common/editor/ui/inspector/clip-properties-selection.ts';

const project = {
	id: 'project-a',
	clips: [
		{ id: 'one', sourceId: 'source-one', title: 'First clip' },
		{ id: 'two', sourceId: 'source-two' },
		{ id: 'three', sourceId: 'missing-source' },
	],
	sources: [{ id: 'source-one', name: 'First source' }, { id: 'source-two', name: 'Second source' }],
	selection: { clipIds: ['one', 'two'] },
};

test('clip property tabs follow valid selection order, deduplicate ids and label untitled clips', () => {
	const selection = clipPropertiesSelection({ project,
		selectedClipIds: ['two', 'missing', 'one', 'two', 'three'], selectedClipId: 'one' }, 'Clip');
	assert.deepEqual(selection.clips, [
		{ id: 'two', label: 'Second source' }, { id: 'one', label: 'First clip' }, { id: 'three', label: 'Clip' },
	]);
	assert.equal(selection.preferredClipId, 'one');
});

test('the inspector reads persisted multi-selection and supports legacy focused selection', () => {
	assert.deepEqual(clipPropertiesSelection({ project, selectedClipId: 'two' }, 'Clip').clips.map(({ id }) => id), ['one', 'two']);
	assert.deepEqual(clipPropertiesSelection({ project: { ...project, selection: { clipIds: [] } }, selectedClipId: 'three' }, 'Clip').clips,
		[{ id: 'three', label: 'Clip' }]);
	assert.deepEqual(clipPropertiesSelection({ project: null, selectedClipId: 'one' }, 'Clip').clips, []);
});

test('an explicit empty multi-selection clears a stale focused clip', () => {
	assert.deepEqual(clipPropertiesSelection({ project, selectedClipIds: [], selectedClipId: 'one' }, 'Clip').clips, []);
});

test('active clip stays stable as selection order changes and falls back safely after removal', () => {
	const selection = clipPropertiesSelection({ project, selectedClipId: 'one' }, 'Clip');
	assert.deepEqual(reconcileClipPropertiesTarget({ projectId: project.id, clipId: 'two' }, selection),
		{ projectId: project.id, clipId: 'two' });
	const removed = clipPropertiesSelection({ project: { ...project, clips: project.clips.filter(({ id }) => id !== 'two') }, selectedClipId: 'two' }, 'Clip');
	assert.deepEqual(reconcileClipPropertiesTarget({ projectId: project.id, clipId: 'two' }, removed),
		{ projectId: project.id, clipId: 'one' });
});

test('deselection and project changes reset the local target, even when clip ids repeat', () => {
	const selected = clipPropertiesSelection({ project: { ...project, id: 'project-b' }, selectedClipId: 'one' }, 'Clip');
	assert.deepEqual(reconcileClipPropertiesTarget({ projectId: project.id, clipId: 'two' }, selected),
		{ projectId: 'project-b', clipId: 'one' });
	const empty = clipPropertiesSelection({ project, selectedClipIds: [] }, 'Clip');
	assert.deepEqual(reconcileClipPropertiesTarget({ projectId: project.id, clipId: 'two' }, empty),
		{ projectId: project.id, clipId: null });
});
