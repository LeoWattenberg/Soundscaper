/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEditingActionAvailability, type EditingAuthorityProject } from '../src/common/editor/commands/editing-selection-authority.ts';

for (const kind of ['image', 'still', 'generator']) test(`group availability excludes projected ${kind} leaves whose native model has no group metadata`, () => {
	const project = fixture(kind);
	const before = structuredClone(project);
	const availability = resolveEditingActionAvailability({ project, focusedClipId: 'last', focusedTrackId: 'pictures' });
	assert.deepEqual(availability.clipIds, ['first', 'last']);
	assert.equal(availability.editSelectionActive, true);
	assert.equal(availability.split, true, 'independent native split admission remains available');
	assert.equal(availability.group, false);
	assert.equal(availability.ungroup, false);
	assert.deepEqual(project, before);
});

test('mixed selection does not offer partial grouping and ordinary audio/video grouping remains available', () => {
	const native = fixture('image');
	const mixed = { ...native, clips: [native.clips[0]!, { ...native.clips[1]!, kind: 'audio' }] };
	assert.equal(resolveEditingActionAvailability({ project: mixed }).group, false);
	const legacy = { ...native, clips: [{ ...native.clips[0]!, kind: 'audio' }, { ...native.clips[1]!, kind: 'video' }] };
	assert.equal(resolveEditingActionAvailability({ project: legacy }).group, true);
	assert.equal(resolveEditingActionAvailability({ project: { ...legacy,
		clips: legacy.clips.map(clip => ({ ...clip, kind: undefined })) } }).group, true, 'legacy audio projections retain grouping');
	const grouped = { ...legacy, clips: legacy.clips.map(clip => ({ ...clip, groupId: 'group' })) };
	assert.equal(resolveEditingActionAvailability({ project: grouped }).ungroup, true);
	const timeSelection = { ...legacy, selection: { ...legacy.selection, startFrame: 100, endFrame: 200 } };
	assert.equal(resolveEditingActionAvailability({ project: timeSelection }).group, false);
});

function fixture(kind: string): EditingAuthorityProject {
	return { tracks: [{ id: 'pictures', type: 'video', clipIds: ['first', 'last'] }],
		clips: ['first', 'last'].map((id, index) => ({ id, kind, timelineStartFrame: index * 48_000, durationFrames: 48_000 })),
		selection: { startFrame: 0, endFrame: 0, clipIds: ['first', 'last'], trackIds: ['pictures'] } };
}
