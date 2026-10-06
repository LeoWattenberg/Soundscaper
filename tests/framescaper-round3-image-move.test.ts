/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipTransformService } from '../src/common/editor/controller/clip-video/internal/clip/clip-transform-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';

function createImageMove() {
	const { project, clip } = createFramescaperBaselineImageFixture({ imageOnly: true });
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	let history = runtime.createHistory(project);
	let nextId = 0;
	const service = createClipTransformService({
		lifetime: { assertActive() {} }, copy: { audioClipNotFound: 'Missing clip',
			track: 'Track', timelineFramesFinite: 'Finite frames required' },
		getProject: () => runtime.projectForCommandConsumers(history.present) as unknown as ClipTransformProject,
		getSelectedClipId: () => clip.id, editingBlocked: () => false,
		createId: prefix => `${prefix}-derived-${String(++nextId)}`, snapTimelineFrame: frame => Math.round(Number(frame)),
		activeSelection: () => null, commit: command => { history = runtime.executeCommand(history, command); },
	});
	return { service, clip, getProject: () => history.present,
		undo: () => { history = runtime.undo(history); }, redo: () => { history = runtime.redo(history); } };
}

test('a normal image drag into empty timeline space creates one picture track and preserves image ownership through Undo and Redo', () => {
	const editor = createImageMove();
	const before = editor.getProject();
	const sourceTrack = before.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(editor.clip.id));
	assert.ok(sourceTrack);
	const target = editor.service.moveClipsToNewTrack(editor.clip.id, 48_000, { exactFrame: true });
	const after = editor.getProject();
	assert.equal(after.tracks.length, before.tracks.length + 1);
	assert.equal(after.tracks.find(track => track.id === target)?.type, 'video');
	assert.deepEqual(after.tracks.find(track => track.id === target)?.clipIds, [editor.clip.id]);
	assert.deepEqual(after.tracks.find(track => track.id === sourceTrack.id)?.clipIds, []);
	assert.deepEqual(after.clips.find(clip => clip.id === editor.clip.id), { ...editor.clip, sequenceStartFrame: 10 });
	editor.undo();
	assert.deepEqual(editor.getProject(), { ...before, revision: editor.getProject().revision,
		updatedAt: editor.getProject().updatedAt });
	editor.redo();
	assert.deepEqual(editor.getProject(), { ...after, revision: editor.getProject().revision,
		updatedAt: editor.getProject().updatedAt });
});

test('a horizontal image drag moves its exact canonical sequence start without changing source animation phase', () => {
	const editor = createImageMove();
	editor.service.moveClips(editor.clip.id, null, 96_000, { exactFrame: true });
	assert.deepEqual(editor.getProject().clips.find(clip => clip.id === editor.clip.id), { ...editor.clip, sequenceStartFrame: 20 });
});
